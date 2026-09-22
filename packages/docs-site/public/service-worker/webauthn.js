const b64url = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const json = (data) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });

export function handleWebAuthn(request) {
  const path = new URL(request.url).pathname;
  const rpId = self.location.hostname;

  if (path.endsWith("/register/options")) {
    return json({
      challenge: b64url(),
      rp: { name: "excom-dev docs", id: rpId },
      user: { id: b64url(), name: "demo", displayName: "Demo User" },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      timeout: 60000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
    });
  }
  if (path.endsWith("/authenticate/options")) {
    return json({
      challenge: b64url(),
      rpId,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: [],
    });
  }
  if (path.endsWith("/verify")) return json({ verified: true });
  return json({ message: "not found" });
}
