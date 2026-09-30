import { describe, expect, it, onTestFinished, vi } from "@excom/nucleus-test";
import { $, $$, act, click, idle, openApp, ORDER, push, text, until } from "./app";
import { createPasskey } from "./backend/authenticator.mjs";

type Worker = Awaited<ReturnType<typeof openApp>>["worker"];

type Credentials = Partial<Record<"create" | "get", (options: CredentialCreationOptions) => Promise<unknown>>>;
const useCredentials = (credentials: Credentials) =>
  Object.defineProperty(navigator, "credentials", { configurable: true, value: credentials });

// happy-dom has no WebAuthn: the fake authenticator plays the platform's passkey prompt for the real <web-authn>.
const stubWebAuthn = (passkey = createPasskey(location.hostname, location.origin)) => {
  vi.stubGlobal("PublicKeyCredential", class {});
  useCredentials({ create: passkey.create, get: passkey.get });
  onTestFinished(() => {
    vi.unstubAllGlobals();
    delete (navigator as { credentials?: unknown }).credentials;
  });
  return passkey;
};
const dismissed = () => Promise.reject(new DOMException("", "NotAllowedError"));

// Holds the worker's answers for `pathname` until released: the page before its data lands.
const hold = (worker: Worker, pathname: string) => {
  const gate = { release: () => {} };
  const held = new Promise<void>((resolve) => (gate.release = resolve));
  const dispatch = worker.dispatch;
  vi.spyOn(worker, "dispatch").mockImplementation(async (request: Request) => {
    if (new URL(request.url).pathname === pathname) await held;
    return dispatch(request);
  });
  return gate.release;
};

const account = () => ({
  buttons: $$("#account [bind-signed-out]:not([hidden]) web-authn button").map((button) => button.textContent),
  user: $("#account [bind-signed-in]:not([hidden])") && text("#account [bind-signed-in] p"),
  orders: $$("#account [bind-orders] [bind-item=id]").map((id) => id.textContent),
});
const messages = () => $$("#account web-authn output").map((output) => output.textContent);
const SIGN_IN = "#account web-authn[start-method=authenticate] button";
const CREATE = "#account web-authn[start-method=register] button";
const SIGN_OUT = "#account [bind-sign-out] button";
const BUTTONS = ["Sign in with a passkey", "Create a passkey"];
const SIGNED_IN = /^Signed in as customer-[A-Z2-7]{6} · since \d{1,2} \w+ \d{4}$/;

describe("account", () => {
  it("creates a passkey, signs out, and signs back in to the same orders", async () => {
    stubWebAuthn();
    const { worker } = await openApp("/account", { setup: ORDER });
    await until(account).toEqual({ buttons: BUTTONS, user: null, orders: ["WF-24001"] });

    await act(() => click(CREATE));
    await until(account).toEqual({ buttons: [], user: expect.stringMatching(SIGNED_IN), orders: ["WF-24001"] });
    const { user } = account();
    expect(user).toContain((await worker.api("GET", "/me")).body.user.name);

    await act(() => click(SIGN_OUT));
    await until(account).toEqual({ buttons: BUTTONS, user: null, orders: [] });

    await act(() => click(SIGN_IN));
    await until(account).toEqual({ buttons: [], user, orders: ["WF-24001"] });
  });

  it("says why a sign-in failed and lets the person try again", async () => {
    const passkey = stubWebAuthn();
    await openApp("/account", {
      allow: [/web-authn: request failed/, /^POST \/api\/passkeys\/authenticate\/verify -> 422$/],
    });
    const failure = () => ({ messages: messages(), disabled: $<HTMLButtonElement>(SIGN_IN)!.disabled });

    useCredentials({ get: dismissed });
    await act(() => click(SIGN_IN));
    await until(failure).toEqual({ messages: ["Passkeys are not available here.", ""], disabled: false });

    // a passkey this site never registered: the server's reason
    useCredentials({ get: passkey.get });
    await act(() => click(SIGN_IN));
    await until(failure).toEqual({ messages: ["Unknown passkey.", ""], disabled: false });
  });

  it("forgets a failed attempt once someone signs in", async () => {
    const passkey = stubWebAuthn();
    await openApp("/account", { allow: [/web-authn: request failed/] });
    useCredentials({ create: passkey.create, get: dismissed });
    await act(() => click(SIGN_IN));
    await until(messages).toEqual(["Passkeys are not available here.", ""]);

    await act(() => click(CREATE));
    await until(() => account().user).toMatch(SIGNED_IN);
    expect(messages()).toEqual(["", ""]);
    await act(() => click(SIGN_OUT));
    await until(account).toEqual({ buttons: BUTTONS, user: null, orders: [] });
    expect(messages()).toEqual(["", ""]);
  });

  it("holds both buttons while either ceremony runs", async () => {
    const passkey = stubWebAuthn();
    const prompt = { answer: () => {} };
    const answered = new Promise<void>((resolve) => (prompt.answer = resolve));
    useCredentials({ create: async (options) => (await answered, passkey.create(options)), get: passkey.get });
    await openApp("/account");
    const disabled = () => $$<HTMLButtonElement>("#account [bind-signed-out] button").map((button) => button.disabled);
    expect(disabled()).toEqual([false, false]);

    await act(() => click(CREATE));
    await until(disabled).toEqual([true, true]);
    prompt.answer();
    await until(() => account().user).toMatch(SIGNED_IN);
  });

  it("shows placeholder rows until the orders arrive", async () => {
    const { worker } = await openApp("/", { setup: ORDER });
    const release = hold(worker, "/api/orders");
    push("/account");
    const list = () => ({
      skeleton: !!$("#account-orders > .wf-skeleton:not([hidden])"),
      rows: $$("#account-orders > .wf-skeleton > *").length,
      loaded: $("#account-orders")!.hasAttribute("did-load"),
      orders: $$("#account [bind-orders] [bind-item=id]").length,
    });
    await until(() => $("#account-orders") && list()).toEqual({ skeleton: true, rows: 3, loaded: false, orders: 0 });
    release();
    await idle();
    await until(list).toEqual({ skeleton: false, rows: 3, loaded: true, orders: 1 });
  });

  it("shows a placeholder order until it arrives", async () => {
    const { worker } = await openApp("/", { setup: ORDER });
    const release = hold(worker, "/api/orders/WF-24001");
    push("/account/orders/WF-24001");
    const order = () => ({
      skeleton: !!$("#order-record > .wf-skeleton:not([hidden])"),
      loaded: $("#order-record")!.hasAttribute("did-load"),
      failed: $("#order-record")!.hasAttribute("is-error"),
      id: text("#order h1 [bind-order=id]"),
    });
    const placeholder = { skeleton: true, loaded: false, failed: false, id: "" };
    await until(() => $("#order-record[api-url]") && order()).toEqual(placeholder);
    release();
    await idle();
    await until(order).toEqual({ skeleton: false, loaded: true, failed: false, id: "WF-24001" });
  });
});
