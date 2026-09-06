/**
 * Build a profile URL from a username when the service has no post URL.
 * @param {string} platform
 * @param {string} username
 * @returns {string}
 */
export function profileUrl(platform, username) {
  const handle = String(username ?? '').replace(/^@/, '').trim();
  if (!handle) return '';
  switch (platform) {
    case 'instagram':
      return `https://instagram.com/${handle}`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'youtube':
      return `https://www.youtube.com/@${handle}`;
    case 'facebook':
      return `https://www.facebook.com/${handle}`;
    default:
      return handle;
  }
}

/**
 * Map LikeDealer inputs onto SocialPanel24 add params.
 * Unknown client keys are ignored.
 *
 * @param {{
 *   socialPanelId: string,
 *   quantity: number,
 *   platform?: string,
 *   inputs?: Record<string, string>,
 *   url?: string
 * }} order
 * @param {{ type?: string }} [sp24Service]
 * @returns {Record<string, string>}
 */
export function mapFulfilmentParams(order, sp24Service = {}) {
  const inputs = order.inputs || {};
  const type = String(sp24Service.type || '').toLowerCase();
  const link =
    inputs.url ||
    order.url ||
    profileUrl(order.platform || '', inputs.username);

  /** @type {Record<string, string>} */
  const params = {
    action: 'add',
    service: String(order.socialPanelId),
  };

  if (link) params.link = link;

  const comments = String(inputs.commentsList ?? '').trim();
  if (comments || type.includes('comment')) {
    params.comments = comments.replace(/\r\n/g, '\n');
  } else {
    params.quantity = String(order.quantity);
  }

  return params;
}

/**
 * Map inputs onto the Orders sheet fields.
 * @param {Record<string, string>} inputs
 * @returns {{ url: string, notes: string }}
 */
export function mapInputsToSheetFields(inputs) {
  const values = inputs && typeof inputs === 'object' ? inputs : {};
  const url = String(values.url ?? values.username ?? '').trim();
  /** @type {string[]} */
  const extra = [];
  Object.entries(values).forEach(([key, value]) => {
    if (key === 'url' || key === 'username') return;
    const text = String(value ?? '').trim();
    if (text) extra.push(`${key}: ${text}`);
  });
  if (values.username && values.url) extra.unshift(`username: ${values.username}`);
  return { url, notes: extra.join('\n') };
}
