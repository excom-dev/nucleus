/** One element that renders itself; a `/broken` route fails. */
customElements.define(
  "rig-greeting",
  class extends HTMLElement {
    connectedCallback() {
      this.textContent = "Rendered by the entry";
    }
  }
);

export const afterRender = ({ url }: { url: string }) => {
  if (url.endsWith("/broken")) throw new Error("broken on purpose");
};
