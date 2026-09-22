/**
 * Host scope markers. Each registered host gets `q-scope="<id>"`, and
 * scoped rules prefix selectors with `[q-scope="<id>"] ` so the native
 * engine enforces CSS `@scope`: every compound matches strict
 * descendants; the host itself only via explicit `:scope`. No JS
 * ancestor walks (`q-` attrs are observer-blacklisted, so the marker
 * never triggers a run).
 *
 * Ids are minted per host and refcounted across sheets; the attr comes
 * off when the last sheet unregisters. This registry is the source of
 * truth. A marker copied by cloneNode/innerHTML is overwritten on the
 * next register, so two live hosts never share an id. Stale copies on
 * unregistered trees stay inert: rules only look inside their own host
 * (`host.contains()` + query-root clamp).
 */
export const SCOPE_ATTR = "q-scope";

const hostState = new WeakMap<Element, { id: string; count: number }>();
let counter = 0;

export const acquireScopeId = (host: Element): string => {
  const known = hostState.get(host);
  if (known) {
    known.count++;
    // reassert in case app code stripped or overwrote the attribute
    if (host.getAttribute(SCOPE_ATTR) !== known.id) {
      host.setAttribute(SCOPE_ATTR, known.id);
    }
    return known.id;
  }
  const id = (++counter).toString(36);
  hostState.set(host, { id, count: 1 });
  host.setAttribute(SCOPE_ATTR, id);
  return id;
};

export const releaseScopeId = (host: Element): void => {
  const known = hostState.get(host);
  if (!known) return;
  known.count--;
  if (known.count <= 0) {
    hostState.delete(host);
    if (host.getAttribute(SCOPE_ATTR) === known.id) {
      host.removeAttribute(SCOPE_ATTR);
    }
  }
};
