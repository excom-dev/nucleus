// A demo relying party for passkeys, on WebCrypto alone: no attestation, counter recorded but not enforced, one pending
// challenge. Credentials are discoverable, so the user is the passkey's userHandle: no username or email anywhere.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const CLIENT_DATA_TYPES = { register: "webauthn.create", authenticate: "webauthn.get" };
const USER_PRESENT = 0x01;
const UNREADABLE = "The passkey response could not be read.";

const toBase64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64url = (text) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
const utf8 = (text) => new TextEncoder().encode(text);
const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
const sameBytes = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

// One DER INTEGER as 32 big-endian bytes: leading zeros dropped, short values left-padded.
const derInteger = (der, at) => {
  const end = at + 2 + der[at + 1];
  const digits = der.subarray(at + 2, end);
  const excess = Math.max(0, digits.length - 32);
  if (der[at] !== 0x02 || end > der.length || digits.subarray(0, excess).some(Boolean))
    throw new Error("Not an ECDSA P-256 signature.");
  return { bytes: [...new Uint8Array(32 - digits.length + excess), ...digits.subarray(excess)], end };
};

// Authenticators sign ES256 as DER SEQUENCE { r, s }; WebCrypto verifies the raw r ‖ s.
const derToRaw = (der) => {
  const r = derInteger(der, 2);
  const s = derInteger(der, r.end);
  if (der[0] !== 0x30 || der[1] !== der.length - 2 || s.end !== der.length)
    throw new Error("Not an ECDSA P-256 signature.");
  return new Uint8Array([...r.bytes, ...s.bytes]);
};

const parseClientData = (encoded) => {
  const { type, challenge, origin, crossOrigin } = JSON.parse(new TextDecoder().decode(fromBase64url(encoded)));
  return { type, challenge, origin, crossOrigin };
};

// rpIdHash (32 bytes) ‖ flags (1) ‖ signature counter (4, big-endian) ‖ …
const parseAuthenticatorData = (bytes) => {
  if (bytes.length < 37) throw new Error("Authenticator data is too short.");
  return {
    rpIdHash: bytes.subarray(0, 32),
    flags: bytes[32],
    counter: new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0),
  };
};

const SIGNATURE_SCHEMES = {
  [-7]: {
    key: { name: "ECDSA", namedCurve: "P-256" },
    verify: { name: "ECDSA", hash: "SHA-256" },
    signature: derToRaw,
  },
  [-257]: {
    key: { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    verify: { name: "RSASSA-PKCS1-v1_5" },
    signature: (bytes) => bytes,
  },
};

const importPublicKey = ({ publicKey, alg }) =>
  crypto.subtle.importKey("spki", fromBase64url(publicKey), SIGNATURE_SCHEMES[alg].key, false, ["verify"]);

const isUsableKey = async (credential) => {
  try {
    return Boolean(await importPublicKey(credential));
  } catch {
    return false;
  }
};

const signatureMatches = async (credential, data, signature) => {
  const scheme = SIGNATURE_SCHEMES[credential.alg];
  try {
    return await crypto.subtle.verify(scheme.verify, await importPublicKey(credential), scheme.signature(signature), data);
  } catch {
    return false;
  }
};

// Anything the browser sent that does not decode is one refusal.
const decoded = (read) => {
  try {
    return read();
  } catch {
    return fail(422, UNREADABLE);
  }
};

const checkCeremony = ({ state: { pending }, body, now }, kind) => {
  if (pending?.kind !== kind || pending.expiresAt <= now)
    fail(422, "This passkey request has expired. Please try again.");
  if (body.type !== "public-key" || typeof body.id !== "string" || !body.id || body.rawId !== body.id)
    fail(422, UNREADABLE);
  const { type, challenge, origin, crossOrigin } = decoded(() => parseClientData(body.response.clientDataJSON));
  if (type !== CLIENT_DATA_TYPES[kind]) fail(422, "The passkey answered a different kind of request.");
  if (challenge !== pending.challenge) fail(422, "The passkey answered an old or unknown request.");
  if (origin !== self.location.origin) fail(422, "The passkey response came from another site.");
  if (crossOrigin === true) fail(422, "The passkey was used from inside another site.");
  return pending;
};

const checkAuthenticatorData = async (bytes) => {
  const parsed = decoded(() => parseAuthenticatorData(bytes));
  if (!sameBytes(parsed.rpIdHash, await sha256(utf8(self.location.hostname))))
    fail(422, "The passkey was made for another site.");
  if (!(parsed.flags & USER_PRESENT)) fail(422, "The passkey did not confirm you were there.");
  return parsed;
};

const currentUser = ({ state }) => {
  const user = Object.hasOwn(state.users, state.session.userId) ? state.users[state.session.userId] : null;
  return user && { id: user.id, name: user.name, since: user.createdAt };
};

// Signing in or up adopts the orders placed here as a guest.
const signIn = (state, userId) => ({
  session: { ...state.session, userId },
  pending: null,
  orders: state.orders.map((order) => (order.userId == null ? { ...order, userId } : order)),
});

const beginCeremony = (kind, now, extra) => ({
  pending: { kind, challenge: toBase64url(randomBytes(32)), expiresAt: now + CHALLENGE_TTL_MS, ...extra },
});

const beginRegistration = ({ now }) => {
  const id = randomBytes(16);
  const tag = [...id.subarray(0, 6)].map((byte) => BASE32[byte % 32]).join("");
  const user = { id: toBase64url(id), name: `customer-${tag}`, displayName: `Wrenfield customer ${tag}` };
  return beginCeremony("register", now, { user });
};

const registrationOptions = ({ state: { pending } }) => ({
  rp: { name: RP_NAME, id: self.location.hostname },
  user: pending.user,
  challenge: pending.challenge,
  pubKeyCredParams: Object.keys(SIGNATURE_SCHEMES).map((alg) => ({ alg: Number(alg), type: "public-key" })),
  timeout: PASSKEY_TIMEOUT_MS,
  attestation: "none",
  authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
  excludeCredentials: [],
});

const verifyRegistration = async (ctx) => {
  const { body, state, now } = ctx;
  const { user } = checkCeremony(ctx, "register");
  const { publicKey, publicKeyAlgorithm, authenticatorData, transports = [] } = body.response;
  if (Object.hasOwn(state.credentials, body.id))
    fail(422, "This passkey is already registered. Sign in with it instead.");
  if (!publicKey || !Object.hasOwn(SIGNATURE_SCHEMES, publicKeyAlgorithm))
    fail(422, "This browser does not expose the passkey's public key.");
  if (!(await isUsableKey({ publicKey, alg: publicKeyAlgorithm })))
    fail(422, "The passkey's public key could not be read.");
  if (authenticatorData) await checkAuthenticatorData(decoded(() => fromBase64url(authenticatorData)));
  const createdAt = new Date(now).toISOString();
  return {
    users: { ...state.users, [user.id]: { id: user.id, name: user.name, createdAt } },
    credentials: {
      ...state.credentials,
      [body.id]: { id: body.id, userId: user.id, publicKey, alg: publicKeyAlgorithm, counter: 0, transports, createdAt },
    },
    ...signIn(state, user.id),
  };
};

const beginAuthentication = ({ now }) => beginCeremony("authenticate", now);

const authenticationOptions = ({ state: { pending } }) => ({
  challenge: pending.challenge,
  rpId: self.location.hostname,
  allowCredentials: [],
  userVerification: "preferred",
  timeout: PASSKEY_TIMEOUT_MS,
});

const verifyAuthentication = async (ctx) => {
  const { body, state } = ctx;
  checkCeremony(ctx, "authenticate");
  const credential = Object.hasOwn(state.credentials, body.id)
    ? state.credentials[body.id]
    : fail(422, "Unknown passkey.");
  const { authenticatorData, clientDataJSON, signature, userHandle } = body.response;
  const authData = decoded(() => fromBase64url(authenticatorData));
  const { counter } = await checkAuthenticatorData(authData);
  if (userHandle !== credential.userId) fail(422, "This passkey belongs to another account.");
  const signed = new Uint8Array([...authData, ...(await sha256(fromBase64url(clientDataJSON)))]);
  if (!(await signatureMatches(credential, signed, decoded(() => fromBase64url(signature)))))
    fail(422, "The passkey's signature does not match.");
  return {
    // synced passkeys report 0, so a counter that does not grow is kept, not refused
    credentials: {
      ...state.credentials,
      [credential.id]: { ...credential, counter: Math.max(counter, credential.counter) },
    },
    ...signIn(state, credential.userId),
  };
};

const signedIn = (ctx) => ({ verified: true, user: currentUser(ctx) });

const signOut = ({ state }) => ({ session: { ...state.session, userId: null } });
