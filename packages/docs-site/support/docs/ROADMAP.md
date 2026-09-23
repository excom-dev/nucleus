# Roadmap

What is being worked on, what is queued behind it, and what is only an idea. No dates.

## Where it stands today

The Nucleus Stack is in **beta**. Breaking changes still land, and they land as removals rather than deprecations.

What is already settled:

- **The architecture.** [Adapter, State, Orchestrator](/nucleus/docs/adapter_state_orchestrator) is not up for major revision. The document is the state, elements bridge protocols, rules coordinate.
- **Element API shape.** Attributes in, events out, commands to invoke. Individual attributes come and go; the contract does not.
- **The zero-build path.** Serving files as-is is the default way to use the stack, not a degraded mode.

What "stable" will mean, when the beta ends: a **public API freeze** on the Quark language and on element attributes, events and commands, with semantic versioning honoured from that point on.

Until then: **pin your versions**, and read the change notes before you upgrade.

## Sooner

Work that is done or nearly done, landing in the next releases.

- **SSR** Will involve reusing happy-dom test setup for SSR.
- **More elements in the catalog.** May include some of the following elements. Interaction: `content-sortable`, `content-splitter`, `content-popover`, `super-file-input`. Actions: `clipboard-copy`, `web-share`, `file-download`. Sensors: `detect-visibility`, `detect-size`, `detect-scroll`, `detect-document`, `detect-permission`. Providers: `provider-url-params`, `provider-event-source`, `provider-websocket`, `provider-worker`.
- **Polyfills** Some features will be broken for certain browsers whose versions are older than a year (mainly Firefox & Safari, mid-2025). This will be remedied in the first stable release.
- **The small-bug backlog.** A coverage sweep across every package surfaced a list of minor defects. They are being triaged and fixed ahead of a stable release.
- **More themes for Valence.css.** Broader theme and scheme coverage, so a view's `--v-*` tokens carry further without custom CSS.

## Later

Wanted, thought about, not scheduled. Nothing here is a commitment.

- **Quark rule reversion & specificity.** There are open architectural and performance questions, not just an implementation cost. It is wanted. It is not scheduled. Do not build on it.
- **Optional build-time wins.** For teams who already run a bundler, shipping pre-parsed sheets would let the parser drop out of the runtime. Noted, not scheduled — and the zero-build path stays the default either way.
- **Scoped view transitions** When/if this lands in browsers, it is a very easy change to scope Quark's `@view-transition` rule.
- **A standards track.** If Quark finds real adoption, the intention is to draft a proposal for a native platform capability along these lines. See [Origin Story](/nucleus/docs/origin_story).

## How priorities get decided

When two good ideas compete, these break the tie.

- **Composability first.** If a change would make two pieces harder to combine, it does not land — even when it would be convenient. This is the reason there is no component concept and why elements never render or mutate children.
- **No cooperation required.** A mechanism that works on any element, including ones we did not write, beats a contract that only holds when everyone opts in.
- **If it is not in the document, it does not exist.** Features that route state or behaviour around the page are invisible to devtools, to serialisation and to every other sheet — which are the things the stack is for. Would rather not ship such a feature than ship one that hides state.

## How to influence it

Priorities here are set by what people actually hit, so the most useful thing you can send is a concrete case.

- **Report what broke.** [Open an issue](https://github.com/excom-dev/nucleus/issues) with the smallest HTML, CSS and Quark that reproduces it. A reduced case moves faster than anything else. Check [Troubleshooting](/nucleus/docs/troubleshooting) and [Limitations](/nucleus/docs/limitations) first — some surprises are documented trade-offs with a stated workaround.
- **Propose an element** by describing the protocol it bridges and why existing elements plus a Quark rule cannot already do it. [Contributing](/nucleus/docs/contributing) has the questions a proposal should answer.
- **Tell us what you had to write JavaScript for.** That is the single most valuable signal on this page. Every gap between "I could express this as a rule" and "I had to write a function" is a candidate for the language or the catalog, and the examples come from real applications, not from guessing.
- **Send a pull request.** Setup, conventions and what a reviewable change looks like are in [Contributing](/nucleus/docs/contributing).
