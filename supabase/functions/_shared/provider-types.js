/**
 * Serializer / validator registry keyed by SocialPanel24 `type`.
 * Browser fields are never forwarded unless the type declares them.
 */

import { normalizeNewlineList } from './inputs.js';
import { parseHttpUrl, profileUrl, validatePlatformUrl } from './urls.js';

/** @typedef {'url'|'username'|'comments'|'usernames'|'hashtags'|'hashtag'|'media'|'groups'|'runs'|'interval'|'country'|'device'|'type_of_traffic'|'google_keyword'|'referring_url'} InputName */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   storefrontInputs: InputName[],
 *   quantityMode: 'required'|'omit'|'from_comments'|'package',
 *   enabled: boolean,
 *   serialize: (ctx: SerializeCtx) => Record<string, string>,
 *   billableQuantity: (ctx: SerializeCtx) => number
 * }} ProviderTypeHandler
 *
 * @typedef {{
 *   platform: string,
 *   quantity: number,
 *   inputs: Record<string, string>,
 *   drip?: { runs?: number, interval?: number }
 * }} SerializeCtx
 */

const WEB_TRAFFIC_DEVICES = new Set(['1', '2', '3', '4', '5']);

/**
 * @param {SerializeCtx} ctx
 * @returns {string}
 */
function resolveLink(ctx) {
  const url = String(ctx.inputs.url || '').trim();
  if (url) {
    const parsed = parseHttpUrl(url);
    if (!parsed) throw new Error('A valid http(s) URL is required.');
    const check = validatePlatformUrl(parsed.href, ctx.platform);
    if (!check.ok) throw new Error(check.error);
    return check.href;
  }
  const fromUsername = profileUrl(ctx.platform, ctx.inputs.username || '');
  if (fromUsername) return fromUsername;
  throw new Error('A target URL or username is required.');
}

/**
 * @param {unknown} value
 * @param {string} label
 */
function requireNewlineList(value, label) {
  const list = normalizeNewlineList(value);
  if (!list.count) throw new Error(`${label} is required.`);
  return list;
}

/**
 * @param {SerializeCtx} ctx
 * @param {Record<string, string>} params
 */
function applyDrip(ctx, params) {
  if (!ctx.drip) return;
  if (ctx.drip.runs != null) params.runs = String(ctx.drip.runs);
  if (ctx.drip.interval != null) params.interval = String(ctx.drip.interval);
}

/**
 * @param {string} id
 * @param {Partial<ProviderTypeHandler>} spec
 * @returns {ProviderTypeHandler}
 */
function defineType(id, spec) {
  return {
    id,
    label: spec.label || id,
    storefrontInputs: spec.storefrontInputs || ['url'],
    quantityMode: spec.quantityMode || 'required',
    enabled: spec.enabled !== false,
    serialize: spec.serialize,
    billableQuantity: spec.billableQuantity || ((ctx) => ctx.quantity),
  };
}

/** @type {Record<string, ProviderTypeHandler>} */
export const PROVIDER_TYPES = {
  Default: defineType('Default', {
    storefrontInputs: ['url'],
    serialize(ctx) {
      const params = { link: resolveLink(ctx), quantity: String(ctx.quantity) };
      applyDrip(ctx, params);
      return params;
    },
  }),
  Package: defineType('Package', {
    quantityMode: 'package',
    storefrontInputs: ['url'],
    serialize(ctx) {
      return { link: resolveLink(ctx) };
    },
    billableQuantity() {
      return 1;
    },
  }),
  'Custom Comments': defineType('Custom Comments', {
    quantityMode: 'from_comments',
    storefrontInputs: ['url', 'comments'],
    serialize(ctx) {
      const comments = requireNewlineList(ctx.inputs.comments, 'Comments');
      return { link: resolveLink(ctx), comments: comments.text };
    },
    billableQuantity(ctx) {
      return normalizeNewlineList(ctx.inputs.comments).count;
    },
  }),
  'Custom Comments Package': defineType('Custom Comments Package', {
    quantityMode: 'package',
    storefrontInputs: ['url', 'comments'],
    serialize(ctx) {
      const comments = requireNewlineList(ctx.inputs.comments, 'Comments');
      return { link: resolveLink(ctx), comments: comments.text };
    },
    billableQuantity() {
      return 1;
    },
  }),
  Mentions: defineType('Mentions', {
    storefrontInputs: ['url', 'usernames'],
    serialize(ctx) {
      const usernames = requireNewlineList(ctx.inputs.usernames, 'Usernames');
      return {
        link: resolveLink(ctx),
        quantity: String(ctx.quantity),
        usernames: usernames.text,
      };
    },
  }),
  'Mentions with Hashtags': defineType('Mentions with Hashtags', {
    storefrontInputs: ['url', 'usernames', 'hashtags'],
    serialize(ctx) {
      const usernames = requireNewlineList(ctx.inputs.usernames, 'Usernames');
      const hashtags = requireNewlineList(ctx.inputs.hashtags, 'Hashtags');
      return {
        link: resolveLink(ctx),
        quantity: String(ctx.quantity),
        usernames: usernames.text,
        hashtags: hashtags.text,
      };
    },
  }),
  'Mentions Custom List': defineType('Mentions Custom List', {
    quantityMode: 'omit',
    storefrontInputs: ['url', 'usernames'],
    serialize(ctx) {
      const usernames = requireNewlineList(ctx.inputs.usernames, 'Usernames');
      return { link: resolveLink(ctx), usernames: usernames.text };
    },
    billableQuantity(ctx) {
      return Math.max(ctx.quantity, normalizeNewlineList(ctx.inputs.usernames).count);
    },
  }),
  'Mentions Hashtag': defineType('Mentions Hashtag', {
    storefrontInputs: ['url', 'hashtag'],
    serialize(ctx) {
      const hashtag = String(ctx.inputs.hashtag || '').replace(/^#/, '').trim();
      if (!hashtag) throw new Error('A hashtag is required.');
      return { link: resolveLink(ctx), quantity: String(ctx.quantity), hashtag };
    },
  }),
  'Mentions User Followers': defineType('Mentions User Followers', {
    storefrontInputs: ['url', 'username'],
    serialize(ctx) {
      const source = String(ctx.inputs.username || ctx.inputs.url || '').trim();
      if (!source) throw new Error('A source username or URL is required.');
      const asUrl = parseHttpUrl(source);
      return {
        link: resolveLink(ctx),
        quantity: String(ctx.quantity),
        username: asUrl ? asUrl.href : source.replace(/^@/, ''),
      };
    },
  }),
  'Mentions Media Likers': defineType('Mentions Media Likers', {
    storefrontInputs: ['url', 'media'],
    serialize(ctx) {
      const media = parseHttpUrl(ctx.inputs.media);
      if (!media) throw new Error('A media URL is required.');
      return { link: resolveLink(ctx), quantity: String(ctx.quantity), media: media.href };
    },
  }),
  'Comment Likes': defineType('Comment Likes', {
    storefrontInputs: ['url', 'username'],
    serialize(ctx) {
      const username = String(ctx.inputs.username || '')
        .replace(/^@/, '')
        .trim();
      if (!username) throw new Error('The comment owner username is required.');
      return { link: resolveLink(ctx), quantity: String(ctx.quantity), username };
    },
  }),
  'Invites from Groups': defineType('Invites from Groups', {
    storefrontInputs: ['url', 'groups'],
    serialize(ctx) {
      const groups = requireNewlineList(ctx.inputs.groups, 'Groups');
      return { link: resolveLink(ctx), quantity: String(ctx.quantity), groups: groups.text };
    },
  }),
  'Web Traffic': defineType('Web Traffic', {
    enabled: true,
    storefrontInputs: ['url', 'country', 'device', 'type_of_traffic', 'google_keyword', 'referring_url'],
    serialize(ctx) {
      const country = String(ctx.inputs.country || '').trim();
      const device = String(ctx.inputs.device || '').trim();
      const traffic = String(ctx.inputs.type_of_traffic || '').trim();
      if (!country) throw new Error('A country is required.');
      if (!WEB_TRAFFIC_DEVICES.has(device)) {
        throw new Error('Device must be a numeric code 1–5.');
      }
      if (!['1', '2', '3'].includes(traffic)) {
        throw new Error('type_of_traffic must be 1, 2, or 3.');
      }
      /** @type {Record<string, string>} */
      const params = {
        link: resolveLink(ctx),
        quantity: String(ctx.quantity),
        country,
        device,
        type_of_traffic: traffic,
      };
      if (traffic === '1') {
        const keyword = String(ctx.inputs.google_keyword || '').trim();
        if (!keyword) throw new Error('google_keyword is required for type_of_traffic 1.');
        params.google_keyword = keyword;
      }
      if (traffic === '2') {
        const referring = parseHttpUrl(ctx.inputs.referring_url);
        if (!referring) throw new Error('referring_url is required for type_of_traffic 2.');
        params.referring_url = referring.href;
      }
      applyDrip(ctx, params);
      return params;
    },
  }),
  Subscriptions: defineType('Subscriptions', {
    enabled: false,
    storefrontInputs: ['username'],
    serialize() {
      throw new Error('Subscriptions are unavailable until bounded billing is defined.');
    },
  }),
};

/**
 * @param {string} typeName
 * @returns {ProviderTypeHandler|null}
 */
export function getProviderType(typeName) {
  const name = String(typeName || '').trim();
  if (PROVIDER_TYPES[name]) return PROVIDER_TYPES[name];
  const lower = name.toLowerCase();
  return Object.values(PROVIDER_TYPES).find((entry) => entry.id.toLowerCase() === lower) || null;
}

/**
 * @param {string} typeName
 * @returns {boolean}
 */
export function isSupportedProviderType(typeName) {
  const handler = getProviderType(typeName);
  return Boolean(handler && handler.enabled);
}

/**
 * Build add-action fields excluding key/action/service (those are added server-side).
 * @param {string} typeName
 * @param {SerializeCtx} ctx
 * @returns {Record<string, string>}
 */
export function serializeProviderAdd(typeName, ctx) {
  const handler = getProviderType(typeName);
  if (!handler || !handler.enabled) {
    throw new Error(`Unsupported provider type: ${typeName || '(missing)'}`);
  }
  return handler.serialize(ctx);
}

/**
 * @param {string} typeName
 * @param {SerializeCtx} ctx
 * @returns {number}
 */
export function billableQuantityForType(typeName, ctx) {
  const handler = getProviderType(typeName);
  if (!handler) throw new Error(`Unsupported provider type: ${typeName || '(missing)'}`);
  const qty = handler.billableQuantity(ctx);
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Invalid billable quantity.');
  return qty;
}
