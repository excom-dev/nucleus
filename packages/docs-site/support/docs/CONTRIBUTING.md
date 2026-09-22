# Contributing - help wanted!

How to get the monorepo running, what the conventions are, and what a reviewable pull request looks like.

The stack lives in one repository: [excom-dev/nucleus](https://github.com/excom-dev/nucleus). Every published package — the Nucleus Kit elements, Neutron, Quark, Valence.css — is a folder under `packages/`, managed by [Rush](https://rushjs.io) on top of pnpm.

## Getting set up

Node 24.13 or newer. Rush is invoked through the checked-in bootstrap script, so there is nothing to install globally.

```bash
git clone https://github.com/excom-dev/nucleus.git
cd monorepo
node common/scripts/install-run-rush.js install
node common/scripts/install-run-rush.js build
```

If you have Rush on your `PATH`, `rush install` and `rush build` are the same thing. `rush build` is incremental and cached: after the first run it only rebuilds what changed.

## Working in one package

Rush's per-package selection is the fast path. From inside `packages/<name>`, the package's own scripts do everything:

| Command | What it does |
| --- | --- |
| `pnpm run build` | Build that package's entry points |
| `pnpm run test` | Vitest, in happy-dom |
| `pnpm run coverage` | Tests plus a coverage report — fails below 90% on any metric |
| `pnpm run format` | Prettier over the package |
| `pnpm run dev` | Dev server, where the package has one |

Repo-wide equivalents exist as Rush commands (`rush test`, `rush coverage`, `rush format`), and `--to` / `--from` scope them to a dependency graph. Prefer the package-level script while you are iterating — it is the tightest loop.

Tests run in **happy-dom**, never a real browser. Everything in the stack is DOM work, so a test is usually "build a fragment, register a sheet or an element, assert on attributes".

## Package layout

```
packages/my-element/
  index.ts              # entry: defines and globally types every element here
  index.css             # entry: imports each element's CSS
  my-element.ts         # one source file per element
  my-element.css
  src/                  # helpers; not built as entry points
  support/
    docs/               # README.md and any further pages
    demos/              # one .html per demo, no JS
    tests/              # one <name>.test.ts per source file
  package.json          # needs to contain config common to other packages, such as `excom` object
```

Files in the package root become build entry points; files under `src/` do not. `dist/`, `coverage/`, `CHANGELOG.md` and the generated docs metadata are all produced by the tooling and are not committed.

## Conventions

These are the rules reviewers apply. [Best Practices](/nucleus/docs/best_practices) covers the reasoning; this is the short version for contributors.

**Elements**

- **Single responsibility.** One job, configurable, observable, generic. `content-drawer` is good; `add-to-cart` is not — business behaviour belongs to app authors' Quark sheets, not to the element catalog.
- **Never render or mutate children.** Composition is the design. The exception is an element whose *entire* purpose is logicless rendering of author-supplied markup, like `include-content`, and that has to be stated in its docs.
- **Dashed attributes.** Every custom attribute contains a dash (`listen-for`, `data-duration`, `is-open`), so it can never collide with a native attribute now or later. That applies to reflected state props too.
- **Tag-prefixed events.** `my-element-change`, never `change`.
- **Imperatives are commands.** Accept "do this" as a native `command` event with a short `--verb`, so a plain `<button command="--open" commandfor="id">` can drive it. Never a bubbling `my-element-trigger` event.
- **Underscore private members**, and keep the imperative surface small.
- **No Shadow DOM** unless isolation is genuinely the point. It walls off the very rules that make the stack composable.
- **Own your region.** An element writes its own attributes and its any other elements in its family. Nothing else.

**Neutron lifecycles**

Keep them functional. Destructure the element argument, and return an effect rather than mutating:

```ts
onConnected: ({ isOpen }) => ({ ariaExpanded: String(isOpen) });
```

Not `(el) => { el.ariaExpanded = …; }`. Async work that needs current state belongs in a `defineMethods` method, which receives the live element. Never hold a hard reference to another element; use `WeakRef` and clear it in `onDisconnected`.

**CSS**

Modern CSS — nesting, `@scope`, `:has()`, container queries. Classes carry static flavour only (`details.accordion`); dynamic state is an attribute. Expose `--v-*` tokens so themes reach the element.

## Docs and demos

Every published package documents itself under `support/docs/`. The API reference is generated from code comments, so the prose you write is the intro, the features list and the usage:

- **README.md** — title, a one-sentence pitch, a demo, `Features`, `Usage`. Keep it terse; the features list is what a prospective app author reads first, so use the words they would search for.
- **Further pages** when the reference outgrows one screen. A `support/docs-sections.json` groups them into sidebar sections.
- **Links between pages** are plain relative markdown (`[Props](./PROPS.md)`, `[Styling](/nucleus/docs/styling)`). They work on GitHub, and the pipeline rewrites them for the site. Never hand-write `<spa-a>` in markdown.
- **`INTERNAL.md`** is a contributor file. It is never rendered or published.

Demos live in `support/demos/<name>.html`: one root element, no embedded JavaScript, the smallest markup that shows the point. Anything a demo needs but a reader does not (layout padding, colours) goes in the docs site's `demo-utils.css`. Four demos is plenty for a small package, eight for a large one.

## Proposing an element

Open a discussion before writing code. A proposal is easier to accept when it answers:

1. **What one protocol does it bridge?** A network, a store, a sensor, the clock, or a person's interaction. If the answer has an "and" in it, it may be two elements. See [Adapter, State, Orchestrator](/nucleus/docs/adapter_state_orchestrator).
2. **What is its state, as attributes?** Writing those attributes by hand should reproduce what the protocol would have done.
3. **What does it announce, as events?** And which imperatives does it accept, as commands?
4. **Why can existing elements plus a Quark rule not already do this?** Composition of what exists always beats a new tag.

Elements stay generic. If the idea only makes sense for one application, it is a [view](/nucleus/docs/building_views), and views belong to their authors.

## Change files

Every publishable package touched by a pull request needs a Rush change file. From the repo root, after committing:

```bash
node common/scripts/install-run-rush.js change
```

Rush compares your branch against `main`, prompts once per affected package, and writes JSON into `common/changes/@excom/<package>/`. Commit those files too — CI runs `rush change --verify` and only counts what is committed.

Pick the bump honestly:

| Type | When |
| --- | --- |
| `major` | A public attribute, event or export was removed or renamed; existing markup or listeners break |
| `minor` | New public capability — an attribute, an event field, an export |
| `patch` | A fix or internal improvement with the same public contract |
| `none` | Docs, demos or tests only |

The comment is published documentation, so write it for someone who has never seen the implementation. Imperative mood, starting with a verb — Add, Remove, Fix an issue where, Improve, Upgrade. Describe the outcome ("Searching now supports wildcards"), not the diff. Backticks around public names. No trailing period on a single sentence, and prefer "issue #123" over "bug".

Removals are removals. The stack does not currently ship deprecation windows or compatibility shims; a dropped feature has its code, grammar, tests and docs deleted, and the API rejects it with a clear error. Record it as `major` and that is the migration story.

## Pull requests

Target `main`. CI installs the workspace and then, for every package your branch touches, runs the build and the coverage suite, verifies change files, and comments bundle sizes and coverage on the pull request.

Before you open one:

- [ ] Tests for the behaviour you added, next to the source file they cover
- [ ] Coverage still at or above 90% for the package
- [ ] `pnpm run format` run in each package you touched
- [ ] Docs updated — attribute and event comments, the features list if the pitch changed, a demo if it is a headline capability
- [ ] A committed change file per publishable package
- [ ] Custom attributes dashed, events tag-prefixed, imperatives as commands

Keep the pull request to one story. A rename and a new option are two change-file entries and, usually, two pull requests.

## Reporting issues

Bugs and feature requests go to [the issue tracker](https://github.com/excom-dev/nucleus/issues). A reduced case beats a description: the smallest HTML, CSS and Quark that reproduces it, plus what you expected. Check [Troubleshooting](/nucleus/docs/troubleshooting) and [Limitations](/nucleus/docs/limitations) first — several surprising behaviours are documented trade-offs with a stated workaround.

## Code of conduct

Be decent to each other. Assume good faith, critique the code rather than the person, and accept that a maintainer may say no to a feature that would cost composability. Conduct concerns can be raised privately with the maintainers through the issue tracker.
