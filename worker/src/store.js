/**
 * KV-backed order + idempotency store.
 * @param {KVNamespace} kv
 */
export function createStore(kv) {
  return {
    /**
     * @param {string} key
     */
    async get(key) {
      if (!kv) return null;
      return kv.get(key, 'json');
    },
    /**
     * @param {string} key
     * @param {unknown} value
     * @param {number} [ttlSeconds]
     */
    async put(key, value, ttlSeconds) {
      if (!kv) return;
      await kv.put(key, JSON.stringify(value), ttlSeconds ? { expirationTtl: ttlSeconds } : undefined);
    },
  };
}

/**
 * @param {string} id
 */
export function orderKey(id) {
  return `order:${id}`;
}

/**
 * @param {string} sessionId
 */
export function sessionKey(sessionId) {
  return `stripe:session:${sessionId}`;
}

/**
 * @param {string} eventId
 */
export function eventKey(eventId) {
  return `stripe:event:${eventId}`;
}
