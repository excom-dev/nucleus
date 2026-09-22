# Embedded content

Images, media and figures are responsive by default; `figcaption` is muted.

## Usage

<include-content data-demo="embedded"></include-content>

```html
<figure>
  <img src="…" alt="…" />
  <figcaption>Caption</figcaption>
</figure>
```

- `img` (and `[role="img"]` / `.tag-img`): `max-width: 100%`, `height: auto`, no border.
- `audio`, `canvas`, `iframe`, `img`, `svg`, `video`: middle-aligned; `iframe` has no border; `svg` without `fill` inherits `currentColor`.
- `figure` has no margin; `figcaption` (`[role="caption"]` inside a figure) is padded and `--v-muted-color`.
