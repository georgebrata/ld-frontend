/**
 * @param {Record<string, unknown>} [initial]
 */
export function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    async get(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null;
    },
    async put(key, value, _ttlSeconds) {
      data[key] = value;
    },
  };
}
