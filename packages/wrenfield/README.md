# Wrenfield

Wrenfield is a fictional furniture house: pieces made to order, restored antiques, lighting and objects.
It is a whole shop, from the home screen through checkout to order tracking, built as the reference example of a [Nucleus Stack](https://nucleus.excom.dev) app. There is no server of its own: a service worker mocks the API.
It has zero lines of app JS (except to import the mock API SW) and no UI build process.
It has a number of sophisticated features, including: SSG, SPA, web AR/3d models, WebAuthn, View Transitions, touch gestures

## Run it

```bash
npm run dev
```

Then open <http://localhost:3000>. Node 24.2 or newer. It can be installed to the home screen.

This is a demo: the checkout arrives filled in, any made-up details work, and nothing is charged or shipped. Bag, saved pieces, orders and trade setting live in IndexedDB; **Reset demo** in Account clears them.

## Running in the monorepo

Wrenfield is `packages/wrenfield`, a private app that is never published. From the package directory:

```bash
npm run dev       # serve the app on http://localhost:3000
npm test          # backend scenarios, dev server and app views, on vitest
npm run coverage  # the same, gated at 90%
```

Tests import the NucleusKit from the workspace source.

`support/tests/backend/golden.mjs` records every API response on a fixed clock: run it before and after a change, and the two files must match.

### Browser tests

`support/tests/browser/run.mjs` drives the whole app in headless Chrome at phone and desktop size and prints one line per check. `shot.mjs` is the harness under it, and also a screenshot tool. Vitest only picks up `*.test.ts`, so neither runs with `npm test` or counts towards coverage.

Their checks also run on happy-dom with `npm test`, in `support/tests/*.view.test.ts`: one test per Chrome check under the same name, at both layouts. Those mount `index.html`'s body with the NucleusKit from the workspace source and answer files and `/api/*` from the package, the API through the same worker as the backend scenarios. A check that needs layout, scroll positions or a real service worker is skipped there: only Chrome covers it.

They stay as the regression baseline for the app's happy-dom tests. They need Google Chrome (`CHROME=<path>` overrides the location) and launch a browser on every run, so run them only with the repo owner's go-ahead. From the package root:

```bash
node support/tests/browser/run.mjs
```

## Layout

```
index.html                   the shell: header and tab bar, routes, the #me provider, bag sheet, shared templates
shell.css                    tokens, and the patterns and motion every view shares
public/shell.quark           shell rules: layout fact, #me bindings, shared binders, sheets
public/data/catalog.json     44 pieces in five collections
public/views/<name>/         one view per screen: the HTML with its CSS and Quark sheet
public/img/, public/models/  Lucide icon sprite, logo and app icons, product cutouts and glTF models
support/tests/               the backend scenarios, the dev server tests, the app views on happy-dom, and the headless Chrome baseline
```

Views: home, shop, product, saved, bag, checkout (four steps), account, order, story, delivery-returns, not-found.

## How it is built

The Nucleus Stack loads the progressive NucleusKit bundle, which imports each element the first time its tag appears and, with `nucleus-kit-idle` on `body`, fetches the rest while the page is idle, and Valence.css with the elements' own styles. The app itself is HTML views, Quark sheets (Quark is a derivative of CSS that writes to the document) and CSS.

**One provider, read everywhere.** `index.html` wraps the app in a single `provider-fetch#me` for `GET /api/me`. `shell.quark` publishes the answer as bindings every view reads (`$me`, `$bag`, `$saved-skus`, `$bag-skus`) and as facts on `#me` (`is-trade`, `bag-count`, `saved-count`). The whole Saved sheet is two bindings, the list and its count.

**Facts, then rules.** Records land in the document as dashed attributes, and Quark and CSS both select on them. A `data-product` carries `is-unique`, `is-sold`, `is-saved` and `is-in-bag`; a rule and its inverse turn `is-saved` into the heart form's method, `put` or `delete`, and `#me[is-trade]` shows trade prices in CSS alone. Conditional rules come with their inverse, because Quark rules do not revert.

**Shared binders.** The shell fills any `[bind-products]` list with product cards, `[bind-bag-lines]` with bag lines, `[bind-bag]` with a total, `[bind-item]` with a field of the row it sits in, `[bind-count]` with a count of pieces and `[bind-error]` with the API's own message. A view publishes the binding (`$products`, `$bag`, `$count`) and writes the markup; most views need little else.

**Forms are the only way to change anything.** Saving, adding to the bag, changing a quantity, each checkout step, placing the order, switching trade pricing and resetting the demo are plain `<form>`s inside `super-form`. Every answer, success or refusal, bubbles up to `#me`, which fetches again, so all screens agree. A form inside `<spa-a listen-for="super-form-success">` moves on once it succeeds.

**The service worker is the backend.** Answers take 80 to 250 ms, so loading states are real.

**No script of its own.** The backend sends every amount with its text beside it (`price` and `priceText`, `deliveryFee` and `deliveryFeeText`), so the sheets bind text and never format; for the rest they lean on Quark's built-in modules.

**One third-party element.** Eight pieces have a 3D model, shown with Google's `<model-viewer>`. Scripts inside a view do not run, so `index.html` loads the element from unpkg in the document head, and a rule writes its `src` only when the 3D tab opens: no model downloads before it is asked for.

## Credits

Product images and models (CC0, Poly Haven), the stack, icons, type and the 3D viewer: see [CREDITS.md](CREDITS.md).
