// A fake platform authenticator holding one discoverable passkey, with real ES256 (or RS256) keys on Node's WebCrypto.
// `create` / `get` stand in for navigator.credentials; `register` / `authenticate` take and return the JSON that
// @simplewebauthn/browser exchanges with the server. Written apart from public/service-worker/passkeys.js: the two
// share no code.
import { webcrypto } from "node:crypto";

const { subtle } = webcrypto;
const ALGORITHMS = {
  [-7]: { key: { name: "ECDSA", namedCurve: "P-256" }, sign: { name: "ECDSA", hash: "SHA-256" } },
  [-257]: {
    key: { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    sign: { name: "RSASSA-PKCS1-v1_5" },
  },
};
// user present, user verified, attested credential data included
const FLAGS = { up: 0x01, uv: 0x04, at: 0x40 };

/** Bytes (an ArrayBuffer or a view) as unpadded base64url, for tests that edit a credential. */
export const encodeBase64url = (data) => Buffer.from(new Uint8Array(data)).toString("base64url");
/** Unpadded base64url as bytes. */
export const decodeBase64url = (text) => new Uint8Array(Buffer.from(text, "base64url"));
const concat = (...parts) => new Uint8Array(parts.flatMap((part) => [...part]));
// A fresh ArrayBuffer of exactly the view's bytes, as the browser hands out.
const exact = (view) => new Uint8Array(view).buffer;
const sha256 = async (data) => new Uint8Array(await subtle.digest("SHA-256", data));
const uint32 = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

// Just enough CBOR for an attestation object and a COSE key.
const head = (major, n) =>
  n < 24 ? [(major << 5) | n] : n < 256 ? [(major << 5) | 24, n] : [(major << 5) | 25, n >> 8, n & 255];
const cbor = (value) => {
  if (typeof value === "number") return value < 0 ? head(1, -1 - value) : head(0, value);
  if (typeof value === "string") return [...head(3, Buffer.byteLength(value)), ...Buffer.from(value)];
  if (value instanceof Uint8Array) return [...head(2, value.length), ...value];
  const entries = [...(value instanceof Map ? value : Object.entries(value))];
  return [...head(5, entries.length), ...entries.flatMap(([key, item]) => [...cbor(key), ...cbor(item)])];
};

const coseKey = async (alg, publicKey) => {
  const { x, y, n, e } = await subtle.exportKey("jwk", publicKey);
  return alg === -7
    ? new Map([[1, 2], [3, alg], [-1, 1], [-2, decodeBase64url(x)], [-3, decodeBase64url(y)]])
    : new Map([[1, 3], [3, alg], [-1, decodeBase64url(n)], [-2, decodeBase64url(e)]]);
};

// WebCrypto signs ES256 as raw r ‖ s; authenticators send DER SEQUENCE { INTEGER r, INTEGER s }.
const derInteger = (raw) => {
  const start = raw.findIndex(Boolean);
  const digits = [...(raw[start] & 0x80 ? [0] : []), ...raw.subarray(start < 0 ? raw.length - 1 : start)];
  return [0x02, digits.length, ...digits];
};
const toDer = (raw) => {
  const body = [...derInteger(raw.subarray(0, 32)), ...derInteger(raw.subarray(32))];
  return new Uint8Array([0x30, body.length, ...body]);
};

/** One passkey for `rpId`, used from `origin`. `alg`: -7 (ES256, default) or -257 (RS256). */
export const createPasskey = (rpId, origin, { alg = -7 } = {}) => {
  const id = webcrypto.getRandomValues(new Uint8Array(16));
  const keyPair = subtle.generateKey(ALGORITHMS[alg].key, true, ["sign", "verify"]);
  const held = { userHandle: null, counter: 0 };
  const clientData = (type, challenge) =>
    Buffer.from(JSON.stringify({ type, challenge: encodeBase64url(challenge), origin, crossOrigin: false }));
  const authData = async (flags, attested = []) =>
    concat(await sha256(Buffer.from(rpId)), [flags], uint32(held.counter), attested);
  const credential = (response) => ({
    id: encodeBase64url(id),
    rawId: exact(id),
    type: "public-key",
    authenticatorAttachment: "platform",
    response,
    getClientExtensionResults: () => ({}),
  });

  /** navigator.credentials.create({ publicKey }), binary fields as ArrayBuffers. */
  const create = async ({ publicKey: options }) => {
    if (options.rp.id !== rpId) throw new DOMException("The relying party is not this site.", "SecurityError");
    if (!options.pubKeyCredParams.some((param) => param.alg === alg))
      throw new DOMException("No supported algorithm.", "NotSupportedError");
    const { publicKey } = await keyPair;
    held.userHandle = new Uint8Array(options.user.id);
    const attested = concat(new Uint8Array(16), [0, id.length], id, cbor(await coseKey(alg, publicKey)));
    const authenticatorData = await authData(FLAGS.up | FLAGS.uv | FLAGS.at, attested);
    const spki = await subtle.exportKey("spki", publicKey);
    return credential({
      clientDataJSON: exact(clientData("webauthn.create", options.challenge)),
      attestationObject: exact(new Uint8Array(cbor({ fmt: "none", attStmt: {}, authData: authenticatorData }))),
      getTransports: () => ["internal", "hybrid"],
      getPublicKey: () => spki,
      getPublicKeyAlgorithm: () => alg,
      getAuthenticatorData: () => exact(authenticatorData),
    });
  };

  /** navigator.credentials.get({ publicKey }); the counter grows by one per assertion. */
  const get = async ({ publicKey: options }) => {
    if (options.rpId !== rpId) throw new DOMException("No passkey for this site.", "NotAllowedError");
    held.counter += 1;
    const authenticatorData = await authData(FLAGS.up | FLAGS.uv);
    const clientDataJSON = clientData("webauthn.get", options.challenge);
    const signed = concat(authenticatorData, await sha256(clientDataJSON));
    const raw = new Uint8Array(await subtle.sign(ALGORITHMS[alg].sign, (await keyPair).privateKey, signed));
    return credential({
      clientDataJSON: exact(clientDataJSON),
      authenticatorData: exact(authenticatorData),
      signature: exact(alg === -7 ? toDer(raw) : raw),
      userHandle: held.userHandle && exact(held.userHandle),
    });
  };

  const json = ({ id: credentialId, type, authenticatorAttachment }, response) => ({
    id: credentialId,
    rawId: credentialId,
    type,
    response,
    clientExtensionResults: {},
    authenticatorAttachment,
  });

  /** Registration options JSON in, the credential JSON the browser posts out. */
  const register = async (options) => {
    const user = { ...options.user, id: decodeBase64url(options.user.id) };
    const created = await create({ publicKey: { ...options, user, challenge: decodeBase64url(options.challenge) } });
    const { response } = created;
    return json(created, {
      clientDataJSON: encodeBase64url(response.clientDataJSON),
      attestationObject: encodeBase64url(response.attestationObject),
      transports: response.getTransports(),
      publicKeyAlgorithm: response.getPublicKeyAlgorithm(),
      publicKey: encodeBase64url(response.getPublicKey()),
      authenticatorData: encodeBase64url(response.getAuthenticatorData()),
    });
  };

  /** Authentication options JSON in, the assertion JSON the browser posts out. */
  const authenticate = async (options) => {
    const asserted = await get({ publicKey: { ...options, challenge: decodeBase64url(options.challenge) } });
    const { response } = asserted;
    return json(asserted, {
      authenticatorData: encodeBase64url(response.authenticatorData),
      clientDataJSON: encodeBase64url(response.clientDataJSON),
      signature: encodeBase64url(response.signature),
      userHandle: response.userHandle ? encodeBase64url(response.userHandle) : undefined,
    });
  };

  return { create, get, register, authenticate };
};
