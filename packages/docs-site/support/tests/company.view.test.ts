import "@excom/spa-route";
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
  "../../public/views/company/company.html",
);

const stripAssets = (s: string) => s.replace(/<link[\s\S]*?>/g, "");

/** The view is static: no sheet, no route provision, just the fragment. */
const mountView = () => fixture<HTMLElement>(stripAssets(html));

/** Fill the form and let `super-form` intercept a real `submit`. */
const submit = async (page: HTMLElement) => {
  const form = page.querySelector<HTMLFormElement>("form")!;
  const superForm = page.querySelector<HTMLElement>("super-form")!;
  form.querySelector<HTMLInputElement>('[name="name"]')!.value = "Ada Lovelace";
  form.querySelector<HTMLInputElement>('[name="email"]')!.value =
    "ada@example.com";
  form.querySelector<HTMLTextAreaElement>('[name="message"]')!.value =
    "Are you free for a consult?";
  await waitForEvent(superForm, "super-form-success", () => {
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
  });
  await flush();
  return superForm;
};

describe("company view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders the landing copy and the excom wordmark", () => {
    const page = mountView();

    expect(page.querySelector("h1")?.textContent).toBe("Experimental · Company");
    expect(page.querySelector("h2")?.textContent).toBe(
      "Available for consulting and questions",
    );
    const logo = page.querySelector("header img")!;
    expect(logo.getAttribute("src")).toBe("/img/excom.svg");
    expect(logo.getAttribute("alt")).toBe("excom");
  });

  it("links to the Nucleus docs", () => {
    const page = mountView();

    const link = page.querySelector("nav spa-a")!;
    expect(link.getAttribute("route-href")).toBe("/nucleus");
    expect(link.getAttribute("role")).toBe("link");
    expect(link.textContent).toContain("Nucleus Stack docs");
  });

  it("posts the three required fields to the worker", () => {
    const page = mountView();

    const form = page.querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("action")).toBe("/api/contact-messages");
    expect(form.getAttribute("method")).toBe("post");
    // no `enctype`: the JSON `Content-Type` default must survive
    expect(form.hasAttribute("enctype")).toBe(false);

    // visible fields only — the honeypot lives in its own wrapper
    const fields = [
      ...form.querySelectorAll(
        ":scope > label input[name], :scope > label textarea[name]",
      ),
    ];
    expect(fields.map((f) => f.getAttribute("name"))).toEqual([
      "name",
      "email",
      "message",
    ]);
    expect(fields.every((f) => f.hasAttribute("required"))).toBe(true);
    // every control is labelled, and typed for the right keyboard
    expect(fields.every((f) => f.closest("label"))).toBe(true);
    expect(form.querySelector('[name="email"]')?.getAttribute("type")).toBe(
      "email",
    );
    expect(
      form.querySelector('[name="message"]')?.getAttribute("maxlength"),
    ).toBe("4000");
  });

  it("carries a honeypot no person can see or reach", () => {
    const page = mountView();

    const form = page.querySelector<HTMLFormElement>("form")!;
    const honeypot = form.querySelector<HTMLInputElement>('[name="website"]')!;
    expect(honeypot.getAttribute("type")).toBe("text");
    expect(honeypot.getAttribute("tabindex")).toBe("-1");
    expect(honeypot.getAttribute("autocomplete")).toBe("off");
    // never required: a person must be able to submit without it
    expect(honeypot.hasAttribute("required")).toBe(false);

    const wrapper = honeypot.closest("[data-honeypot]")!;
    expect(wrapper.getAttribute("aria-hidden")).toBe("true");
    expect(wrapper.parentElement?.tagName).toBe("FORM");
    expect(wrapper.closest("form")?.getAttribute("action")).toBe(
      form.getAttribute("action"),
    );
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

  it("sends a JSON body and swaps the form for the thanks note", async () => {
    const fetchSpy = spyFetch({ status: 200, body: JSON.stringify({ ok: 1 }) });
    const page = mountView();

    const superForm = await submit(page);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain("/api/contact-messages");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    // the untouched honeypot rides along as an empty string; the worker
    // drops the submission only when it is non-empty
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "Are you free for a consult?",
      website: "",
    });

    expect(superForm.hasAttribute("is-success")).toBe(true);
    expect(superForm.hasAttribute("is-error")).toBe(false);
  });

  it("flags a failed send without hiding the form", async () => {
    spyFetch({ status: 500, body: "nope" });
    const page = mountView();
    const form = page.querySelector<HTMLFormElement>("form")!;
    const superForm = page.querySelector<HTMLElement>("super-form")!;

    await waitForEvent(superForm, "super-form-error", () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    await flush();

    expect(superForm.hasAttribute("is-error")).toBe(true);
    expect(superForm.hasAttribute("is-success")).toBe(false);
  });
});
