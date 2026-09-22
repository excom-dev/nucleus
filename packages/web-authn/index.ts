import { WebAuthn } from "./web-authn";

WebAuthn.define();

export { WebAuthn };

type T_HTMLWebAuthnElement = typeof WebAuthn.CustomElement;
declare global {
  interface HTMLWebAuthnElement extends T_HTMLWebAuthnElement {}
  interface Window {
    HTMLWebAuthnElement: HTMLWebAuthnElement;
  }
  interface HTMLElementTagNameMap {
    "web-authn": HTMLWebAuthnElement;
  }
}
export type { HTMLWebAuthnElement };
