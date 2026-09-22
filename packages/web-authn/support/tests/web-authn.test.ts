import { invokeCommand } from "@excom/neutron";
import "../../index";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  waitForEvent,
  wait,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";

const vi = (globalThis as any).vi;

vi.mock("@simplewebauthn/browser", () => ({
  startRegistration: vi.fn(),
  startAuthentication: vi.fn(),
}));

const mockStartRegistration = vi.mocked(startRegistration);
const mockStartAuthentication = vi.mocked(startAuthentication);

function mockOptionsEndpoint(options = { challenge: "abc123" }) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(() =>
    Promise.resolve(
      new Response(JSON.stringify(options), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("web-authn", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
    mockStartRegistration.mockReset();
    mockStartAuthentication.mockReset();
  });

  it("defines the web-authn custom element", () => {
    expect(customElements.get("web-authn")).toBeTruthy();
  });

  it("finds form element on connect", () => {
    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn><form><input name="username" value="alice"></form></web-authn>`,
    );

    expect(el.getFormElement()).toBeInstanceOf(HTMLFormElement);
  });

  it("emits error when required attributes are missing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn><form></form></web-authn>`,
    );

    const spy = vi.fn();
    el.addEventListener("web-authn-error", spy);

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    expect(spy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("prevents default on form submit", () => {
    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/options" verify-url="/verify" start-method="register">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    mockOptionsEndpoint();
    mockStartRegistration.mockResolvedValue({ id: "cred-1" });

    const event = new Event("submit", { cancelable: true, bubbles: true });
    const preventSpy = vi.spyOn(event, "preventDefault");

    el.querySelector("form")!.dispatchEvent(event);

    expect(preventSpy).toHaveBeenCalled();
  });

  it("calls startRegistration during register flow", async () => {
    const fetchSpy = mockOptionsEndpoint({ challenge: "reg-challenge" });
    mockStartRegistration.mockResolvedValue({ id: "cred-1", type: "public-key" });

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/register/options" verify-url="/api/register/verify" start-method="register">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    const triggerPromise = waitForEvent(el, "web-authn-submit");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await triggerPromise;

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:3000/api/register/options",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockStartRegistration).toHaveBeenCalledWith({
      optionsJSON: { challenge: "reg-challenge" },
    });
  });

  it("calls startAuthentication during authenticate flow", async () => {
    mockOptionsEndpoint({ challenge: "auth-challenge" });
    mockStartAuthentication.mockResolvedValue({ id: "cred-2", response: {} });

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/auth/options" verify-url="/api/auth/verify" start-method="authenticate">
        <form><input name="username" value="bob"></form>
      </web-authn>`,
    );

    const triggerPromise = waitForEvent(el, "web-authn-submit");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await triggerPromise;

    expect(mockStartAuthentication).toHaveBeenCalledWith({
      optionsJSON: { challenge: "auth-challenge" },
    });
  });

  it("emits error when options fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(null, { status: 500, statusText: "Internal Server Error" }),
      ),
    );

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    const errorPromise = waitForEvent(el, "web-authn-error");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await errorPromise;
  });

  it("emits error when startMethod is invalid", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockOptionsEndpoint();

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="invalid">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    const errorPromise = waitForEvent(el, "web-authn-error");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await errorPromise;
  });

  it("emits error when startRegistration rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockOptionsEndpoint();
    mockStartRegistration.mockRejectedValue(new Error("User canceled"));

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    const errorPromise = waitForEvent(el, "web-authn-error");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await errorPromise;
  });

  it("sends form data as JSON in the options fetch body", async () => {
    const fetchSpy = mockOptionsEndpoint();
    mockStartRegistration.mockResolvedValue({ id: "cred-1" });

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
        <form>
          <input name="username" value="alice">
          <input name="displayName" value="Alice">
        </form>
      </web-authn>`,
    );

    const triggerPromise = waitForEvent(el, "web-authn-submit");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await triggerPromise;

    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.username).toBe("alice");
    expect(body.displayName).toBe("Alice");
  });

  it("interpolates params in verifyUrl via trigger → load event", async () => {
    mockOptionsEndpoint();
    mockStartRegistration.mockResolvedValue({ id: "cred-1" });

    const el = fixture<HTMLWebAuthnElement>(
      `<web-authn options-url="/api/options" verify-url="/api/42/verify" start-method="register">
        <form><input name="username" value="alice"></form>
      </web-authn>`,
    );

    let loadDetail: any;
    el.addEventListener("web-authn-submit", (e: any) => {
      loadDetail = e.detail;
    });

    const triggerPromise = waitForEvent(el, "web-authn-submit");

    el.querySelector("form")!.dispatchEvent(
      new Event("submit", { cancelable: true, bubbles: true }),
    );

    await triggerPromise;

    expect(loadDetail[0]).toBe("http://localhost:3000/api/42/verify");
    expect(loadDetail[1].method).toBe("POST");
    expect(loadDetail[1].credentials).toBe("include");
  });

  describe("--submit command", () => {
    it("starts the ceremony; the command does not bubble", async () => {
      mockOptionsEndpoint({ challenge: "trig" });
      mockStartRegistration.mockResolvedValue({ id: "cred-1" });

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      const outer = vi.fn();
      el.parentElement!.addEventListener("command", outer);

      const submitted = waitForEvent(el, "web-authn-submit");
      invokeCommand(el, "--submit");
      // the ceremony starts once the dispatch settles (a microtask)
      await Promise.resolve();
      expect(el.isLoading).toBe(true);
      await submitted;

      expect(outer).not.toHaveBeenCalled();
      expect(mockStartRegistration).toHaveBeenCalledWith({
        optionsJSON: { challenge: "trig" },
      });
    });

    it("drives a form-ref outside the subtree that submit cannot reach", async () => {
      const fetchSpy = mockOptionsEndpoint();
      mockStartAuthentication.mockResolvedValue({ id: "cred-2" });

      const wrap = fixture<HTMLDivElement>(
        `<div>
          <form id="ext-form"><input name="username" value="carol"></form>
          <web-authn form-ref="#ext-form" options-url="/api/options" verify-url="/api/verify" start-method="authenticate"></web-authn>
        </div>`,
      );
      const el = wrap.querySelector("web-authn")!;
      const form = wrap.querySelector("form")!;
      expect(el.getFormElement()).toBe(form);

      // the element is not an ancestor of the form, so submit is not heard
      form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      expect(fetchSpy).not.toHaveBeenCalled();

      await waitForEvent(el, "web-authn-submit", () => {
        invokeCommand(el, "--submit");
      });

      const [optionsUrl, optionsInit] = fetchSpy.mock.calls[0];
      expect(optionsUrl).toBe("http://localhost:3000/api/options");
      expect(JSON.parse(optionsInit.body).username).toBe("carol");
      expect(mockStartAuthentication).toHaveBeenCalled();
    });
  });

  describe("option parsing", () => {
    it("emits error when form-ref matches no form", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn form-ref="#nope" options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form></form>
        </web-authn>`,
      );
      const spy = vi.fn();
      el.addEventListener("web-authn-error", spy);

      invokeCommand(el, "--submit");
      await wait(0);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0].detail).toMatch(/Missing required/);
      expect(errorSpy).toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(el.isLoading).toBeFalsy();
    });

    it.each([
      ["options-url", `verify-url="/v" start-method="register"`],
      ["verify-url", `options-url="/o" start-method="register"`],
      ["start-method", `options-url="/o" verify-url="/v"`],
    ])("emits error when %s is missing", (_name, attrs) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn ${attrs}><form></form></web-authn>`,
      );
      const spy = vi.fn();
      el.addEventListener("web-authn-error", spy);

      el.querySelector("form")!.dispatchEvent(
        new Event("submit", { cancelable: true, bubbles: true }),
      );

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it("uses api-method for both the options and verify requests", async () => {
      const fetchSpy = mockOptionsEndpoint();
      mockStartRegistration.mockResolvedValue({ id: "cred-1" });

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn api-method="put" options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );

      let submitDetail: any;
      el.addEventListener("web-authn-submit", (e: any) => {
        submitDetail = e.detail;
      });
      await waitForEvent(el, "web-authn-submit", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(fetchSpy.mock.calls[0][1].method).toBe("PUT");
      expect(submitDetail[1].method).toBe("PUT");
    });

    it("carries the credential as the verify request body", async () => {
      mockOptionsEndpoint();
      const credential = { id: "cred-9", type: "public-key", response: { x: 1 } };
      mockStartRegistration.mockResolvedValue(credential);

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      let submitDetail: any;
      el.addEventListener("web-authn-submit", (e: any) => {
        submitDetail = e.detail;
      });
      await waitForEvent(el, "web-authn-submit", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(submitDetail[1].body).toEqual(credential);
    });
  });

  describe("verify request", () => {
    const mockCeremony = (verify: { status: number; body: unknown }) =>
      vi.spyOn(globalThis, "fetch").mockImplementation((url: any) =>
        Promise.resolve(
          new Response(
            JSON.stringify(
              String(url).includes("/options") ? { challenge: "c" } : verify.body,
            ),
            {
              status: String(url).includes("/options") ? 200 : verify.status,
              headers: { "content-type": "application/json" },
            },
          ),
        ),
      );

    it("posts the credential to verify-url and publishes provision on success", async () => {
      const fetchSpy = mockCeremony({ status: 200, body: { verified: true } });
      const credential = { id: "cred-1", type: "public-key" };
      mockStartRegistration.mockResolvedValue(credential);

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/register/options" verify-url="/api/register/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      const provisionSpy = vi.fn();
      el.addEventListener("neutron-provision", provisionSpy);
      const successSpy = vi.fn();
      el.addEventListener("web-authn-success", successSpy);

      await waitForEvent(el, "web-authn-success", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const [verifyUrl, verifyInit] = fetchSpy.mock.calls[1];
      expect(verifyUrl).toBe("http://localhost:3000/api/register/verify");
      expect(verifyInit.method).toBe("POST");
      expect(JSON.parse(verifyInit.body)).toEqual(credential);

      expect(el).dom.to.equalTag(
        `<web-authn is-success options-url="/api/register/options" verify-url="/api/register/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      expect(el.provision).toEqual(
        expect.objectContaining({ status: 200, body: { verified: true } }),
      );
      expect(successSpy.mock.calls[0][0].detail).toBe(el.provision);
      expect(provisionSpy).toHaveBeenCalledTimes(1);
    });

    it("sets is-error with the response payload when verify-url rejects the credential", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockCeremony({ status: 401, body: { verified: false, error: "bad sig" } });
      mockStartAuthentication.mockResolvedValue({ id: "cred-2" });

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/auth/options" verify-url="/api/auth/verify" start-method="authenticate">
          <form><input name="username" value="bob"></form>
        </web-authn>`,
      );

      await waitForEvent(el, "web-authn-error", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(el.hasAttribute("is-error")).toBe(true);
      expect(el.hasAttribute("is-success")).toBe(false);
      expect(el.hasAttribute("is-loading")).toBe(false);
      expect(el.provision).toEqual(
        expect.objectContaining({
          status: 401,
          body: { verified: false, error: "bad sig" },
        }),
      );
    });
  });

  describe("ceremony errors", () => {
    it("reports the Error message when the ceremony rejects with an Error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockOptionsEndpoint();
      mockStartRegistration.mockRejectedValue(new Error("User canceled"));

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      const spy = vi.fn();
      el.addEventListener("web-authn-error", spy);

      await waitForEvent(el, "web-authn-error", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(spy.mock.calls[0][0].detail).toEqual({ message: "User canceled" });
    });

    it("reports a generic message when the ceremony rejects with a non-Error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockOptionsEndpoint();
      mockStartAuthentication.mockRejectedValue({ name: "NotAllowedError" });

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="authenticate">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      const spy = vi.fn();
      el.addEventListener("web-authn-error", spy);

      await waitForEvent(el, "web-authn-error", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(spy.mock.calls[0][0].detail).toEqual({
        message: "WebAuthn operation failed",
      });
      expect(el.hasAttribute("is-success")).toBe(false);
    });

    it("reports the status text when the options fetch is not ok", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(globalThis, "fetch").mockImplementation(() =>
        Promise.resolve(
          new Response(null, { status: 403, statusText: "Forbidden" }),
        ),
      );

      const el = fixture<HTMLWebAuthnElement>(
        `<web-authn options-url="/api/options" verify-url="/api/verify" start-method="register">
          <form><input name="username" value="alice"></form>
        </web-authn>`,
      );
      const spy = vi.fn();
      el.addEventListener("web-authn-error", spy);

      await waitForEvent(el, "web-authn-error", () => {
        el.querySelector("form")!.dispatchEvent(
          new Event("submit", { cancelable: true, bubbles: true }),
        );
      });

      expect(spy.mock.calls[0][0].detail.message).toBe(
        "Failed to fetch options: Forbidden",
      );
      expect(mockStartRegistration).not.toHaveBeenCalled();
    });
  });
});
