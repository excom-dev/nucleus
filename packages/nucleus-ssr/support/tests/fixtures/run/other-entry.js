/** The other site's element: it renders other text. */
customElements.define(
  "run-greeting",
  class extends HTMLElement {
    connectedCallback() {
      this.textContent = "Rendered by the other entry";
    }
  }
);
