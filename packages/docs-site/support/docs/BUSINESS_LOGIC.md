# Business Logic

Pricing, eligibility, entitlements, approvals — the proprietary behaviour nobody can ship for you. In this stack it is not a layer of code. It is facts written into the document, and rules that select on them.

The shape never changes:

1. **Facts.** Everything the app knows lands in the document as an attribute, on an element named after the record it belongs to. Derived values are computed once and written next to the values they came from.
2. **Rules.** A business rule is a Quark selector over those facts, plus what follows from it.
3. **Consequences.** CSS selects on the same facts to render them: what shows, what it says, what it totals.

The payoff is not brevity. It is that a rule and its evidence sit in the document together. Open devtools on a disabled button and the attributes that disabled it are on its ancestors, spelled out. Nothing to step through, nothing to reproduce.

## Facts first

Stamp the server's answer onto the document *before* deciding anything with it. A record gets an element named after it — custom `data-` attributes and/or a custom tag starting with `data-` — and every field lands on its own line as a dashed attribute:

```html
<li></li>
```

```quark
li { dataset: prop("provision").body; }
```

Or:

```html
<!-- the session's facts live here; rules and CSS select on them -->
<data-session></data-session>
```

```quark
provider-fetch[api-url="/api/session"] {
  $session: prop("provision").body;
  data-session {
    account-id: $session.accountId;
    plan-name: $session.plan;
    region-code: $session.region;
    seat-count: $session.seatCount;
    seats-included: $session.seatsIncluded;
  }
}
```

Writing the fields out one at a time is the point, not a chore. The list *is* the schema: open the file and you know exactly what the API sends, and open devtools and you see the same names on the element. (`dataset: $session` would unpack the object in one declaration, but only onto `data-*` attributes, and it hides which fields exist — keep it for the case where a genuinely open-ended bag of `data-*` is what you want.)

Give the element the display it needs in CSS — an undefined custom element is `display: inline` until you say otherwise. Where the record is also *presented*, hand it the ARIA role the native tag would have carried (`<data-item role="listitem">`, `<data-return role="article">`): assistive technology reads it as before, and the Valence.css role aliases style it as before.

Then derive. A boolean declaration writes `""` when truthy and removes the attribute when falsy, so a derived fact ends up indistinguishable from a fact the API sent:

```quark
data-session {
  is-guest: $session.role == "guest";
  is-over-seats: $session.seatCount > $session.seatsIncluded;
}
```

Three rules keep this honest.

- **Derive once, select many times.** The same condition repeated across several `if()` calls means a fact is missing from the document. Write it as an attribute and every later rule — and every stylesheet — can see it.
- **Write the inverse.** Quark rules do not revert. Every state you leave needs its counter-rule, or a stale fact outlives the thing it described.
- **Dash every custom attribute.** `is-guest` or `seat-count`, never `guest` or `seats`. A bare word can shadow, or later collide with, a native attribute. Dropping the `data-` prefix does not buy you a dash-less name; it just moves the prefix to the tag, where it says something.

## Rules as selectors

A rule is a condition and its consequence. The condition is a selector over facts; the consequence is more facts.

### One fact per decision, its value the reason

When a decision has more than two outcomes, do not reach for a second boolean. Give the fact a value, and let that value *be* the reason it took:

```quark
:scope {
  /* the free plan carries one active project; a read-only seat carries none */
  &[is-read-only] {
    new-project-block: "read-only";
  }
  &[plan-name="free"]:not([is-read-only]):has([is-active]) {
    new-project-block: "plan-limit";
  }
  &:not([is-read-only]):not([plan-name="free"]),
  &[plan-name="free"]:not([is-read-only]):not(:has([is-active])) {
    new-project-block: none;
  }

  &[new-project-block] [bind-new-project] { disabled: ""; }
  &:not([new-project-block]) [bind-new-project] { disabled: none; }
}
```

Read the middle rule aloud and it is the requirement: *on the free plan, not read-only, already holding an active project*. The last selector is the inverse — every combination that leaves the blocked state. `:has()` turns a question about descendants into a fact on the ancestor, which is how an aggregate becomes selectable.

The same predicate almost certainly exists on your server, guarding the endpoint. That is fine and correct: it is stated once on each side of the wire, in the vocabulary of that side, and neither is hidden inside a call stack.

### Default-deny

Where the safe answer is "no", render every option, tag each with its identity, and let one rule open the ones that qualify. An option you forgot to account for stays closed:

```quark
@use "/views/shipping/carriers.js" as carriers;

[bind-carriers] {
  content: iterate(carriers.all());
  > data-carrier { carrier-name: item; }
}
```

```css
/* nothing ships anywhere until a region says so */
data-carrier { display: none; }
[region-code="uk"] :is([carrier-name="northwind"], [carrier-name="fenwick"]),
[region-code="de"] [carrier-name="brandt"] { display: block; }
```

In the business case above, opening a new market is just a selector, rather than a code change.
It should be noted that you still must have backend validation for all business logic, as with all UI frameworks.

### Facts derived from two places at once

A rule may compare a route against a session, a row against its parent, a line against the method chosen for the whole order. The comparison happens once; the result is a fact on the row:

```quark
spa-route[is-active] { $route: prop("provision"); }

data-project {
  is-active: attr("project-id") == $session.activeProjectId;
  is-locked: $route.params.mode == "audit" and attr("owner-id") != $session.accountId;
}
```

Now `data-project[is-active]` and `data-project:not([is-locked])` are available to every other rule and to the stylesheet, and neither has to know where the answer came from.

### Aggregates

`:scope:has()` sums a list up to its host without a counter, an observer, or a line of script:

```quark
:scope:has(data-line[is-selected])       { has-selection: ""; }
:scope:not(:has(data-line[is-selected])) { has-selection: none; }
:scope:has(data-line[is-selected][is-expedited])       { needs-approval: ""; }
:scope:not(:has(data-line[is-selected][is-expedited])) { needs-approval: none; }
```

Keep `:has()` arguments shallow. Each one costs a subtree scan per candidate element.

### Gating the submit

The last rule in most flows is the one that decides whether the user may proceed, and why not:

```quark
:scope {
  &:not([has-selection]) [bind-summary] {
    disabled-reason: "Pick at least one line";
    button { disabled: ""; }
  }
  &[has-selection][needs-approval]:not([approver-id]) [bind-summary] {
    disabled-reason: "Expedited lines need an approver";
    button { disabled: ""; }
  }
  &[has-selection]:not([needs-approval]) [bind-summary],
  &[has-selection][approver-id] [bind-summary] {
    disabled-reason: none;
    button { disabled: none; }
  }
}
```

The button's state and the sentence explaining it are written by the same rule, so they cannot disagree.

## The same rules, in CSS

Quark decides; CSS renders. Both select on the identical facts, which is what stops the two from drifting.

Quark owns anything that is *state*: attributes, content, listeners. `disabled` is state, so `disabled: ""` is a Quark declaration. CSS owns anything that is *appearance* — visibility, emphasis, the wording of a reason, a running total:

```css
[new-project-block] [bind-new-project] { cursor: not-allowed; opacity: 0.5; }
[new-project-block="plan-limit"] [bind-new-project-note]::before {
  content: "One project on the free plan — upgrade for more";
}
[new-project-block="read-only"] [bind-new-project-note]::before {
  content: "Your seat is read only";
}

/* a tooltip straight out of the fact that caused it */
[disabled-reason]:is(:hover, :focus-within)::after {
  content: attr(disabled-reason);
}
```

Counters handle totals, so the sum lives where the rows are rather than in a variable somewhere:

```css
[bind-lines] { counter-reset: picked subtotal; }
data-line[is-selected] {
  counter-increment: picked 1 subtotal attr(line-amount type(<integer>), 0);
}
[bind-summary] .totals::before {
  content: counter(picked) " selected · $" counter(subtotal);
}
```

Emptiness is a fact too. A value below a threshold that resolves to `""` disappears on its own:

```quark
[bind-margin] { content: if($line.marginPct > 1: "#{$line.marginPct}% margin"; else: ""); }
```

```css
[bind-margin]:empty { display: none; }
```

## When a calculation outgrows selectors

Selectors compare and combine; they do not iterate and accumulate. A weighted total, a tax table, an amortisation schedule — those are arithmetic, and arithmetic belongs in a function.

Check the [built-in modules](/nucleus/packages/quark/modules) first: `quark:list` counts, filters, groups and sums, `quark:math` clamps and rounds, `quark:string` pluralises, `quark:date` does calendar arithmetic. Only write your own when they fall short.

When you do, `@use` it and let it return a value for Quark to write:

```quark
@use "/views/quote/pricing.js" as pricing;

provider-fetch[is-success] {
  $quote: prop("provision").body;
  :scope {
    contract-total: pricing.contractTotal($quote.lines, $quote.termMonths);
    is-above-approval-limit: pricing.contractTotal($quote.lines, $quote.termMonths) > 50000;
  }
}
```

```js
/* values in, value out. no DOM, no state, no attributes. */
export const contractTotal = (lines = [], termMonths = 12) =>
  lines
    .filter(({ isWaived }) => !isWaived)
    .reduce(
      (total, { unitPrice, seats, discountPct = 0 }) =>
        total + unitPrice * seats * termMonths * (1 - discountPct / 100),
      0,
    )
    .toFixed(2);
```

The function is a calculator. It takes values, returns a value, and has no idea a document exists. Quark writes the result into the DOM, where it becomes another fact that rules and CSS can select on — `[is-above-approval-limit]` now gates the submit exactly like any other fact.

### The counter-example

Here is the same feature written the way many stacks would write it:

```js
/* anti-pattern: goes shopping in the DOM, then writes to it */
export function updateTotal() {
  const rows = document.querySelectorAll("#quote data-line[is-selected]");
  const total = [...rows].reduce(
    (sum, row) => sum + Number(row.getAttribute("line-amount")),
    0,
  );
  document.querySelector("#quote-total").textContent = `$${total}`;
  document.querySelector("#submit").disabled = total === 0;
}
```

It works, and it costs you four things.

- **It is a second copy of a rule you already wrote.** `data-line[is-selected]` is now a requirement stated in two languages. One of them will be updated and the other will not.
- **It has to be called.** Every future path that changes a selection must remember to call it. That obligation is invisible until something forgets.
- **Its conclusion never reaches the document.** `total === 0` is the decisive fact, and it dies as a local variable. No CSS rule and no other Quark rule can see it, so the next feature that needs it computes it again.
- **It is untestable without a DOM,** and uninspectable with one — the selection is on screen, the reasoning is not.

The test is simple: **if a function reads the DOM or writes the DOM, it is doing the Orchestrator's job.** Give it arguments and let it return a value. Where a side effect truly is unavoidable — handing a node to a charting library, redirecting after a payment — attach it to an event with `@on ... (handle: fn)`, so it is an occurrence with a cause, not a calculation in disguise.

## Checklist

- [ ] Every value a rule needs is an attribute on an element, not a variable in a closure
- [ ] Every record is an element named after it (`data-<noun>`), with every field written out on its own line; it also can a generic element with `data-` attributes.
- [ ] Every derived boolean is written once, and has an inverse rule
- [ ] Every custom attribute contains a dash
- [ ] Decisions with several outcomes carry a value that names the reason, not a stack of booleans
- [ ] Aggregates come from `:scope:has()`, not from a counting loop
- [ ] The default is the denying case; qualifying opens it
- [ ] Quark writes state (`disabled`, `content`, the record's attributes); CSS renders appearance from the same facts
- [ ] Built-in modules checked before writing a helper
- [ ] Every module function takes values and returns a value — no DOM, no state, no attributes
- [ ] The reason a control is disabled is a fact, and the message the user reads comes from it

Related: [Orchestrating](/nucleus/docs/orchestrating) for the language itself, [Best Practices](/nucleus/docs/best_practices) for the short rules, [Building Views](/nucleus/docs/building_views) for where these files live.
