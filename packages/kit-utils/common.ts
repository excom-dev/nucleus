type Falsy = false | 0 | "" | null | undefined;

export const toArray = <T>(val: T) =>
  (Array.isArray(val) ? val : [val]) as T extends Array<any> ? T : T[];

export const isPojo = (obj: unknown): boolean => {
  if (!obj || typeof obj !== "object") return false;
  const proto = Object.getPrototypeOf(obj);
  return proto === Object.prototype || proto === null;
};

export const deepMerge = <T extends object>(...objects: (T | Falsy)[]): T => {
  return objects.reduce<T>((acc, source) => {
    if (!source) return acc;
    const output = Object.assign({}, acc);
    Object.keys(source).forEach((key) => {
      if (isPojo(source[key]) && key in acc) {
        output[key] = deepMerge(acc[key], source[key]);
      } else {
        output[key] = source[key];
      }
    });
    return output;
  }, {} as T);
};

export const pathJoin = (parts: string[], sep?: string) => {
  const separator = sep || "/";
  parts = parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp("^" + separator), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp(separator + "$"), "");
    }
    return part;
  });
  return parts.join(separator);
};

export const tc = (t: () => any): any => {
  try {
    return t();
  } catch (_) {
    return;
  }
};

export const wait = (ms: number = 0) =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(true);
    }, ms);
  });

export const execWhenReady = (valOrPromise, cb) => {
  if (valOrPromise instanceof Promise) {
    return valOrPromise.then((a) => cb(a));
  } else {
    return cb(valOrPromise);
  }
};

/** Coerce a value or already-pending Promise to a Promise. */
export const wrapInPromise = <T>(valOrPromise: T | Promise<T>): Promise<T> => {
  return valOrPromise instanceof Promise
    ? valOrPromise
    : Promise.resolve(valOrPromise);
};

export const isNumber = (n: unknown) => typeof n === "number" && !isNaN(n);

export const deleteUndefined = <T extends Record<string, any>>(
  obj: T,
  opts?: { nested?: boolean }
): T => {
  Object.keys(obj).forEach((key) => {
    if (obj[key] === undefined) {
      delete obj[key];
    } else if (opts?.nested && isPojo(obj[key])) {
      deleteUndefined(obj[key], opts);
    }
  });
  return obj;
};

export const unique = <T>(arr: T[]): T[] =>
  arr.filter((v, i, a) => a.indexOf(v) === i);

export const deepClone = <T>(obj: T): T => {
  if (typeof obj !== "object" || obj === null) {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(deepClone) as T;
  }
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, deepClone(value)])
  ) as T;
};

type Unwrap<T> =
  T extends WeakRef<infer U> ? U : T extends { deref(): infer U } ? U : never;

type UnwrapTuple<T extends readonly unknown[]> = {
  [K in keyof T]: Unwrap<T[K]>;
};
type DiRef = WeakRef<WeakKey>;

function _di<T extends readonly DiRef[], R>(
  refs: [...T],
  cb: (...args: UnwrapTuple<T>) => R,
  opts: { optional: boolean; method: "apply" }
): R | undefined;
function _di<T extends readonly DiRef[], R>(
  refs: [...T],
  cb: (...args: UnwrapTuple<T>) => R,
  opts: { optional: boolean; method: "bind" }
): (() => R) | undefined;
function _di<T extends readonly DiRef[], R>(
  refs: [...T],
  cb: (...args: UnwrapTuple<T>) => R,
  opts: { optional: boolean; method: "apply" | "bind" }
): R | undefined | (() => R) {
  const wrapper = () => {
    const objs = refs.map((r) => r?.deref());
    if (opts.optional || objs.every((r) => r)) {
      return cb.apply(this, objs as UnwrapTuple<T>);
    }
  };
  return opts.method === "apply" ? wrapper() : wrapper;
}
export const di = {
  apply: <T extends readonly DiRef[], R>(
    refs: [...T],
    cb: (...args: UnwrapTuple<T>) => R,
    opts?: { optional?: boolean }
  ): R | undefined =>
    _di(refs, cb, { optional: opts?.optional ?? false, method: "apply" }),

  bind: <T extends readonly DiRef[], R>(
    refs: [...T],
    cb: (...args: UnwrapTuple<T>) => R,
    opts?: { optional?: boolean }
  ): (() => R) | undefined =>
    _di(refs, cb, { optional: opts?.optional ?? false, method: "bind" }),
};

export type JsonSafeSerializer = (value: any) => any;

const JSON_SAFE_SERIALIZERS: Record<string, JsonSafeSerializer> = {
  function: () => "<Function>",
  bigint: (value) => String(value),
  symbol: (value) => String(value),
  WeakRef: () => "<WeakRef>",
  Node: (value: Node) => `<${value?.constructor?.name || value?.nodeType}>`,
  Element: (value: Element) =>
    `<${value?.constructor?.name || value?.nodeName}>`,
  UnknownObject: (value) => `<${value?.constructor?.name}>`,
  Circular: () => "<Circular>",
  Failed: () => "<Failed>",
};

/**
 * Deep JSON-safe clone. Non-POJOs are replaced via serializers (defaults or
 * overrides). Useful for DevTools / structured-clone boundaries.
 */
export const toJsonSafe = (
  value: unknown,
  _serializers: Record<string, JsonSafeSerializer> = {}
): unknown => {
  const serializers = { ...JSON_SAFE_SERIALIZERS, ..._serializers };
  const seen = new WeakSet<object>();
  const replace = (v: unknown): unknown => {
    if (typeof v === "function") return serializers.function(v);
    if (typeof v === "bigint") return serializers.bigint(v);
    if (typeof v === "symbol") return serializers.symbol(v);
    if (v instanceof Element) return serializers.Element(v);
    if (v instanceof Node) return serializers.Node(v);
    if (v && typeof v === "object") {
      if (seen.has(v as object)) return serializers.Circular(v);
      const ctorName = (v as object).constructor?.name;
      if (ctorName && ctorName in serializers) {
        // Re-run discrimination on serializer output (e.g. WeakRef → Element).
        return replace(serializers[ctorName](v));
      }
      if (!Array.isArray(v) && !isPojo(v)) {
        return serializers.UnknownObject(v);
      }
      seen.add(v as object);
    }
    return v;
  };
  try {
    return JSON.parse(JSON.stringify(value, (_key, v) => replace(v)));
  } catch {
    return serializers.Failed(value);
  }
};

export const deepCompare = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true;
  if (
    a == null ||
    b == null ||
    typeof a !== "object" ||
    typeof b !== "object"
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((v, i) => deepCompare(v, b[i]))
    );
  }
  // Class instances / non-POJOs: reference equality only (=== via Object.is above).
  if (!isPojo(a) || !isPojo(b)) return false;
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every(
      (key) =>
        Object.hasOwn(b, key) &&
        deepCompare(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key]
        )
    )
  );
};
