/** One element that renders itself; the `/broken` route fails. */
customElements.define(
  "run-greeting",
  class extends HTMLElement {
    connectedCallback() {
      this.textContent = "Rendered by the entry";
    }
  }
);

export const afterRender = ({ url }) => {
  if (url.endsWith("/broken")) throw new Error("broken on purpose");
};
