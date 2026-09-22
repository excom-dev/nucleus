import { KitLogger } from "@excom/kit-logger";
import { clearFetchCaches, fetchPlainText } from "@excom/kit-utils";
import { LoadableElement } from "@excom/loadable-element";
import { ConstructorType, Neutron, TEvent } from "@excom/neutron";
import { Quark } from "@excom/quark";

export type QuarkSheetLoadingEvent = TEvent & {
  type: "quark-sheet-loading";
  detail: void;
};

export type QuarkSheetSuccessEvent = TEvent & {
  type: "quark-sheet-success";
  detail: void;
};

export type QuarkSheetErrorEvent = TEvent & {
  type: "quark-sheet-error";
  detail: unknown;
};

/**
 * Hosts a Quark orchestration sheet for its parent. Put markup and
 * `<quark-sheet>` as siblings under the same parent — Quark scopes to that
 * host. Inline sheet text, or load remote Quark via `src-url`.
 *
 * @summary Load / own a Quark sheet for sibling markup.
 *
 * @example
 * <section>
 *   <quark-sheet>
 *     details[open] [bind-status] { content: "Open"; }
 *     details:not([open]) [bind-status] { content: "Closed"; }
 *   </quark-sheet>
 *   <details>
 *     <summary>Panel</summary>
 *     <span bind-status></span>
 *   </details>
 * </section>
 *
 * @command --reload - Drops the shared text cache entry for `src-url` and
 *   fetches the sheet again (the cache is page-wide: every element loading
 *   the same URL shares it). No-op without `src-url`.
 *
 * @fires quark-sheet-loading - After `is-loading` becomes true (fetch in
 *   flight).
 * @type QuarkSheetLoadingEvent
 * @fires quark-sheet-success - After the sheet parses and registers
 *   successfully (`is-success`).
 * @type QuarkSheetSuccessEvent
 * @fires quark-sheet-error - After parse / fetch failure (`is-error`).
 *   `event.detail` is the error.
 * @type QuarkSheetErrorEvent
 */
export const QuarkSheet = Neutron.compose([
  LoadableElement,
  Neutron({
    tag: "quark-sheet",
    props: {
      /**
       * @option
       * URL of a remote `.quark` / text sheet. When set, contents are
       * fetched into the live sheet (replacing inline text).
       * @values <URL>
       */
      srcUrl: String,
      /**
       * @option
       * Run top-level rules in the root context (the whole document)
       * instead of implicitly wrapping the sheet in `@scope { }`. Rules
       * nested inside an explicit `@scope { }` block remain scoped to the
       * host either way.
       */
      isGlobal: Boolean,
      // from LoadableElement; repeated so the docs here are local
      /**
       * @state
       * Fetch in progress.
       */
      isLoading: Boolean,
      /**
       * @state
       * Sheet parsed and registered on the host.
       */
      isSuccess: Boolean,
      /**
       * @state
       * Fetch or Quark parse/register failed.
       */
      isError: Boolean,
      // private
      srcPromise: Promise as ConstructorType<Promise<string>>,
      /**
       * @state
       * Resolved sheet source text (from fetch or inline). Not reflected —
       * sheets can be large.
       */
      srcText: {
        type: String,
        // sheets can be large: never reflect
        attr: false,
      },
      /**
       * @state
       * Live `Quark` instance while registered.
       */
      quarkInstance: Quark,
    },
  }),
])
  /* No `src-url`: take the inline sheet text. */
  .onConnected(
    ({ srcUrl, textContent }) =>
      !srcUrl && textContent?.trim() && { srcText: textContent }
  )
  .onConnected((element) => {
    /* Reconnect: re-register the live instance on the (maybe new) parent. */
    if (element.quarkInstance) {
      element.quarkInstance.register({
        sheetElement: element,
      });
    }
  })
  /* `src-url` set: fetch the remote sheet. */
  .onPropSet("srcUrl", ({ srcUrl }) => ({
    srcPromise: fetchPlainText(srcUrl),
  }))
  /* Reload: drop the shared cache entry and fetch again. */
  .onCommand("--reload", ({ srcUrl }) => {
    if (!srcUrl) return;
    clearFetchCaches(srcUrl);
    // clear `srcText` too: identical remote text must still re-register
    return { srcText: null, srcPromise: fetchPlainText(srcUrl) };
  })
  /* Fetch settled: drop `srcPromise`, write `srcText`. */
  .onPromiseResolved("srcPromise", (_, result) => ({
    srcPromise: null,
    srcText: result.srcPromise as any,
  }))
  /* In-flight `srcPromise` → loading. */
  .onPropChanged(
    "srcPromise",
    ({ srcPromise }) => !!srcPromise && { _setLoading: [] }
  )
  /* Fetch failed → error. */
  .onPromiseRejected("srcPromise", (_, result) => {
    KitLogger.error(`quark-sheet error:`, result.srcPromise);
    return { srcPromise: null, _setError: [result.srcPromise] };
  })
  /* `srcText` / `isGlobal` changed: parse and register again. */
  .onPropChanged(["srcText", "isGlobal"], (element) => {
    const { srcText, srcPromise, quarkInstance, isGlobal } = element;
    // wait out an in-flight fetch before (re)registering
    if (srcText && !srcPromise) {
      try {
        quarkInstance?.unregister();
        return [
          {
            quarkInstance: new Quark({
              src: srcText,
              // host-scoped unless `is-global` (the historical default)
              options: { isScoped: !isGlobal },
            }),
          },
          { _setSuccess: [null] },
        ];
      } catch (e: any) {
        KitLogger.error(`quark-sheet error:`, e);
        return { _setError: [e] };
      }
    }
  })
  .onPropSet("quarkInstance", (element) => {
    element.quarkInstance?.register({
      sheetElement: element,
    });
  })
  /* When element is disconnected, clean up quark. A move re-registers on
     reconnect (the host may have changed), so `isMoving` cannot skip it. */
  .onDisconnected(({ quarkInstance }) => {
    quarkInstance?.unregister();
  });
