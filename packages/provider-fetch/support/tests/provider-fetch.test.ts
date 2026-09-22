import { invokeCommand } from "@excom/neutron";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  spyFetch,
  vi,
  waitForEvent,
} from "@excom/heft-rig/profiles/default/config/test-utils";
import { KitLogger } from "@excom/kit-logger";
import "../../index";

const fetchStubs = {
  success: () => ({
    status: 200,
    body: JSON.stringify({ foo: "bar" }),
  }),
  error: () => ({
    status: 500,
    body: JSON.stringify({ error: "bar" }),
  }),
};

describe("provider-fetch", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("sets state attributes and fetches data", async () => {
    const providerFetch = fixture<HTMLProviderFetchElement>(
      `<provider-fetch></provider-fetch>`,
    );
    const fetchSpy = spyFetch(fetchStubs.success() as any);

    providerFetch.addEventListener("provider-fetch-loading", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/test" is-loading></provider-fetch>`,
      );
      expect(providerFetch.provision).toEqual(null);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        }),
      );
    });

    providerFetch.addEventListener("provider-fetch-success", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/test" is-success></provider-fetch>`,
      );
      expect(providerFetch.provision?.body).toEqual({ foo: "bar" });
    });

    await waitForEvent(providerFetch, "provider-fetch-success", () => {
      providerFetch.setAttribute("api-url", "/api/test");
    });
    expect.assertions(5);
  });

  it("sets state attributes and fetches data with formRef", async () => {
    const providerFetch = fixture<HTMLProviderFetchElement>(
      `<provider-fetch form-ref="form" api-method="post">
        <form>
          <input type="text" name="name" value="John Doe">
          <input type="email" name="email" value="j@doe.com">
          <input type="number" name="age" value="50">
          <input type="range" name="volume" min="0" max="100" value="20">
          <input type="tel" name="phone" value="123-456-7890">
          <input type="url" name="website" value="https://example.com">
        </form>
      </provider-fetch>`,
    );
    const fetchSpy = spyFetch(fetchStubs.success() as any);

    providerFetch.addEventListener("provider-fetch-loading", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch is-loading form-ref="form" api-method="post" api-url="/api/test"></provider-fetch>`,
      );
      expect(providerFetch.provision).toEqual(null);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: expect.toSatisfy((body: string) => {
            expect(JSON.parse(body)).toEqual(
              expect.objectContaining({
                name: "John Doe",
                email: "j@doe.com",
                age: 50,
                volume: 20,
                phone: "123-456-7890",
                website: "https://example.com",
              }),
            );
            return true;
          }),
        }),
      );
    });

    providerFetch.addEventListener("provider-fetch-success", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch is-success form-ref="form" api-method="post" api-url="/api/test"></provider-fetch>`,
      );
      expect(providerFetch.provision?.body).toEqual({ foo: "bar" });
    });

    await waitForEvent(providerFetch, "provider-fetch-success", () => {
      providerFetch.setAttribute("api-url", "/api/test");
    });
    expect.assertions(6);
  });

  it("handles fetch error", async () => {
    const providerFetch = fixture<HTMLProviderFetchElement>(
      `<provider-fetch></provider-fetch>`,
    );
    const fetchSpy = spyFetch(fetchStubs.error as any);

    KitLogger.suppress();
    providerFetch.addEventListener("provider-fetch-loading", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/test" is-loading></provider-fetch>`,
      );
      expect(providerFetch.provision).toEqual(null);
      expect(fetchSpy).toHaveBeenCalledWith(
        "http://localhost:3000/api/test",
        expect.objectContaining({
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
        }),
      );
    });

    providerFetch.addEventListener("provider-fetch-error", () => {
      KitLogger.unsuppress();
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/test" is-error></provider-fetch>`,
      );
      expect(providerFetch.provision?.body).toEqual({ error: "bar" });
    });

    await waitForEvent(providerFetch, "provider-fetch-error", () => {
      providerFetch.setAttribute("api-url", "/api/test");
    });
    expect.assertions(5);
  });

  it("interpolates params from its own attributes", async () => {
    const providerFetch = fixture<HTMLProviderFetchElement>(
      `<provider-fetch></provider-fetch>`,
    );
    const fetchSpy = spyFetch(fetchStubs.success as any);

    providerFetch.addEventListener("provider-fetch-loading", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/users/123" is-loading></provider-fetch>`,
      );
      expect(providerFetch.provision).toEqual(null);
    });

    providerFetch.addEventListener("provider-fetch-success", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/users/123" is-success></provider-fetch>`,
      );
      expect(providerFetch.provision?.body).toEqual({ foo: "bar" });
      const calledUrl = fetchSpy.mock.calls[0][0] as string;
      expect(calledUrl).toBe("http://localhost:3000/api/users/123");
    });

    await waitForEvent(providerFetch, "provider-fetch-success", () => {
      providerFetch.setAttribute("api-url", "/api/users/123");
    });
    expect.assertions(5);
  });

  it("aborts existing fetch when new one is triggered", async () => {
    const providerFetch = fixture<HTMLProviderFetchElement>(
      `<provider-fetch></provider-fetch>`,
    );
    spyFetch(fetchStubs.success as any);

    providerFetch.addEventListener("provider-fetch-loading", () => {
      expect(providerFetch).dom.to.equalTag(
        `<provider-fetch api-url="/api/test" is-loading></provider-fetch>`,
      );
    });
    let secondFetch = false;
    providerFetch.addEventListener("provider-fetch-success", () => {
      expect(secondFetch).toBe(true);
    });
    await waitForEvent(providerFetch, "provider-fetch-success", () => {
      providerFetch.setAttribute("api-url", "/api/test");
      secondFetch = true;
      invokeCommand(providerFetch, "--fetch");
    });
    expect.assertions(3);
  });
});
