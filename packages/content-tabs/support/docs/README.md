# content-tabs

Tabs and accordions — single, multi, or toggle selection, paired by name
or position.

<include-content data-demo="simple"></include-content>

## Features

- **Single / multi / toggle** Radio-like tabs, an accordion, or re-click
  to close
- **Pair by name or position** Match headers to bodies with `tab-name`,
  or by index when unnamed
- **Isolated nesting** Nested `<content-tabs>` groups never cross-wire
- **Bindable state** `.provision` is `{ tabType, openTabs, activeTab }` —
  read the active tab from Quark with `prop("provision")`
- **Included looks** `.underline` and `.file-tabs` styles ship built in

## Installation

<include-content is-active template-ref="/views/install-section/install-section.html"></include-content>

## Usage

Put `<content-tabs-header>` and `<content-tabs-body>` elements inside
`<content-tabs>`. A header pairs with the body sharing its `tab-name`,
or by position when both are unnamed.

```html
<content-tabs class="underline">
  <content-tabs-header is-open>Overview</content-tabs-header>
  <content-tabs-header>Details</content-tabs-header>
  <content-tabs-body is-open><p>Overview copy.</p></content-tabs-body>
  <content-tabs-body><p>Details copy.</p></content-tabs-body>
</content-tabs>
```

The open state is a fact, not just an event: `.provision` holds
`{ tabType, openTabs, activeTab }`, where a tab is its header's `tab-name`
(or its index when unnamed) and `activeTab` is the first open one. Quark
reads it on the group and binds it anywhere below:

```quark
content-tabs {
  $tab: prop("provision").activeTab;
  h2 { content: $tab; }
}
```

### API Reference

<include-content is-active template-ref="/views/api-reference/api-reference.html"></include-content>

### Examples

#### File tabs

`.file-tabs` renders each header like a folder tab, joined to its body.

<include-content data-demo="file-tabs"></include-content>

#### Multi-select accordion

`tab-type="multi"` lets any number of headers stay open — clicking one does not close the others. Also displayed are the tab headers as buttons, if using Valence.css.

Useful for building your own UI toggle systems.

<include-content data-demo="multi"></include-content>

#### Pair by tab-name

Give a header and body matching `tab-name` values to pair them regardless of their order in the DOM.

<include-content data-demo="named"></include-content>
