# Quark's origin story

The web platform has always lacked a critical native feature: a way to declaratively map data to the document... a "templating language".
This fundamental gap is the primary reason for the creation and endless churn of frameworks and libraries that fill that gap, such as Angular, React, Vue, etc.

And yet, templating **actually has existed** for a long time via CSS:
```css
span::before {
  content: "I will be painted.";

  /* It can even be dynamic: */
  content: attr(data-my-text);

  /* from a variable: */
  content: var(--my-text);
}
```

Quark was conceived as exactly this: a variant of CSS which mutates the document instead of styling.
It also augments CSS expressions, so the same patterns can be applied for rich data:

```quark
span {
    content: "I will be painted.";
    
    /* attr */
    content: attr("data-my-text");
    
    /* variable */
    content: $my-text;

    /* DOM Node property */
    content: prop("myData").myText;

    /* custom logic */
    content: myModule.buildMyText();
}
```

It can also be used for setting attributes, rendering `<template>` content, loops, conditions, event listeners, and more.

## Long term goal

The web still contains this fundamental gap. Framework churn will not cease until it is filled.
Compared to other frameworks and libraries filling this gap, Quark arguably stands apart as the most native-compatible solution.
If Quark sees widespread adoption, a WHATWG proposal will be drafted for the web platform to adopt a native feature/language bearing Quark's capabilities.
