import { describe, expect, it } from "@excom/heft-rig/node_modules/vitest";
import { createPasskey, decodeBase64url, encodeBase64url } from "./backend/authenticator.mjs";
import { loadWorker, ORIGIN } from "./backend/worker.mjs";

type Api = (method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>;
type Json = Record<string, any>;

const NOW = Date.UTC(2026, 8, 30, 9, 0, 0);
const HOST = new URL(ORIGIN).hostname;
const ORDER: [string, string, unknown?][] = [
  ["POST", "/bag", { sku: "WF-1014" }],
  ["PATCH", "/checkout", { delivery: "collect" }],
  ["POST", "/orders"],
];

const options = async (api: Api, ceremony: "register" | "authenticate") =>
  (await api("POST", `/passkeys/${ceremony}/options`, {})).body;
const signUp = async (api: Api, passkey = createPasskey(HOST, ORIGIN)) => {
  const offered = await options(api, "register");
  const response = await api("POST", "/passkeys/register/verify", await passkey.register(offered));
  return { passkey, offered, response, user: response.body.user };
};
const signIn = async (api: Api, passkey: ReturnType<typeof createPasskey>) =>
  api("POST", "/passkeys/authenticate/verify", await passkey.authenticate(await options(api, "authenticate")));
const signOut = (api: Api) => api("DELETE", "/passkeys/session");
const placeOrder = async (api: Api) => {
  for (const call of ORDER) await api(...call);
};
const orderIds = async (api: Api) => (await api("GET", "/orders")).body.map((order: Json) => order.id);
const refused = (message: RegExp) => ({ status: 422, body: { message: expect.stringMatching(message) } });

// Rewrites a base64url field of a credential, as a tampering client would.
const editBytes = (text: string, edit: (bytes: Uint8Array) => void) => {
  const bytes: Uint8Array = decodeBase64url(text);
  edit(bytes);
  return encodeBase64url(bytes);
};
const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const editClientData = (text: string, edit: (data: Json) => Json) =>
  encodeBase64url(jsonBytes(edit(JSON.parse(new TextDecoder().decode(decodeBase64url(text))))));
type Tamper = (credential: Json) => Json | undefined;
const clientData = (edit: (data: Json) => Json): Tamper => (c) =>
  void (c.response.clientDataJSON = editClientData(c.response.clientDataJSON, edit));
const authData = (edit: (bytes: Uint8Array) => void): Tamper => (c) =>
  void (c.response.authenticatorData = editBytes(c.response.authenticatorData, edit));
const signature = (edit: (bytes: Uint8Array) => void): Tamper => (c) =>
  void (c.response.signature = editBytes(c.response.signature, edit));
const answer = (key: string, value: unknown): Tamper => (c) => void (c.response[key] = value);
// Refused by both verify routes before either reads the ceremony.
const EITHER: [string, Tamper, RegExp][] = [
  ["framed by another site", clientData((d) => ({ ...d, crossOrigin: true })), /from inside another site/],
  ["that is not a public-key credential", (c) => ({ ...c, type: "password" }), /could not be read/],
  ["whose rawId is not its id", (c) => ({ ...c, rawId: "AAAA" }), /could not be read/],
];

describe("passkeys", () => {
  it("offers a discoverable ES256 or RS256 passkey for a new anonymous user", async () => {
    const { api } = loadWorker({ now: NOW });
    const offered = await options(api, "register");
    expect(offered).toEqual({
      rp: { name: "Wrenfield", id: HOST },
      user: {
        id: expect.stringMatching(/^[\w-]{22}$/),
        name: expect.stringMatching(/^customer-[A-Z2-7]{6}$/),
        displayName: expect.any(String),
      },
      challenge: expect.stringMatching(/^[\w-]{43}$/),
      pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "preferred" },
      excludeCredentials: [],
    });
    expect(offered.user.displayName).toBe(`Wrenfield customer ${offered.user.name.slice("customer-".length)}`);
    expect((await options(api, "register")).challenge).not.toBe(offered.challenge);
    expect(await options(api, "authenticate")).toEqual({
      challenge: expect.stringMatching(/^[\w-]{43}$/),
      rpId: HOST,
      allowCredentials: [],
      userVerification: "preferred",
      timeout: 60000,
    });
  });

  it("signs up, keeps orders to the user, signs out and back in", async () => {
    const { api } = loadWorker({ now: NOW });
    expect((await api("GET", "/me")).body.user).toBeNull();
    const { passkey, offered, response, user } = await signUp(api);
    expect(user).toEqual({ id: offered.user.id, name: offered.user.name, since: new Date(NOW).toISOString() });
    expect(response).toEqual({ status: 200, body: { verified: true, user } });
    expect((await api("GET", "/me")).body).toMatchObject({ user, orderCount: 0 });

    await placeOrder(api);
    expect(await orderIds(api)).toEqual(["WF-24001"]);
    expect((await api("GET", "/me")).body.orderCount).toBe(1);

    expect(await signOut(api)).toEqual({ status: 200, body: { user: null } });
    expect((await api("GET", "/me")).body).toMatchObject({ user: null, orderCount: 0 });
    expect(await orderIds(api)).toEqual([]);
    expect((await api("GET", "/orders/WF-24001")).status).toBe(404);
    expect((await api("GET", "/orders/latest")).status).toBe(404);

    expect(await signIn(api, passkey)).toEqual({ status: 200, body: { verified: true, user } });
    expect(await signIn(api, passkey)).toEqual({ status: 200, body: { verified: true, user } });
    expect(await orderIds(api)).toEqual(["WF-24001"]);
    expect((await api("GET", "/orders/WF-24001")).body.id).toBe("WF-24001");
  });

  it("gives guest orders to whoever signs in next and keeps users apart", async () => {
    const { api } = loadWorker({ now: NOW });
    await placeOrder(api);
    const first = await signUp(api);
    expect(await orderIds(api)).toEqual(["WF-24001"]);
    await signOut(api);
    await placeOrder(api);
    expect(await orderIds(api)).toEqual(["WF-24002"]);
    const second = await signUp(api);
    expect(second.user.id).not.toBe(first.user.id);
    expect(await orderIds(api)).toEqual(["WF-24002"]);
    await signOut(api);
    expect((await signIn(api, first.passkey)).body.user).toEqual(first.user);
    expect(await orderIds(api)).toEqual(["WF-24001"]);
  });

  it("signs up when the browser does not expose authenticator data", async () => {
    const { api } = loadWorker({ now: NOW });
    const passkey = createPasskey(HOST, ORIGIN);
    const credential = await passkey.register(await options(api, "register"));
    delete credential.response.authenticatorData;
    const { user } = (await api("POST", "/passkeys/register/verify", credential)).body;
    await signOut(api);
    expect(await signIn(api, passkey)).toEqual({ status: 200, body: { verified: true, user } });
  });

  it("signs in with an RS256 passkey", async () => {
    const { api } = loadWorker({ now: NOW });
    const passkey = createPasskey(HOST, ORIGIN, { alg: -257 });
    const { user } = await signUp(api, passkey);
    await signOut(api);
    expect(await signIn(api, passkey)).toEqual({ status: 200, body: { verified: true, user } });
  });

  it("DELETE /demo forgets users and their passkeys", async () => {
    const { api } = loadWorker({ now: NOW });
    const { passkey } = await signUp(api);
    await placeOrder(api);
    await api("DELETE", "/demo");
    expect((await api("GET", "/me")).body).toMatchObject({ user: null, orderCount: 0 });
    expect(await signIn(api, passkey)).toEqual(refused(/^Unknown passkey\.$/));
  });

  describe("refuses a registration", () => {
    const cases: [string, Tamper, RegExp][] = [
      ["that answers another challenge", clientData((d) => ({ ...d, challenge: "AAAA" })), /old or unknown request/],
      ["from another origin", clientData((d) => ({ ...d, origin: "https://elsewhere.example" })), /came from another site/],
      ["of the wrong type", clientData((d) => ({ ...d, type: "webauthn.get" })), /different kind of request/],
      ["without a public key", answer("publicKey", undefined), /does not expose the passkey's public key/],
      ["with an unsupported algorithm", answer("publicKeyAlgorithm", -8), /does not expose the passkey's public key/],
      ["with a public key that is not one", answer("publicKey", "AAAA"), /public key could not be read/],
      ["with a key of another algorithm", answer("publicKeyAlgorithm", -257), /public key could not be read/],
      ["made for another relying party", authData((b) => void (b[0] ^= 1)), /made for another site/],
      ["without user presence", authData((b) => void (b[32] &= ~1)), /did not confirm you were there/],
      ["with short authenticator data", answer("authenticatorData", "AAAA"), /could not be read/],
      ["without an id", (c) => ({ ...c, id: undefined }), /could not be read/],
      ["that is not a credential", () => ({}), /could not be read/],
      ...EITHER,
    ];
    it.each(cases)("%s", async (_name, tamper, message) => {
      const { api } = loadWorker({ now: NOW });
      const credential = await createPasskey(HOST, ORIGIN).register(await options(api, "register"));
      expect(await api("POST", "/passkeys/register/verify", tamper(credential) ?? credential)).toEqual(refused(message));
      expect((await api("GET", "/me")).body.user).toBeNull();
    });

    it("made from another origin, expired, or without a pending registration", async () => {
      const { api, travel } = loadWorker({ now: NOW });
      const offered = await options(api, "register");
      const elsewhere = await createPasskey(HOST, "https://elsewhere.example").register(offered);
      expect(await api("POST", "/passkeys/register/verify", elsewhere)).toEqual(refused(/came from another site/));
      const late = await createPasskey(HOST, ORIGIN).register(offered);
      await travel(120_000);
      expect(await api("POST", "/passkeys/register/verify", late)).toEqual(refused(/expired/));
      const early = await createPasskey(HOST, ORIGIN).register(await options(api, "register"));
      await options(api, "authenticate");
      expect(await api("POST", "/passkeys/register/verify", early)).toEqual(refused(/expired/));
    });

    it("replayed after it signed up, or of a passkey already registered", async () => {
      const { api } = loadWorker({ now: NOW });
      const passkey = createPasskey(HOST, ORIGIN);
      const credential = await passkey.register(await options(api, "register"));
      expect((await api("POST", "/passkeys/register/verify", credential)).status).toBe(200);
      expect(await api("POST", "/passkeys/register/verify", credential)).toEqual(refused(/expired/));
      const again = await passkey.register(await options(api, "register"));
      expect(await api("POST", "/passkeys/register/verify", again)).toEqual(refused(/already registered/));
    });
  });

  describe("refuses a sign-in", () => {
    const cases: [string, Tamper, RegExp][] = [
      ["with a tampered signature", signature((b) => void (b[b.length - 1] ^= 1)), /signature does not match/],
      ["with a signature that is not DER", answer("signature", "AAAA"), /signature does not match/],
      ["that answers another challenge", clientData((d) => ({ ...d, challenge: "AAAA" })), /old or unknown request/],
      ["from another origin", clientData((d) => ({ ...d, origin: "https://elsewhere.example" })), /came from another site/],
      ["of the wrong type", clientData((d) => ({ ...d, type: "webauthn.create" })), /different kind of request/],
      ["made for another relying party", authData((b) => void (b[31] ^= 1)), /made for another site/],
      ["without user presence", authData((b) => void (b[32] &= ~1)), /did not confirm you were there/],
      ["with unreadable authenticator data", answer("authenticatorData", "*"), /could not be read/],
      ["with an unknown passkey", (a) => ({ ...a, id: "AAAA", rawId: "AAAA" }), /^Unknown passkey\.$/],
      ["with an inherited property for an id", (a) => ({ ...a, id: "constructor", rawId: "constructor" }), /^Unknown passkey\.$/],
      ["without a user handle", answer("userHandle", undefined), /another account/],
      ...EITHER,
    ];
    it.each(cases)("%s", async (_name, tamper, message) => {
      const { api } = loadWorker({ now: NOW });
      const { passkey } = await signUp(api);
      await signOut(api);
      const assertion = await passkey.authenticate(await options(api, "authenticate"));
      expect(await api("POST", "/passkeys/authenticate/verify", tamper(assertion) ?? assertion)).toEqual(refused(message));
      expect((await api("GET", "/me")).body.user).toBeNull();
    });

    it("from a passkey this site never registered", async () => {
      const { api } = loadWorker({ now: NOW });
      expect(await signIn(api, createPasskey(HOST, ORIGIN))).toEqual(refused(/^Unknown passkey\.$/));
    });

    it("whose user handle names another user", async () => {
      const { api } = loadWorker({ now: NOW });
      const first = await signUp(api);
      const second = await signUp(api);
      await signOut(api);
      const assertion = await first.passkey.authenticate(await options(api, "authenticate"));
      assertion.response.userHandle = second.user.id;
      expect(await api("POST", "/passkeys/authenticate/verify", assertion)).toEqual(refused(/another account/));
    });

    it("expired, replayed, or without a pending sign-in", async () => {
      const { api, travel } = loadWorker({ now: NOW });
      const { passkey } = await signUp(api);
      await signOut(api);
      expect(await api("POST", "/passkeys/authenticate/verify", {})).toEqual(refused(/expired/));
      const late = await passkey.authenticate(await options(api, "authenticate"));
      await travel(120_000);
      expect(await api("POST", "/passkeys/authenticate/verify", late)).toEqual(refused(/expired/));
      const once = await passkey.authenticate(await options(api, "authenticate"));
      expect((await api("POST", "/passkeys/authenticate/verify", once)).status).toBe(200);
      expect(await api("POST", "/passkeys/authenticate/verify", once)).toEqual(refused(/expired/));
    });
  });

  describe("helpers", () => {
    const { binding } = loadWorker();
    const bytes = (value: ArrayLike<number>) => Array.from(value);

    it("base64url encodes and decodes every byte, unpadded", () => {
      const all = Uint8Array.from({ length: 256 }, (_, i) => i);
      const encoded = binding("toBase64url")(all);
      expect(encoded).toBe(encodeBase64url(all));
      expect(bytes(binding("fromBase64url")(encoded))).toEqual(bytes(all));
      expect(binding("toBase64url")([0xfb, 0xff])).toBe("-_8");
      expect(() => binding("fromBase64url")("*")).toThrow();
    });

    it("hashes with SHA-256", async () => {
      const digest = await binding("sha256")(binding("utf8")("localhost"));
      const hex = bytes(digest).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      expect(hex).toBe("49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763");
    });

    it("turns a DER ECDSA signature into raw r ‖ s", () => {
      const derToRaw = binding("derToRaw");
      const r = [0x00, 0x80, ...Array(31).fill(1)]; // sign byte before a high bit
      const s = Array(31).fill(2); // a short integer
      const der = [0x30, 4 + r.length + s.length, 0x02, r.length, ...r, 0x02, s.length, ...s];
      expect(bytes(derToRaw(new Uint8Array(der)))).toEqual([0x80, ...Array(31).fill(1), 0x00, ...Array(31).fill(2)]);
      const broken = {
        "not a sequence": [0x31, ...der.slice(1)],
        "wrong length": [0x30, der[1] + 1, ...der.slice(2)],
        "trailing bytes": [...der.slice(0, 1), der[1] + 1, ...der.slice(2), 0],
        "not an integer": [...der.slice(0, 2), 0x03, ...der.slice(3)],
        "integer past the end": [0x30, 4, 0x02, 9, 1, 2],
        "integer over 32 bytes": [0x30, 4 + 33 + s.length, 0x02, 33, 1, ...Array(32).fill(1), 0x02, s.length, ...s],
      };
      for (const [name, sample] of Object.entries(broken)) expect(() => derToRaw(new Uint8Array(sample)), name).toThrow();
    });

    it("reads client data and authenticator data", () => {
      const clientData = { type: "webauthn.get", challenge: "abc", origin: ORIGIN, crossOrigin: false };
      expect(binding("parseClientData")(encodeBase64url(jsonBytes(clientData)))).toEqual({
        type: "webauthn.get",
        challenge: "abc",
        origin: ORIGIN,
        crossOrigin: false,
      });
      expect(() => binding("parseClientData")(encodeBase64url(jsonBytes(null)))).toThrow();
      const authData = new Uint8Array([...Array(32).fill(7), 0x05, 0, 0, 1, 2, 9]);
      const parsed = binding("parseAuthenticatorData")(authData.subarray(0, 37));
      expect({ ...parsed, rpIdHash: bytes(parsed.rpIdHash) }).toEqual({
        rpIdHash: Array(32).fill(7),
        flags: 5,
        counter: 258,
      });
      expect(() => binding("parseAuthenticatorData")(authData.subarray(0, 36))).toThrow();
    });
  });
});
