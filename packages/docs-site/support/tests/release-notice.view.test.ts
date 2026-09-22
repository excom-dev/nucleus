import "@excom/content-drawer";
import "@excom/super-form";
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
import {
  flush,
  readViewFile,
} from "@excom/quark/support/tests/view-helpers";

const html = readViewFile(
  import.meta.url,
  "../../public/views/release-notice/release-notice.html",
);

const stripAssets = (s: string) => s.replace(/<link[\s\S]*?>/g, "");

/** The banner is static: no sheet, no provision — CSS drives the lifecycle. */
const mountView = () => fixture<HTMLElement>(stripAssets(html));

describe("release notice view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("is a drawer dismissed by a native command", () => {
    const page = mountView();

    expect(page.id).toBe("release-notice");
    expect(page.getAttribute("from-side")).toBe("top");
    const close = page.querySelector("button.close")!;
    expect(close.getAttribute("command")).toBe("--close");
    expect(close.getAttribute("commandfor")).toBe("release-notice");
  });

  it("posts the subscriber email to the worker", () => {
    const page = mountView();

    const form = page.querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("action")).toBe("/api/release-subscribers");
    expect(form.getAttribute("method")).toBe("post");

    const email = form.querySelector<HTMLInputElement>('[name="email"]')!;
    expect(email.getAttribute("type")).toBe("email");
    expect(email.hasAttribute("required")).toBe(true);
    // the visible control stays alone in the input group
    const group = form.querySelector("fieldset[role='group']")!;
    expect([...group.querySelectorAll("input, button")].map((f) => f.tagName)
      .join(",")).toBe("INPUT,BUTTON");
    expect(email.parentElement?.tagName).toBe("FIELDSET");
  });

  it("carries a honeypot no person can see or reach", () => {
    const page = mountView();

    const form = page.querySelector<HTMLFormElement>("form")!;
    const honeypot = form.querySelector<HTMLInputElement>('[name="website"]')!;
    expect(honeypot.getAttribute("type")).toBe("text");
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
    expect(honeypot.hasAttribute("required")).toBe(false);

    const wrapper = honeypot.closest("[data-honeypot]")!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    // inside the form, outside the input group — the row layout is untouched
    expect(wrapper.parentElement?.tagName).toBe("FORM");
    expect(wrapper.closest("form")?.getAttribute("action")).toBe(
      form.getAttribute("action"),
    );
    expect(wrapper.closest("fieldset")).toBe(null);
    // hidden by css, never by `display: none` / `hidden` — bots skip those
    expect(wrapper.hasAttribute("hidden")).toBe(false);
  });

  it("announces the outcome politely / assertively", () => {
    const page = mountView();

    expect(page.querySelector("[bind-thanks]")?.getAttribute("role")).toBe(
      "status",
    );
    expect(page.querySelector("[bind-error]")?.getAttribute("role")).toBe(
      "alert",
    );
  });

  it("sends the email plus the empty honeypot as JSON", async () => {
    const fetchSpy = spyFetch({ status: 200, body: JSON.stringify({ ok: 1 }) });
    const page = mountView();
    const form = page.querySelector<HTMLFormElement>("form")!;
    const superForm = page.querySelector<HTMLElement>("super-form")!;
    form.querySelector<HTMLInputElement>('[name="email"]')!.value =
      "ada@example.com";

    await waitForEvent(superForm, "super-form-success", () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/release-subscribers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "ada@example.com",
      website: "",
    });
    expect(superForm.hasAttribute("is-success")).toBe(true);
  });
});
