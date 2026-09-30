import "@excom/content-drawer";
import "@excom/quark-sheet";
import "@excom/super-form";
import { invokeCommand } from "@excom/neutron";
import {
  afterEach,
  describe,
  expect,
  fixture,
  it,
  readFileRelative,
  spyFetch,
  vi,
  waitForEvent,
} from "@excom/nucleus-test";
import {
  flush,
  mountView as mountWithSheet,
} from "@excom/quark/support/tests/view-helpers";

const html = readFileRelative(
  import.meta.url,
  "../../public/views/release-notice/release-notice.html",
);

const stripAssets = (s: string) => s.replace(/<link[\s\S]*?>/g, "");

/** The `#release-notice { … }` rule of the shell sheet in `index.html`. */
const shellRule = () => {
  const shell = readFileRelative(import.meta.url, "../../index.html");
  const start = shell.indexOf("#release-notice {");
  let depth = 0;
  for (let i = shell.indexOf("{", start); i < shell.length; i++) {
    depth += shell[i] === "{" ? 1 : shell[i] === "}" ? -1 : 0;
    if (!depth) return shell.slice(start, i + 1);
  }
  throw new Error("index.html has no #release-notice rule");
};

/** The banner is static: no sheet, no provision — CSS drives the lifecycle. */
const mountView = () => fixture<HTMLElement>(stripAssets(html));

/** Fake-timer `flush()`: advance `ms`, then drain what the due timers queued. */
const tick = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(0);
};

describe("release notice view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.useRealTimers();
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

  it("keeps its clicks from bubbling past the banner (shell sheet)", async () => {
    const { root } = await mountWithSheet(
      `<quark-sheet>${shellRule()}</quark-sheet>${html}`,
    );
    const outside = vi.fn();
    document.addEventListener("click", outside);
    document.addEventListener("mouseup", outside);
    try {
      const inner = root.querySelector("#release-notice blockquote p")!;
      for (const type of ["mouseup", "click"]) {
        inner.dispatchEvent(new MouseEvent(type, { bubbles: true }));
      }
      expect(outside).not.toHaveBeenCalled();

      // the rest of the page still bubbles
      root.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(outside).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("click", outside);
      document.removeEventListener("mouseup", outside);
    }
  });

  // a popover toggle appends a proxy button under <body>, which re-runs the
  // whole shell sheet; an ungated `@delay` restarted and reopened the banner
  it("opens once after 3s; a sheet re-run never reopens it (shell sheet)", async () => {
    vi.useFakeTimers();
    const mounted = mountWithSheet(
      `<quark-sheet>${shellRule()}</quark-sheet>${html}`,
    );
    await tick(50);
    const { root } = await mounted;
    const notice = root.querySelector<HTMLElement>("#release-notice")!;

    await tick(2850);
    expect(notice.hasAttribute("is-open")).toBe(false);
    await tick(150);
    expect(notice.hasAttribute("is-open")).toBe(true);
    expect(notice.hasAttribute("data-did-open")).toBe(true);

    invokeCommand(notice, "--close", notice.querySelector("button.close"));
    await tick();
    expect(notice.hasAttribute("is-open")).toBe(false);

    root.append(document.createElement("button"));
    await tick(3500);
    expect(notice.hasAttribute("is-open")).toBe(false);
    expect(notice.hasAttribute("data-did-open")).toBe(true);
  });
});
