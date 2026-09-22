export async function handleEcho(request) {
  const text = await request.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return new Response(JSON.stringify({ json: parsed }), {
    headers: { "content-type": "application/json" },
  });
}
