// Runs scenario() in a page the service worker controls, then sets window.scenarioResult.
void (async () => {
  const api = async (method, path, body) => {
    const json = body !== undefined && { body: JSON.stringify(body), headers: { "content-type": "application/json" } };
    const response = await fetch(`/api${path}`, { method, ...json });
    return { status: response.status, body: await response.json() };
  };
  // Moves every hold and order ms into the past.
  const travel = async (ms) => {
    const request = indexedDB.open("wrenfield");
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const store = db.transaction("state", "readwrite").objectStore("state");
    const read = (key) => new Promise((resolve) => (store.get(key).onsuccess = (e) => resolve(e.target.result)));
    const shift = (iso) => new Date(Date.parse(iso) - ms).toISOString();
    const [bag, orders] = [await read("bag"), await read("orders")];
    if (bag) store.put(bag.map((line) => ({ ...line, addedAt: shift(line.addedAt) })), "bag");
    if (orders) store.put(orders.map((order) => ({ ...order, createdAt: shift(order.createdAt) })), "orders");
    await new Promise((resolve) => (store.transaction.oncomplete = resolve));
    db.close();
  };
  window.scenarioResult = await scenario(api, travel);
})();
