/**
 * Keyboard filters (Quark `@on (key: …)`, `keycode-filter`): space-separated
 * alternatives, each an `event.key` name, optionally joined with modifiers
 * by `+` in any order (`Shift+K`, `k+shift`). Case-insensitive.
 */
const MODIFIERS: Record<string, (e: KeyboardEvent) => boolean> = {
  shift: (e) => e.shiftKey,
  alt: (e) => e.altKey,
  ctrl: (e) => e.ctrlKey,
  control: (e) => e.ctrlKey,
  meta: (e) => e.metaKey,
  cmd: (e) => e.metaKey,
};

/** `event.key` of a modifier-only token (`shift` matches its own keydown). */
const MODIFIER_KEYS: Record<string, string> = { ctrl: "control", cmd: "meta" };

/** Keys a filter cannot spell, being its separators. */
const KEY_NAMES: Record<string, string> = {
  space: " ",
  spacebar: " ",
  plus: "+",
};

const matchesToken = (token: string, e: KeyboardEvent): boolean => {
  const parts = token.toLowerCase().split("+").filter(Boolean);
  const key = e.key?.toLowerCase();
  if (!parts.length || !key) return false;
  const mods = parts.filter((p) => p in MODIFIERS);
  if (!mods.every((m) => MODIFIERS[m](e))) return false;
  const keys = parts.filter((p) => !(p in MODIFIERS));
  return keys.length
    ? keys.every((k) => key === (KEY_NAMES[k] ?? k))
    : mods.some((m) => key === (MODIFIER_KEYS[m] ?? m));
};

/**
 * Whether keyboard event `e` matches `filter` (`"Escape Shift+Space"`, or
 * its tokens). A filter without tokens matches no key.
 */
export const matchesKey = (
  filter: string | readonly string[],
  e: Event
): boolean =>
  (typeof filter === "string" ? filter.split(/\s+/) : filter).some(
    (token) => !!token && matchesToken(token, e as KeyboardEvent)
  );
