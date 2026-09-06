/**
 * Map dynamic checkout inputs onto the Orders API fields.
 * URL holds the primary target. Extra values go in Notes.
 *
 * @param {Record<string, string>} inputs
 * @returns {{ url: string, notes: string }}
 */
export function mapInputsToOrderFields(inputs) {
  const values = inputs && typeof inputs === 'object' ? inputs : {};
  const url = String(values.url ?? values.username ?? '').trim();

  /** @type {string[]} */
  const extra = [];
  Object.entries(values).forEach(([key, value]) => {
    if (key === 'url' || key === 'username') return;
    const text = String(value ?? '').trim();
    if (text) extra.push(`${key}: ${text}`);
  });
  if (values.username && values.url) {
    extra.unshift(`username: ${String(values.username).trim()}`);
  }

  return { url, notes: extra.join('\n') };
}
