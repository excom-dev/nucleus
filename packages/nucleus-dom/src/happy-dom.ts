/** The happy-dom release nucleus-dom pins: the internals read below are its. */
export const HAPPY_DOM = "20.8.3";

type Internals = Record<symbol, unknown>;
/**
 * The object (`target` or a prototype) holding happy-dom's internal `name`,
 * and its symbol key. Found rather than imported: an import can be a second
 * happy-dom copy.
 */
export const internal = (target: object, name: string): [Internals, symbol] => {
  const key = Object.getOwnPropertySymbols(target).find(
    (symbol) => symbol.description === name
  );
  if (key) return [target as Internals, key];
  const parent = Object.getPrototypeOf(target);
  if (!parent)
    throw new Error(
      `nucleus-dom needs happy-dom ${HAPPY_DOM}: this happy-dom has no "${name}"`
    );
  return internal(parent, name);
};

/** The object in `target`'s prototype chain that owns `name`. */
export const owner = <T extends object>(target: T, name: keyof T): T =>
  Object.hasOwn(target, name)
    ? target
    : owner(Object.getPrototypeOf(target), name);
