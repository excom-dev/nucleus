import type { DomWindow } from "./window";

// DOMException's legacy codes, by position: `SyntaxError` is 12
const CODES =
  ",IndexSizeError,DOMStringSizeError,HierarchyRequestError,WrongDocumentError,InvalidCharacterError,NoDataAllowedError,NoModificationAllowedError,NotFoundError,NotSupportedError,InUseAttributeError,InvalidStateError,SyntaxError,InvalidModificationError,NamespaceError,InvalidAccessError,ValidationError,TypeMismatchError,SecurityError,NetworkError,AbortError,URLMismatchError,QuotaExceededError,TimeoutError,InvalidNodeTypeError,DataCloneError".split(
    ","
  );

/**
 * APIs happy-dom lacks: a `ServiceWorkerContainer` class,
 * `checkVisibility()`, always `true` (no layout), and a `DOMException`'s
 * `code`.
 */
export function installMissingApis(win: DomWindow | typeof globalThis): void {
  (win as { ServiceWorkerContainer?: unknown }).ServiceWorkerContainer ??=
    class ServiceWorkerContainer {};
  win.Element.prototype.checkVisibility ??= () => true;
  if (!("code" in win.DOMException.prototype))
    Object.defineProperty(win.DOMException.prototype, "code", {
      get(this: DOMException) {
        return Math.max(0, CODES.indexOf(this.name));
      },
    });
}
