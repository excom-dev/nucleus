# routable-element

URL matching for custom elements — give any Neutron class a
`route-href` and react when the address bar changes.

## Features

- **Path patterns** Named params (`/users/:id`) and wildcards
- **Regex routes** Full control via `route-regex`
- **Nested match** Keep layouts active under child paths
- **Live updates** Rematch when `route-href` / `route-regex` change

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Compose `RoutableElement` and implement `routeChanged`. Concrete
consumers include `<spa-route>`, `<spa-a>`, and `<spa-manager>`.

```ts
import { Neutron } from "@excom/neutron";
import { RoutableElement } from "@excom/routable-element";

export const PathAware = Neutron.compose([
  RoutableElement,
  Neutron({
    tag: "path-aware",
    props: {
      isActive: Boolean,
    },
  }),
])
  .defineMethods({
    routeChanged: (_el, { match }) => ({ isActive: !!match }),
  });

PathAware.define();
```

```html
<path-aware route-href="/dashboard" match-nested></path-aware>
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### Path match & nested layouts

`route-href` activates on exact match; `match-nested` keeps a layout
mounted under child paths.

```html
<spa-route route-href="/users" match-nested>
  <template>…layout…</template>
</spa-route>
```

#### Catch-all via regex

```html
<spa-route route-regex=".*" is-fallback>
  <template>404</template>
</spa-route>
```
