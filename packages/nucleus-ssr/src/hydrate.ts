import { inertDom } from "./inert";
import { EXPIRED, within } from "./node";
import {
  type DomWindow,
  resetDocument,
  type ServedRequest,
  whenIdle,
} from "@excom/nucleus-dom";

/** What hydrating a prerendered page changed. Every list empty: a no-op. */
export interface HydrationReport {
  /** Nodes removed after the page loaded: `<parent path> > <node>`. */
  removed: string[];
  /** Nodes added after the page loaded: `<parent path> > <node>`. */
  added: string[];
  /** Attributes whose final value differs from the server's markup (`null`: absent). */
  attributes: {
    element: string;
    name: string;
    server: string | null;
    final: string | null;
  }[];
  /** Attributes written after load that end with the server's value: same-value rewrites, flips that came back. */
  rewrites: {
    element: string;
    name: string;
    value: string | null;
    writes: number;
  }[];
  /** Text nodes changed in place after load, whose final text differs from the server's. */
  texts: { node: string; server: string; final: string }[];
  /**
   * Server markup missing between two tasks, though back by the end: what a
   * browser could paint while the page hydrates, e.g. content gated on
   * `[did-load]` blinking, upgrades included. `<path> without [attribute]`,
   * or `<parent path> without <node>`; once each. A removal undone within one
   * task, or by the frame callbacks due by then, never paints: not one.
   */
  flashes: string[];
  /**
   * Elements kept out of the prerender, as served, which mount as on a cold
   * load: each outermost `no-ssr` region, whose nodes, texts and attributes
   * are in no other list, and each instance of a Neutron tag with `ssr:
   * false` outside one, whose own attributes are in no other list.
   */
  keptOut: string[];
  /** The window's requests since the call, in order. */
  requests: ServedRequest[];
  /** How long (ms) the hydration window stayed open; `0` when the page opened none. */
  windowMs: number;
}

type Context = { request: Request; response: Response };
// a Neutron element's class
type Configured = { getConfig?(): { ssr?: boolean } | undefined };
/** How an element stays out of the prerender: `"region"` (`no-ssr`: it and what it holds), `"self"` (a tag's `ssr: false`: its own code). */
type KeptOut = "region" | "self";
type Interceptor = Record<string, unknown> & {
  beforeAsyncRequest?(context: Context): Promise<Response | undefined>;
  afterAsyncResponse?(context: Context): Promise<Response | undefined>;
};

// loaded at call time, as `./node` loads built-ins: the build targets browsers
declare const process: {
  getBuiltinModule(id: "node:async_hooks"): {
    createHook(callbacks: {
      init(asyncId: number, type: string): void;
      before(asyncId: number): void;
    }): { enable(): { disable(): void } };
  };
};

// change by design: kit-utils' momentary `:scope` tag, Quark's host id
const IGNORED = /^(n-util-select-id-|q-scope$)/;

// Node runs these inside a task, after its callback, before the next task
const MICROTASKS = ["PROMISE", "Microtask", "TickObject"];

/** One step of a path: `#id` when it has one, `ul:nth-of-type(2)` when a sibling shares the tag. */
const step = (element: Element): string => {
  const { localName, id, parentElement } = element;
  if (id) return `${localName}#${id}`;
  const same = Array.from(parentElement?.children ?? []).filter(
    (sibling) => sibling.localName === localName
  );
  return same.length > 1
    ? `${localName}:nth-of-type(${same.indexOf(element) + 1})`
    : localName;
};

/** Where `element` is, below `<html>`: `body > ul:nth-of-type(2) > li`. */
const pathTo = (element: Element | null): string[] =>
  !element || element === element.ownerDocument.documentElement
    ? []
    : [...pathTo(element.parentElement), step(element)];

/** A node in a path: an element's step, a text quoted, else its name. */
const label = (node: Node): string =>
  node.nodeType === 1
    ? step(node as Element)
    : node.nodeType === 3
      ? JSON.stringify(node.textContent!.slice(0, 40))
      : node.nodeName;

const where = (parent: Element | null, node: Node) =>
  [...pathTo(parent), label(node)].join(" > ");

/**
 * Each live element with its twin in the server's markup: same tag, same
 * place, from `<html>` down while a parent's children line up.
 */
const twins = (
  live: Element,
  server: Element,
  pairs = new Map<Element, Element>()
): Map<Element, Element> => {
  pairs.set(live, server);
  if (live.children.length === server.children.length)
    Array.from(live.children).forEach((child, i) => {
      const twin = server.children[i];
      if (twin.localName === child.localName) twins(child, twin, pairs);
    });
  return pairs;
};

/**
 * The elements kept out of the prerender, found once the page parsed
 * (`scan()`); they mount in the browser only. `of(node)`: whose change at
 * `node` is theirs, by where `node` is: in a region (or detached from one:
 * `track(records)` notes removals first), or a `"self"` element's own.
 */
const watchKeptOut = (window: DomWindow, noSsrAttr: string) => {
  const { document, customElements } = window;
  const regions = new Set<Node>();
  const selves = new Set<Node>();
  // removed from a region, last: where a detached node was
  const left = new WeakSet<Node>();
  const listed: string[] = [];
  const keptOutAs = (element: Element): KeptOut | undefined =>
    element.hasAttribute(noSsrAttr)
      ? "region"
      : (
            customElements.get(element.localName) as Configured | undefined
          )?.getConfig?.()?.ssr === false
        ? "self"
        : undefined;
  const inRegion = (node: Node): boolean =>
    regions.has(node) ||
    (node.parentNode ? inRegion(node.parentNode) : left.has(node));
  return {
    listed,
    of: (node: Node): KeptOut | undefined =>
      inRegion(node) ? "region" : selves.has(node) ? "self" : undefined,
    scan: () =>
      document.querySelectorAll("*").forEach((element) => {
        const as = keptOutAs(element);
        // a region covers what it holds
        if (!as || inRegion(element)) return;
        (as === "region" ? regions : selves).add(element);
        listed.push(pathTo(element).join(" > "));
      }),
    track: (records: MutationRecord[]) =>
      records.forEach(({ target, removedNodes }) =>
        removedNodes.forEach((node) => {
          if (inRegion(target)) left.add(node);
          else left.delete(node);
        })
      ),
  };
};

/** Logs the window's requests through its fetch interceptor (`serve()`'s), until stopped. */
const logRequests = (window: DomWindow) => {
  const settings = (
    window as unknown as {
      happyDOM: { settings: { fetch: { interceptor: Interceptor | null } } };
    }
  ).happyDOM.settings.fetch;
  const inner = settings.interceptor;
  const requests: ServedRequest[] = [];
  // passed on by the interceptor: the response comes back to `afterAsyncResponse`
  const waiting = new WeakMap<Request, ServedRequest>();
  settings.interceptor = {
    ...inner,
    async beforeAsyncRequest(context) {
      const { method, url } = context.request;
      const entry = { method, url, status: 0 };
      requests.push(entry);
      const answer = await inner?.beforeAsyncRequest?.(context);
      if (answer) entry.status = answer.status;
      else waiting.set(context.request, entry);
      return answer;
    },
    async afterAsyncResponse(context) {
      const answer = await inner?.afterAsyncResponse?.(context);
      // a request that began before this log did is not in it
      const entry = waiting.get(context.request);
      if (entry) entry.status = context.response.status;
      return answer;
    },
  };
  return {
    requests,
    stop: () => {
      settings.interceptor = inner;
    },
  };
};

/**
 * Records node, attribute and text changes once the page parsed. Call
 * `start()` right before the parse and `parsed()` right after it, before its
 * elements upgrade: what follows is the page's doing.
 */
const recordChanges = (
  window: DomWindow,
  keptOut: ReturnType<typeof watchKeptOut>
) => {
  const removed: string[] = [];
  const added: string[] = [];
  const writes = new Map<Element, Map<string, number>>();
  const texts = new Map<Node, { node: string; server: string }>();
  const take = (records: MutationRecord[]) => {
    keptOut.track(records);
    for (const record of records) {
      const { type, target, attributeName, oldValue } = record;
      // a region's nodes and texts change as it mounts
      if (type !== "attributes" && keptOut.of(target) === "region") continue;
      if (type === "childList") {
        const parent = target as Element;
        removed.push(
          ...Array.from(record.removedNodes, (node) => where(parent, node))
        );
        added.push(
          ...Array.from(record.addedNodes, (node) => where(parent, node))
        );
      } else if (type === "attributes") {
        const element = target as Element;
        const names = writes.get(element) ?? new Map<string, number>();
        writes.set(
          element,
          names.set(attributeName!, (names.get(attributeName!) ?? 0) + 1)
        );
      } else if (!texts.has(target)) {
        texts.set(target, {
          node: where(target.parentElement, target),
          server: oldValue!,
        });
      }
    }
  };
  const observer = new window.MutationObserver(take);
  return {
    start: () =>
      observer.observe(window.document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true,
        characterDataOldValue: true,
      }),
    parsed: () => {
      observer.takeRecords();
    },
    stop: () => {
      const records = observer.takeRecords();
      if (records.length) take(records);
      observer.disconnect();
      return { removed, added, writes, texts };
    },
  };
};

/**
 * Calls `boundary` before each Node task (timer, immediate, I/O callback)
 * created from now on: between two tasks, after the first one's microtasks.
 * Node's own hooks, not the window's timers, which `whenIdle()` would wait
 * on. The stop function gives what `boundary` threw, if it did.
 */
const beforeEachTask = (boundary: () => void) => {
  const tasks = new Set<number>();
  let failure: { error: unknown } | undefined;
  const hook = process
    .getBuiltinModule("node:async_hooks")
    .createHook({
      init: (asyncId, type) => {
        if (!MICROTASKS.includes(type)) tasks.add(asyncId);
      },
      // a throw in a hook ends the process: kept for the caller
      before: (asyncId) => {
        if (!tasks.has(asyncId) || failure) return;
        try {
          boundary();
        } catch (error) {
          failure = { error };
        }
      },
    })
    .enable();
  return () => {
    hook.disable();
    return failure;
  };
};

/**
 * Sets `window[name]`, and the global the page calls (the window's), until
 * the returned function restores both. The global is a plain property
 * meanwhile: an assignment to it, as Vitest's around each RPC (it saves and
 * restores `setTimeout`), neither hides the patch nor outlives it.
 */
const patch = <K extends keyof DomWindow>(
  window: DomWindow,
  name: K,
  value: DomWindow[K]
) => {
  const own = Object.getOwnPropertyDescriptor(window, name);
  const global = Object.getOwnPropertyDescriptor(globalThis, name);
  window[name] = value;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (own) Object.defineProperty(window, name, own);
    else delete window[name];
    if (global) Object.defineProperty(globalThis, name, global);
    else Reflect.deleteProperty(globalThis, name);
  };
};

/**
 * Gives each 0 ms timeout of `window` its own task, as browsers do: happy-dom
 * runs every one due in a single task, their microtasks after the last. A
 * 1 ms timer is Node's shortest anyway. Returns the restore function.
 */
const splitTimeouts = (window: DomWindow) => {
  const { setTimeout } = window;
  return patch(window, "setTimeout", ((
    handler: TimerHandler,
    delay?: number,
    ...args
  ) =>
    setTimeout.call(
      window,
      handler,
      Number(delay) > 0 ? delay : 1,
      ...args
    )) as typeof setTimeout);
};

/**
 * Tracks `window`'s animation frames: a browser runs the callbacks due before
 * it paints, so no paint falls between a task and the frame it asked for
 * (happy-dom runs each as a task of its own). `paintable()` at each task
 * boundary: whether a paint could come now. Callbacks asked for during a
 * frame wait for the next one, a paint between.
 */
const watchFrames = (window: DomWindow) => {
  const { requestAnimationFrame, cancelAnimationFrame } = window;
  const pending = new Set<unknown>();
  // the callbacks of the frame in progress
  let frame: Set<unknown> | null = null;
  const done = (handle: unknown) => {
    pending.delete(handle);
    frame?.delete(handle);
  };
  const restore = [
    patch(window, "requestAnimationFrame", (callback) => {
      const handle = requestAnimationFrame.call(window, (time: number) => {
        done(handle);
        callback(time);
      });
      pending.add(handle);
      return handle;
    }),
    patch(window, "cancelAnimationFrame", (handle) => {
      done(handle);
      cancelAnimationFrame.call(window, handle);
    }),
  ];
  return {
    paintable: () => {
      // a frame whose callbacks are still to run
      if (frame?.size) return false;
      // callbacks due: a frame runs them before it paints
      if (!frame && pending.size) {
        frame = new Set(pending);
        return false;
      }
      // after a frame, or none due
      frame = null;
      return true;
    },
    restore: () => restore.forEach((undo) => undo()),
  };
};

/**
 * Runs `parsed` once `resetDocument()` has parsed the page into `root`
 * (nucleus-dom sets `root.innerHTML`), before the page's elements upgrade:
 * the page as served, which their constructors and callbacks may change.
 * Returns the restore function, for a parse that never came.
 */
const afterParse = (root: Element, parsed: () => void) => {
  let owner = Object.getPrototypeOf(root);
  while (!Object.hasOwn(owner, "innerHTML"))
    owner = Object.getPrototypeOf(owner);
  const { get, set } = Object.getOwnPropertyDescriptor(owner, "innerHTML")!;
  const restore = () => {
    delete (root as { innerHTML?: string }).innerHTML;
  };
  Object.defineProperty(root, "innerHTML", {
    configurable: true,
    get,
    set: (html: string) => {
      restore();
      set!.call(root, html);
      parsed();
    },
  });
  return restore;
};

/**
 * Server markup missing at task boundaries. `start()` right before the parse,
 * `parsed()` right after it: the page as served (claimed `n-ssr` ids aside),
 * before its elements upgrade. `sample()` at each boundary notes the served
 * attributes and nodes gone then; `stop()` lists those back by the end: one
 * still gone is a change the other lists report.
 */
const watchFlashes = (
  window: DomWindow,
  ssrAttr: string,
  keptOut: ReturnType<typeof watchKeptOut>
) => {
  const { document } = window;
  // the page as served: each element's attributes, each node's parent
  const served = new Map<Element, Map<string, string>>();
  const parents = new Map<Node, Node>();
  // touched since the last boundary, or still gone at it
  const touched = new Map<Element, Set<string>>();
  const removed = new Set<Node>();
  // gone at a boundary, in order: a node, or an element's attribute
  const gone = new Map<Node, Set<string | null>>();
  const note = (node: Node, name: string | null) =>
    gone.set(node, (gone.get(node) ?? new Set()).add(name));
  const snapshot = () => {
    const walker = document.createTreeWalker(
      document.documentElement,
      window.NodeFilter.SHOW_ALL
    );
    for (let node: Node | null = walker.currentNode; node; ) {
      parents.set(node, node.parentNode!);
      if (node.nodeType === 1)
        served.set(
          node as Element,
          new Map(
            Array.from((node as Element).attributes)
              .filter(({ name }) => !IGNORED.test(name) && name !== ssrAttr)
              .map(({ name, value }) => [name, value])
          )
        );
      node = walker.nextNode();
    }
  };
  const take = (records: MutationRecord[]) => {
    keptOut.track(records);
    for (const { type, target, attributeName, removedNodes } of records) {
      // kept out: a region's markup, a `"self"` element's attributes
      const as = keptOut.of(target);
      if (
        type === "attributes" &&
        !as &&
        served.get(target as Element)?.has(attributeName!)
      )
        touched.set(
          target as Element,
          (touched.get(target as Element) ?? new Set()).add(attributeName!)
        );
      if (as !== "region")
        removedNodes.forEach((node) => parents.has(node) && removed.add(node));
    }
  };
  const observer = new window.MutationObserver(take);
  return {
    start: () =>
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
      }),
    parsed: () => {
      observer.takeRecords();
      snapshot();
    },
    sample: () => {
      take(observer.takeRecords());
      touched.forEach((names, element) => {
        names.forEach((name) => {
          if (element.hasAttribute(name)) names.delete(name);
          else note(element, name);
        });
        if (!names.size) touched.delete(element);
      });
      removed.forEach((node) => {
        if (node.isConnected) removed.delete(node);
        // the topmost gone: its served parent is still on the page
        else if (parents.get(node)!.isConnected) note(node, null);
      });
    },
    stop: (): string[] => {
      observer.disconnect();
      // an empty path is the root
      const at = (element: Element | null) =>
        pathTo(element).join(" > ") || "html";
      const lines = Array.from(gone).flatMap(([node, names]) =>
        !node.isConnected
          ? []
          : Array.from(names)
              .filter(
                (name) =>
                  name === null ||
                  (node as Element).getAttribute(name) ===
                    served.get(node as Element)!.get(name)
              )
              .map((name) =>
                name === null
                  ? `${at(node.parentElement)} without ${label(node)}`
                  : `${at(node as Element)} without [${name}]`
              )
      );
      return [...new Set(lines)];
    },
  };
};

/** The hydrated document against the server's markup (`server`), attribute by attribute. */
const compare = (
  live: Document,
  server: Document,
  ssrAttr: string,
  {
    removed,
    added,
    writes,
    texts,
  }: ReturnType<ReturnType<typeof recordChanges>["stop"]>,
  keptOut: (node: Node) => KeptOut | undefined
) => {
  // a claimed provision drops its `n-ssr`
  const kept = (name: string, final: string | null) =>
    !IGNORED.test(name) && !(name === ssrAttr && final === null);
  const values = Array.from(
    twins(live.documentElement, server.documentElement)
  ).flatMap(([element, twin]) => {
    // a kept-out element's attributes change as it mounts
    if (keptOut(element)) return [];
    const written = writes.get(element);
    const names = new Set([
      ...element.getAttributeNames(),
      ...twin.getAttributeNames(),
      ...(written?.keys() ?? []),
    ]);
    return Array.from(names, (name) => ({
      element,
      name,
      server: twin.getAttribute(name),
      final: element.getAttribute(name),
      writes: written?.get(name) ?? 0,
    })).filter(({ name, final }) => kept(name, final));
  });
  const at = (element: Element) => pathTo(element).join(" > ");
  return {
    removed,
    added,
    attributes: values
      .filter(({ server, final }) => final !== server)
      .map(({ element, name, server, final }) => ({
        element: at(element),
        name,
        server,
        final,
      })),
    rewrites: values
      .filter(({ server, final, writes }) => final === server && writes)
      .map(({ element, name, final, writes }) => ({
        element: at(element),
        name,
        value: final,
        writes,
      })),
    texts: Array.from(texts, ([node, seen]) => ({
      ...seen,
      final: node.textContent!,
    })).filter(({ server, final }) => final !== server),
  };
};

/**
 * Loads prerendered `html` into `window` as a browser loads the page, then
 * reports what hydrating it changed: assert "hydration is a no-op" on
 * happy-dom (`removed`, `added`, `attributes` and `texts` empty) and "nothing
 * the server painted blinked" (`flashes` empty). Elements kept out of the
 * prerender mount as on a cold load: listed in `keptOut`, what they change
 * in no other list. The markup and its island parse while
 * `document.readyState` is `"loading"`, so first mounts wait as they do for
 * a parsed document; `DOMContentLoaded` then boots the island. Resolves once
 * the hydration window closed and the window is idle; each wait gives up
 * after `timeout` ms.
 *
 * The kit's hydration state and fetch caches start afresh, as on a page
 * load; reset other module state in `beforeParse`, e.g. `resetRouter(url)`.
 * `url` defaults to the window's. Each 0 ms `setTimeout` gets its own task,
 * as in browsers, unless `splitTimeouts` is `false` (happy-dom's default:
 * one task for all due). Needs the window's globals: a renderer's window, or
 * one passed to `installGlobals`.
 */
export async function hydrate(
  window: DomWindow,
  html: string,
  {
    url = window.location.href,
    beforeParse,
    timeout = 5000,
    splitTimeouts: split = true,
  }: {
    url?: string;
    beforeParse?: () => unknown;
    timeout?: number;
    splitTimeouts?: boolean;
  } = {}
): Promise<HydrationReport> {
  const { document } = window;
  if (globalThis.document !== document)
    throw new Error(
      "nucleus-ssr: hydrate needs the window's globals (installGlobals(window))"
    );
  // browser code: loaded once the window's globals are in place
  const kit = await import("@excom/kit-utils");
  // what undoes each setup step, run newest first whatever happens
  const undo: (() => unknown)[] = [];
  let stopSampling: ReturnType<typeof beforeEachTask> | undefined;
  let parsed = false;
  try {
    // the server's markup, parsed where no element is defined: nothing upgrades
    const server = inertDom(html);
    undo.push(() => server.dispose());
    const log = logRequests(window);
    undo.push(log.stop);
    const keptOut = watchKeptOut(window, kit.NO_SSR_ATTR);
    const changes = recordChanges(window, keptOut);
    undo.push(changes.stop);
    const missing = watchFlashes(window, kit.SSR_ATTR, keptOut);
    undo.push(missing.stop);
    try {
      await resetDocument(window, {
        url,
        html,
        beforeParse: async () => {
          kit.resetHydration();
          kit.clearFetchCaches();
          await beforeParse?.();
          // a document being parsed: first mounts wait for its island
          Object.defineProperty(document, "readyState", {
            configurable: true,
            get: () => "loading",
          });
          changes.start();
          missing.start();
          undo.push(
            afterParse(document.documentElement, () => {
              parsed = true;
              keptOut.scan();
              changes.parsed();
              missing.parsed();
            })
          );
          if (split) undo.push(splitTimeouts(window));
          const frames = watchFrames(window);
          undo.push(frames.restore);
          // every task the page queues from now on
          stopSampling = beforeEachTask(
            () => frames.paintable() && missing.sample()
          );
          undo.push(stopSampling);
        },
      });
    } finally {
      delete (document as { readyState?: unknown }).readyState;
    }
    // the page as served is the parse's result, before any upgrade
    if (!parsed)
      throw new Error(
        "nucleus-ssr: hydrate saw no parse (nucleus-dom's resetDocument sets documentElement.innerHTML)"
      );
    const loaded = Date.now();
    document.dispatchEvent(
      new window.Event("DOMContentLoaded", { bubbles: true })
    );
    const hydrated = kit.whenHydrated();
    const opened = kit.isHydrating();
    if ((await within(hydrated, timeout)) === EXPIRED)
      throw new Error(
        `nucleus-ssr: the hydration window stayed open past ${timeout} ms`
      );
    const windowMs = opened ? Date.now() - loaded : 0;
    await whenIdle(window, { timeout });
    const failure = stopSampling!();
    if (failure) throw failure.error;
    return {
      ...compare(
        document,
        server.document,
        kit.SSR_ATTR,
        changes.stop(),
        keptOut.of
      ),
      flashes: missing.stop(),
      keptOut: keptOut.listed,
      requests: log.requests,
      windowMs,
    };
  } finally {
    for (const step of undo.reverse()) await step();
  }
}
