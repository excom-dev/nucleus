// Headless Chrome over the DevTools protocol, no dependencies: drive a page from a test script, or
// screenshot and probe it from the command line. Needs Google Chrome (CHROME overrides its path) and
// cannot start inside a sandbox. As a module: open(), serve(), until(), sleep(). As a command:
//
// node node_modules/@excom/nucleus-test/chrome.mjs [options] <path> [steps...]
//   --root <dir>        served, an extensionless path without a file getting index.html; default the current directory
//   --port <n>          default a free port; any served file takes ?delay=<ms>
//   --size <W>x<H>      default 390x844, under 768 wide also mobile and touch; --desktop is 1280x800
//   --dpr <n>, --dark   device scale factor (default 2 under 768 wide, else 1), prefers-color-scheme: dark
//   --profile <name>    Chrome profile in <tmpdir>/nucleus-chrome/profiles/<name>, default "default"; --reset clears it
//   --gate <selector>   after each navigation, wait up to 8 s for it
//   --settle <ms>       wait after each navigation and --do, default 800
//   --init <file>       script run in every new document, repeatable
//   --log, --requests   print every console message, every request, live
//   --disable-features <list>  passed on to Chrome
// Steps, in order: --goto <path>, --do "<js>" (evaluate, then settle), --run "<js>" (evaluate only),
// --key Enter|Space, --cdp "<Method> <json>", --wait <ms>, --shot <name> (<tmpdir>/nucleus-chrome/shots/<profile>/).
// A page call to __probeShot(name) takes a screenshot at once. Ends with the console errors and warnings,
// exceptions (page and service worker) and failed requests. Exits 1 if a step failed, 2 on bad arguments.

/* v8 ignore file -- drives a real Chrome; no test can start one */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, relative, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// Where Google Chrome usually is, by platform; Linux: the Debian / Ubuntu package (GitHub's ubuntu-latest runners)
const CHROMES = {
  darwin: () => ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: () => ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"],
  win32: (env) =>
    [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter(Boolean)
      .map((dir) => win32.join(dir, "Google", "Chrome", "Application", "chrome.exe")),
};
const WORK = join(tmpdir(), "nucleus-chrome");
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".quark": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".glb": "model/gltf-binary",
};
const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};
const FLAGS = [
  "--headless=new",
  "--remote-debugging-pipe",
  "--no-first-run",
  "--no-default-browser-check",
  "--use-mock-keychain",
  "--disable-sync",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--hide-scrollbars",
  "--mute-audio",
  "--force-color-profile=srgb",
];

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// CHROME, else the first of the platform's usual places that exists. Throws naming what it tried.
const chromePath = () => {
  const tried = process.env.CHROME ? [process.env.CHROME] : (CHROMES[process.platform]?.(process.env) ?? []);
  const found = tried.find((path) => existsSync(path));
  if (found) return found;
  const where = tried.length ? `tried ${tried.join(", ")}` : `no usual place on ${process.platform}`;
  throw new Error(`Google Chrome not found (${where}): install it, or set CHROME to its path`);
};
const clip = (text, n = 300) => {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};
const line1 = (text) => String(text).split("\n")[0];

// Resolves true once fn() is truthy, false after ms.
export const until = async (fn, ms, every = 100) => {
  for (const end = Date.now() + ms; ; await sleep(every)) {
    if (await Promise.resolve().then(fn).catch(() => false)) return true;
    if (Date.now() >= end) return false;
  }
};

// Serves root (default the current directory); an extensionless path without a file gets index.html. A
// request is first offered to intercept(url), which answers with { status, body, type } or declines.
export const serve = async ({ root = process.cwd(), port = 0, intercept } = {}) => {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body, type) => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    await sleep(Number(url.searchParams.get("delay")) || 0);
    const answer = intercept?.(url);
    if (answer) return send(answer.status, answer.body, answer.type);
    const path = join(root, normalize(decodeURIComponent(url.pathname)));
    const file = await stat(path).then(
      (found) => (found.isDirectory() ? join(path, "index.html") : path),
      () => (extname(path) ? path : join(root, "index.html")),
    );
    await readFile(file).then(
      (body) => send(200, body, TYPES[extname(file)] ?? "application/octet-stream"),
      () => send(404, `Not found: ${req.url}`, "text/plain"),
    );
  });
  await new Promise((ok, fail) => server.once("error", fail).listen(port, ok));
  return { port: server.address().port, close: () => (server.closeAllConnections(), server.close()) };
};

// Opens a page in a new headless Chrome. run(), do() and goto() throw on an exception in the page.
export const open = async (options) => {
  const chromeFile = chromePath();
  const { port, size = "390x844", dpr, dark, profile, init = [], gate } = options;
  const { shots = join(WORK, "shots", "default"), settle = 800, log, requests, disableFeatures } = options;
  const [width, height] = size.split("x").map(Number);
  const mobile = width < 768;
  const profileDir = profile ?? mkdtempSync(join(tmpdir(), "nucleus-chrome-"));
  const [pending, issues, inflight] = [new Map(), new Map(), new Map()];
  const [loaded, workers, handlers] = [new Set(), new Set(), {}];
  const issue = (text) => issues.set(text, (issues.get(text) ?? 0) + 1);
  const on = (method, fn) => (handlers[method] ??= []).push(fn);
  const onPage = (method, fn) => on(method, (params, sid) => sid === pageSid && fn(params));
  let pageSid, doc, gone = "", seq = 0, lastNet = 0, t0 = Date.now(), stderr = "", parts = [];

  const features = ["Translate", "MediaRouter", "OptimizationHints", disableFeatures].filter(Boolean).join();
  const flags = [`--disable-features=${features}`, `--user-data-dir=${profileDir}`, `--window-size=${width},${height}`];
  const stdio = ["ignore", "ignore", "pipe", "pipe", "pipe"];
  const chrome = spawn(chromeFile, [...FLAGS, ...flags, "about:blank"], { stdio });
  const exited = new Promise((ok) => chrome.once("exit", ok));
  const fail = (why) => {
    gone ||= why;
    for (const { reject, timer } of pending.values()) (clearTimeout(timer), reject(new Error(`Chrome ${gone}`)));
    pending.clear();
  };
  const lastWords = () => clip(stderr.split("\n").filter(Boolean).slice(-2).join(" | "));
  chrome.on("exit", (code, signal) => fail(`exited (${signal ?? `code ${code}`})${stderr && `: ${lastWords()}`}`));
  chrome.on("error", (error) => fail(`failed to start: ${error.message}`));
  chrome.stderr.on("data", (data) => (stderr = (stderr + data).slice(-2000)));
  chrome.stdio[3].on("error", () => {});
  // CDP over --remote-debugging-pipe: NUL-terminated JSON, fd 3 to Chrome, fd 4 from Chrome.
  chrome.stdio[4].on("data", (chunk) => {
    let start = 0;
    for (let end; (end = chunk.indexOf(0, start)) !== -1; start = end + 1) {
      const msg = JSON.parse(Buffer.concat([...parts, chunk.subarray(start, end)]).toString());
      parts = [];
      const waiting = pending.get(msg.id);
      if (!waiting) for (const fn of handlers[msg.method] ?? []) fn(msg.params, msg.sessionId);
      else {
        pending.delete(msg.id);
        clearTimeout(waiting.timer);
        if (msg.error) waiting.reject(new Error(`${waiting.method}: ${msg.error.message}`));
        else waiting.resolve(msg.result);
      }
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      if (gone) return reject(new Error(`Chrome ${gone}`));
      const id = ++seq;
      const timer = setTimeout(() => (pending.delete(id), reject(new Error(`${method} got no reply in 30 s`))), 30_000);
      pending.set(id, { method, resolve, reject, timer });
      chrome.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
    });
  const cdp = (method, params) => send(method, params, pageSid);

  const who = (sid) => (sid === pageSid ? "" : workers.has(sid) ? "[sw] " : null);
  const at = (url, line) => (url ? ` @ ${url}:${(line ?? 0) + 1}` : "");
  const stamp = () => `+${String(Date.now() - t0).padStart(5)}ms`;
  const live = (enabled, text) => enabled && console.log(`${stamp()} ${text}`);
  const excText = (d) => {
    const e = d.exception && line1(d.exception.description ?? d.exception.value);
    return clip(e && !d.text.includes(e) ? `${d.text} ${e}` : d.text);
  };
  const argText = (a) =>
    a.type === "string"
      ? a.value
      : a.preview && !a.subtype
        ? `{${a.preview.properties.map((p) => `${p.name}: ${p.value}`).join(", ")}}`
        : line1(a.unserializableValue ?? a.description ?? JSON.stringify(a.value) ?? a.type);
  // Busy: no response yet, or data within 500 ms; an unread fetch body never finishes loading.
  const busy = () => [...inflight.values()].filter((r) => !r.responded || Date.now() - r.t < 500);
  const quiet = () => until(() => !busy().length && Date.now() - lastNet >= 500, 6000, 50);
  const touch = (id, responded) =>
    inflight.has(id) && Object.assign(inflight.get(id), { t: Date.now() }, responded && { responded });
  const done = (id) => inflight.delete(id) && (lastNet = Date.now());
  const failed = (id, why) => {
    const request = inflight.get(id);
    if (request) issue(`request: ${request.method} ${clip(request.url, 200)} -> ${why}`);
  };

  on("Target.attachedToTarget", ({ sessionId, targetInfo }, sid) => {
    if (sid || targetInfo.type !== "service_worker") return;
    workers.add(sessionId);
    for (const method of ["Runtime.enable", "Log.enable"]) send(method, {}, sessionId).catch(() => {});
  });
  on("Runtime.consoleAPICalled", ({ type, args, stackTrace }, sid) => {
    if (who(sid) === null) return;
    const text = args.map(argText).join(" "), frame = stackTrace?.callFrames[0];
    const kind = { error: "console.error", assert: "console.error", warning: "console.warn" }[type];
    live(log, `${who(sid)}console.${type}: ${text}`);
    if (kind) issue(`${who(sid)}${kind}: ${clip(text)}${at(frame?.url, frame?.lineNumber)}`);
  });
  on("Runtime.exceptionThrown", ({ exceptionDetails: d }, sid) => {
    if (who(sid) === null) return;
    const frame = d.stackTrace?.callFrames[0];
    live(log, `${who(sid)}exception: ${excText(d)}`);
    issue(`${who(sid)}exception: ${excText(d)}${d.url ? at(d.url, d.lineNumber) : at(frame?.url, frame?.lineNumber)}`);
  });
  on("Log.entryAdded", ({ entry: e }, sid) => {
    if (who(sid) === null) return;
    live(log && e.source !== "console-api", `${who(sid)}log.${e.source}.${e.level}: ${e.text}`);
    if (e.source === "network" || (e.level !== "error" && e.level !== "warning")) return;
    issue(`${who(sid)}console.${e.level === "error" ? "error" : "warn"}: ${clip(e.text)}${at(e.url, e.lineNumber)}`);
  });
  onPage("Network.requestWillBeSent", ({ requestId, request: { method, url }, loaderId }) => {
    if (!url.startsWith("data:")) inflight.set(requestId, { method, url, loaderId, t: (lastNet = Date.now()) });
    live(requests, `request: ${method} ${url}`);
  });
  onPage("Network.responseReceived", ({ requestId, response }) => {
    if (response.status >= 400) failed(requestId, response.status);
    live(requests, `response: ${response.status} ${response.url}`);
    touch(requestId, true);
  });
  onPage("Network.dataReceived", ({ requestId }) => touch(requestId));
  onPage("Network.loadingFinished", ({ requestId }) => done(requestId));
  onPage("Network.loadingFailed", ({ requestId, errorText, canceled, blockedReason }) => {
    const why = `${errorText}${blockedReason ? ` (${blockedReason})` : ""}`;
    live(requests, `failed: ${inflight.get(requestId)?.url} -> ${why}${canceled ? " (canceled)" : ""}`);
    if (!canceled) failed(requestId, why);
    done(requestId);
  });
  onPage("Page.frameNavigated", ({ frame }) => {
    if (frame.parentId) return;
    doc = frame.loaderId;
    for (const [id, r] of inflight) if (r.loaderId !== doc) done(id);
  });
  onPage("Page.lifecycleEvent", ({ name, loaderId }) => name === "load" && loaded.add(loaderId));
  onPage("Inspector.targetCrashed", () => fail("page crashed"));
  onPage("Page.javascriptDialogOpening", () => cdp("Page.handleJavaScriptDialog", { accept: true }).catch(() => {}));
  onPage("Runtime.bindingCalled", async ({ name, payload }) => {
    if (name !== "__probeShot") return;
    try {
      const file = await shot(payload);
      console.log(`binding shot ${payload}: ${file} (scrollY ${await run("Math.round(scrollY)")})`);
      await run(`window.__probe?.shotDone?.(${JSON.stringify(payload)})`);
    } catch (error) {
      console.log(`binding shot ${payload} failed: ${error.message}`);
    }
  });

  // A function runs with JSON arguments; a string runs as console input, top-level await included.
  const run = async (code, ...args) => {
    const isFunction = typeof code === "function";
    const expression = isFunction ? `(${code})(${args.map((a) => JSON.stringify(a)).join(", ")})` : code;
    const check = (r) => (r.exceptionDetails ? Promise.reject(new Error(excText(r.exceptionDetails))) : r.result);
    const flags = { awaitPromise: true, userGesture: true, replMode: !isFunction, returnByValue: isFunction };
    const result = await check(await cdp("Runtime.evaluate", { expression, ...flags }));
    const { objectId } = result;
    // replMode awaits top-level await only; a promise left as the value is awaited here.
    if (result.subtype === "promise") {
      return (await check(await cdp("Runtime.awaitPromise", { promiseObjectId: objectId, returnByValue: true }))).value;
    }
    if (!objectId) return result.value;
    const self = { objectId, functionDeclaration: "function () { return this; }", returnByValue: true };
    return (await cdp("Runtime.callFunctionOn", self)).result.value;
  };
  const ready = async () => {
    await until(() => loaded.has(doc), 30_000, 50);
    if (gate) await until(() => run((selector) => !!document.querySelector(selector), gate), 8000);
    await quiet();
    await sleep(settle);
  };
  const goto = async (path) => {
    t0 = Date.now();
    const url = /^[a-z][\w+.-]*:/i.test(path) ? path : `http://localhost:${port}${path}`;
    const r = await cdp("Page.navigate", { url });
    if (r.errorText) throw new Error(`could not load ${path}: ${r.errorText}`);
    doc = r.loaderId ?? doc;
    await ready();
  };
  // Waits as after a navigation when the step caused one.
  const after = async (step) => {
    const before = doc;
    const value = await step();
    await sleep(settle);
    await (doc === before ? quiet() : ready());
    return value;
  };
  const shot = async (name) => {
    const file = join(shots, `${name.replace(/[^\w.-]+/g, "_")}.png`);
    mkdirSync(shots, { recursive: true });
    writeFileSync(file, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));
    return file;
  };
  const key = (name) =>
    after(async () => {
      await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...KEYS[name] });
      await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...KEYS[name], text: undefined });
    });
  const close = async () => {
    await send("Browser.close").catch(() => chrome.kill());
    await Promise.race([exited, sleep(5000)]);
    chrome.kill("SIGKILL");
    if (!profile) rmSync(profileDir, { recursive: true, force: true });
  };

  const scale = dpr ?? (mobile ? 2 : 1);
  const metrics = { width, height, screenWidth: width, screenHeight: height, mobile, deviceScaleFactor: scale };
  const filter = [{ type: "service_worker" }];
  await send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  ({ sessionId: pageSid } = await send("Target.attachToTarget", { targetId, flatten: true }));
  for (const domain of ["Page", "Runtime", "Network", "Log", "Inspector"]) await cdp(`${domain}.enable`);
  await cdp("Page.setLifecycleEventsEnabled", { enabled: true });
  await cdp("Runtime.addBinding", { name: "__probeShot" });
  await cdp("Emulation.setDeviceMetricsOverride", metrics);
  if (mobile) await cdp("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const scheme = { name: "prefers-color-scheme", value: dark ? "dark" : "light" };
  await cdp("Emulation.setEmulatedMedia", { features: [scheme] });
  for (const source of init) await cdp("Page.addScriptToEvaluateOnNewDocument", { source });

  return {
    goto,
    run,
    do: (code, ...args) => after(() => run(code, ...args)),
    key,
    cdp,
    shot,
    close,
    // Returns and forgets the issues seen so far, repeats counted.
    issues: () => {
      const list = [...issues].map(([text, n]) => (n > 1 ? `${text} (x${n})` : text));
      issues.clear();
      return list;
    },
  };
};

if (import.meta.main) {
  const bad = (message) => {
    console.error(`error: ${message}`);
    process.exit(2);
  };
  const STEPS = ["goto", "do", "run", "key", "cdp", "wait", "shot"];
  const text = { type: "string" }, flag = { type: "boolean" };
  const options = {
    ...Object.fromEntries(["help", "desktop", "dark", "reset", "log", "requests"].map((name) => [name, flag])),
    ...Object.fromEntries(["root", "port", "size", "dpr", "gate", "settle", "disable-features"].map((n) => [n, text])),
    ...Object.fromEntries(["init", ...STEPS].map((name) => [name, { ...text, multiple: true }])),
    profile: { ...text, default: "default" },
  };
  const { values: o, positionals, tokens } = (() => {
    try {
      return parseArgs({ allowPositionals: true, tokens: true, options });
    } catch (error) {
      bad(error.message);
    }
  })();
  if (o.help) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").match(/^(\/\/.*\n)+/)[0].replace(/^\/\/ ?/gm, ""));
    process.exit(0);
  }
  const num = (value, name) =>
    value === undefined || /^\d+(\.\d+)?$/.test(value) ? value && Number(value) : bad(`--${name} needs a number`);
  const size = o.desktop ? "1280x800" : (o.size ?? "390x844");
  if (positionals.length !== 1) bad("expected one <path>");
  if (!/^\d+x\d+$/.test(size)) bad("--size needs <W>x<H>");
  if (!/^[\w-][\w.-]*$/.test(o.profile)) bad("--profile may use letters, digits, _, - and .");
  if (tokens.some((t) => t.name === "key" && !KEYS[t.value])) bad(`--key takes ${Object.keys(KEYS).join(" or ")}`);
  const root = resolve(o.root ?? ".");
  const profile = join(WORK, "profiles", o.profile);
  if (o.reset) rmSync(profile, { recursive: true, force: true });
  mkdirSync(profile, { recursive: true });
  const server = await serve({ root, port: num(o.port, "port") });
  const out = (label, value) => console.log(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  let code = 0, page;
  try {
    const init = (o.init ?? []).map((file) => readFileSync(file, "utf8"));
    const numbers = { dpr: num(o.dpr, "dpr"), settle: num(o.settle, "settle"), port: server.port };
    const shots = join(WORK, "shots", o.profile);
    page = await open({ ...o, ...numbers, size, profile, shots, init, disableFeatures: o["disable-features"] });
    console.log(`open ${positionals[0]} on port ${server.port} | ${size} | ${relative(process.cwd(), root) || "."}`);
    await page.goto(positionals[0]);
    let n = 0;
    for (const { name, value } of tokens.filter((t) => t.kind === "option" && STEPS.includes(t.name))) {
      try {
        if (name === "goto") await page.goto(value);
        else if (name === "do") out(`do[${++n}]`, await page.do(value));
        else if (name === "run") out(`run[${++n}]`, await page.run(value));
        else if (name === "key") await page.key(value);
        else if (name === "wait") await sleep(num(value, "wait"));
        else if (name === "shot") console.log(await page.shot(value));
        else {
          const [, method, json] = value.match(/^(\S+)\s*(.*)$/s);
          out(`cdp[${++n}] ${method}`, await page.cdp(method, json ? JSON.parse(json) : {}));
        }
      } catch (error) {
        code = 1;
        console.log(`error: --${name} ${clip(value, 80)}: ${error.message}`);
      }
    }
  } catch (error) {
    code = 1;
    console.log(`error: ${error.message}`);
  }
  const issues = page?.issues() ?? [];
  const count = issues.length ? `${issues.length} issue(s)` : "no issues";
  console.log(`--- ${count}: console errors and warnings, exceptions, failed requests ---`);
  for (const text of issues) console.log(text);
  await page?.close();
  server.close();
  process.exit(code);
}
