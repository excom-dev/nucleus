# Container

`.container` centers content in a responsive column; `.container-fluid` spans the full width with padding only.

## Usage

<include-content data-demo="container"></include-content>

```html
<main class="container">…</main>
```

## Breakpoints

| Viewport | `.container` max-width |
| --- | --- |
| < 576px | 100% (with `--v-spacing` padding) |
| ≥ 576px | 510px |
| ≥ 768px | 700px |
| ≥ 1024px | 950px |
| ≥ 1280px | 1200px |
| ≥ 1536px | 1450px |

Landmark children of `body` (`header`, `main`, `footer`) get the same column without any class — see [Landmarks & section](./LANDMARKS.md).
