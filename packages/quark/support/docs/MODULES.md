# Built-in modules

Pure helpers for numbers, lists, maps, strings and dates, imported like JS modules — `@use "quark:math" as math;` — so nothing is global.

## Using a module

```quark
@use "quark:math" as math;
@use "quark:list" as *;

[data-progress] { --progress: math.percentage($done / $total); }
[bind-count] { content: count($todos, "done", true); }
```

`as name` namespaces the functions (`math.clamp(0, $x, 1)`, `math.$pi`); `as *` merges them into the bare scope. Every function is pure and null-tolerant: a missing collection reads as empty, a missing value passes through, and results are copies. Collection functions take a dot path (`"user.name"`) instead of a callback.

## Reference

*Generated.*

<!-- generated:builtin-modules -->
**`quark:math`** — Numbers. Arguments are coerced with `parseFloat`; the CSS argument order is kept.

| Name | Description |
| --- | --- |
| `math.$pi` | π. |
| `math.$e` | Euler's number. |
| `min(...values)` | The smallest value (lists are flattened). |
| `max(...values)` | The largest value (lists are flattened). |
| `clamp(min, value, max)` | `value` limited to the range, in CSS argument order. |
| `round(value, digits?)` | Rounded to `digits` decimals (default 0). |
| `floor(value)` | Rounded down. |
| `ceil(value)` | Rounded up. |
| `abs(value)` | Absolute value. |
| `mod(value, divisor)` | Wrapping modulo: `mod(-1, 3)` is `2` (the `%` operator keeps the sign). `NaN` for a zero divisor. |
| `pow(base, exponent)` | `base` to the power `exponent`. |
| `sqrt(value)` | Square root. |
| `percentage(fraction)` | `"25%"` for `0.25` — a string, ready for an attribute or CSS variable. |

**`quark:list`** — Arrays (an object counts as the list of its values). `"path"` arguments are dot paths into each item; comparisons are loose (`==`), like `find()`.

| Name | Description |
| --- | --- |
| `count(list, "path"?, value?)` | The number of items; with a path, the items whose value at it is non-empty; with a value too, the items equal to it. `0` for a missing list. |
| `find(list, "path", value)` | The first item whose value at the path equals `value`, else `undefined` (was a global built-in before 2026-09-13). |
| `filter(list, "path", value?)` | The items whose value at the path equals `value` — or is non-empty when `value` is omitted. |
| `reject(list, "path", value?)` | The complement of `filter`. |
| `pluck(list, "path")` | The value at the path of every item. |
| `sort-by(list, "path"?, "desc"?)` | A sorted copy: numbers numerically, everything else with a locale-aware, numeric-aware comparison; `null` last. `"desc"` reverses. |
| `sum(list, "path"?)` | The total of the items (or of their value at the path); non-numbers count as 0. |
| `range(end) / range(start, end, step?)` | `range(3)` → `[0, 1, 2]`; `range(1, 4)` → `[1, 2, 3]`; counts down when `start > end`. For skeleton rows and pagination. |
| `unique(list, "path"?)` | A copy without duplicates (by the value at the path when given), first occurrence kept. |
| `group-by(list, "path")` | A map from each distinct value at the path to the items carrying it. |
| `first(list)` | The first item, or `undefined`. |
| `last(list)` | The last item, or `undefined`. |
| `reverse(list)` | A reversed copy (was a global built-in before 2026-09-13). |
| `compact(list)` | A copy without `null`, `undefined`, `""`, empty lists and empty maps. |

**`quark:map`** — Plain objects (`(key: value)` literals, provisions, `dataset`-shaped data). Never mutates; returns copies.

| Name | Description |
| --- | --- |
| `get(map, "path", fallback?)` | The value at the dot path, or `fallback` when it is missing. |
| `has-key(map, "path")` | Whether the dot path resolves to a value. |
| `keys(map)` | The keys, in insertion order. |
| `values(map)` | The values, in insertion order. |
| `entries(map)` | `[(key: …, value: …), …]` — iterate a map with `item.key` / `item.value` in the rows. |
| `merge(...maps)` | A shallow merge, later maps winning. |
| `pick(map, ...keys)` | A copy holding only the named keys. |
| `omit(map, ...keys)` | A copy without the named keys. |

**`quark:string`** — Text. Values are stringified first; `null` / `undefined` read as `""`.

| Name | Description |
| --- | --- |
| `plural(count, forms, locale?)` | The form for `count` from a map keyed by `Intl.PluralRules` category (`one`, `other`, `few`, …); `#` in the form is replaced by the count: `plural($n, (one: "# item", other: "# items"))`. |
| `escape-html(value)` | `& < > " '` escaped, for text that goes through `dangerous-html()`. |
| `truncate(value, max, suffix?)` | Cut to `max` characters including the suffix (default `…`). |
| `capitalize(value)` | First character upper-cased. |
| `slugify(value)` | Lower-case ASCII with dashes: `"Héllo World!"` → `"hello-world"`. |

**`quark:date`** — Dates arrive as strings; these parse and format them. Every function accepts a `Date`, an ISO string or a timestamp and returns `null` / `""` for an unparseable value.

| Name | Description |
| --- | --- |
| `parse(value)` | A `Date`, or `null` — for the allowed date methods (`toLocaleDateString()`, `toISOString()`). |
| `is-valid(value)` | Whether the value parses as a date. |
| `format(value, locale?, options?)` | `Intl.DateTimeFormat` output: `format($when, "en-GB", (dateStyle: "medium"))`. |
| `add(value, amount, unit?)` | A new date `amount` units later (`"days"` by default; seconds … weeks, months, years — months and years step the calendar). |
| `diff(later, earlier, unit?)` | Whole units between two dates (`"days"` by default), negative when `later` is earlier. |

**`quark:url`** — Query strings, via `URLSearchParams`.

| Name | Description |
| --- | --- |
| `query(map)` | `"q=a+b&page=2"` from a map; `null` / `""` values are dropped, lists repeat the key. |
| `params(url)` | The query of a URL (or a bare query string) as a map; repeated keys become lists. |
| `encode(value)` | `encodeURIComponent`. |

**`quark:util`** — Small value helpers.

| Name | Description |
| --- | --- |
| `coalesce(...values)` | The first value that is not `null` / `undefined` (`or` also skips `0`, `""` and `false`). |
| `is-empty(value)` | `true` for `null`, `undefined`, `""`, an empty list or an empty map. |
| `type-of(value)` | `"string"`, `"number"`, `"boolean"`, `"list"`, `"map"`, `"date"`, `"null"`, `"undefined"` or `"function"`. |
| `to-json(value, indent?)` | `JSON.stringify`, for `content` or a `data-*` attribute. |
| `from-json(text)` | `JSON.parse`, or `null` when the text is not JSON. |
<!-- /generated -->

Functions available without an import: [Built-in functions](./BUILTINS.md).
