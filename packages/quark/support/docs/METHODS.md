# Allowed methods

Prototype methods an expression may call on a value through the dot accessor. Everything else is an error; wrap other logic in a `@use` module function.

## Reference

*Generated.*

<!-- generated:allowed-methods -->
| Method | On | Description |
| --- | --- | --- |
| `.toLowerCase()` | string | Lower-cased copy. |
| `.toUpperCase()` | string | Upper-cased copy. |
| `.trim()` | string | Copy without leading / trailing whitespace. |
| `.split(separator, limit?)` | string | Array of substrings. |
| `.charAt(index)` | string | The character at `index`. |
| `.startsWith(search, position?)` | string | Boolean. |
| `.endsWith(search, length?)` | string | Boolean. |
| `.padStart(length, fill?)` | string | Left-padded copy. |
| `.padEnd(length, fill?)` | string | Right-padded copy. |
| `.replace(search, replacement)` | string | Copy with the first match replaced (string search only). |
| `.replaceAll(search, replacement)` | string | Copy with every match replaced (string search only). |
| `.toString()` | string, array, number, date | String form. |
| `.includes(search)` | string, array | Boolean. |
| `.slice(start?, end?)` | string, array | Sub-range copy. |
| `.indexOf(search)` | string, array | First position, or `-1`. |
| `.lastIndexOf(search)` | string, array | Last position, or `-1`. |
| `.concat(...values)` | string, array | Joined copy. |
| `.at(index)` | string, array | Element at `index`; negative counts from the end. |
| `.join(separator?)` | array | String of the items. |
| `.flat(depth?)` | array | Flattened copy. |
| `.toFixed(digits?)` | number | Fixed-point string. |
| `.toLocaleString(locale?, options?)` | number, date, array | Locale-formatted string. |
| `.toLocaleDateString(locale?, options?)` | date | Locale-formatted date. |
| `.toLocaleTimeString(locale?, options?)` | date | Locale-formatted time. |
| `.toISOString()` | date | ISO 8601 string. |
| `.getAttribute("name")` | element | Attribute value or `null`. Not observed. |
| `.hasAttribute("name")` | element | Boolean. Not observed. |
| `.matches("selector")` | element | Boolean. |
| `.closest("selector")` | element | Nearest ancestor-or-self matching the selector, or `null`. |
<!-- /generated -->

Own-property functions on a value (a `@use` namespace, a provided object) are always callable; see [Expressions](./EXPRESSIONS.md).
