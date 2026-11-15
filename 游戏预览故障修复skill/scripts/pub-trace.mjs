/**
 * Render-publication duplicate-row tracer (ForgeaX 0.4.x). Injected with worker.evaluate() into every
 * Worker of the page; logs `[FIX] dup-row {...}` when a packet sends an asset row whose handle the
 * receiver still holds at a revision that does not advance (and was not retired in between).
 * That is exactly what the Render Worker rejects as `stage: draw, reason: shape, subject: asset payload`.
 *
 * It wraps postMessage and message listeners added after injection, so it sees packets on both sides.
 * Read-only; costs ~1 ms per packet. Use only for diagnosis (driver FIX_TRACE=1).
 */
export function installPublicationTrace() {
  if (self.__fixTrace) return;
  self.__fixTrace = true;
  const live = new Map();
  const ring = [];
  let posted = 0;
  let matched = 0;
  const find = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 3) return undefined;
    if (value.record instanceof ArrayBuffer && typeof value.revision === 'number' && 'source' in value) return value;
    for (const key of Object.keys(value)) { const hit = find(value[key], depth + 1); if (hit) return hit; }
    return undefined;
  };
  const inspect = (payload) => {
    posted += 1;
    const message = find(payload, 0);
    if (posted % 2000 === 0) console.warn('[FIX] seen', posted, matched);
    if (!message) return;
    matched += 1;
    const side = message.side ?? {};
    const rows = (side.assets ?? []).map((row) => [row.handle, row.revision, row.value?.kind]);
    const retired = [...(side.retiredAssets ?? [])];
    const patches = (side.assetPatches ?? []).map((p) => [p.handle, p.revision, p.base]);
    const summary = { rev: message.revision, src: String(message.source).slice(0, 8), rows, retired, patches: patches.length };
    ring.push(summary);
    if (ring.length > 40) ring.shift();
    for (const [handle, revision, kind] of rows) {
      const known = live.get(handle);
      if (known !== undefined && revision <= known.revision && !retired.includes(handle))
        console.warn('[FIX] dup-row', JSON.stringify({ handle, revision, kind, known, packet: summary, before: ring.slice(-8, -1) }));
    }
    for (const handle of retired) live.delete(handle);
    for (const [handle, revision, kind] of rows) live.set(handle, { revision, kind, rev: message.revision });
    for (const [handle, revision] of patches) { const k = live.get(handle); if (k && typeof revision === 'number') k.revision = revision; }
  };
  for (const proto of [self.MessagePort?.prototype, self.Worker?.prototype, Object.getPrototypeOf(self)]) {
    if (!proto?.postMessage) continue;
    const send = proto.postMessage;
    proto.postMessage = function (payload, ...rest) { try { inspect(payload); } catch {} return send.call(this, payload, ...rest); };
  }
  const wrapped = new WeakMap();
  for (const proto of [self.MessagePort?.prototype, Object.getPrototypeOf(self)]) {
    if (!proto?.addEventListener) continue;
    const add = proto.addEventListener;
    proto.addEventListener = function (type, listener, ...rest) {
      if (type !== 'message' || typeof listener !== 'function') return add.call(this, type, listener, ...rest);
      const wrap = wrapped.get(listener) ?? function (event) { try { inspect(event.data); } catch {} return listener.call(this, event); };
      wrapped.set(listener, wrap);
      return add.call(this, type, wrap, ...rest);
    };
  }
  const port = self.MessagePort?.prototype;
  const descriptor = port && Object.getOwnPropertyDescriptor(port, 'onmessage');
  if (descriptor?.set) Object.defineProperty(port, 'onmessage', { ...descriptor, set(listener) {
    descriptor.set.call(this, typeof listener === 'function' ? function (event) { try { inspect(event.data); } catch {} return listener.call(this, event); } : listener);
  } });
}
