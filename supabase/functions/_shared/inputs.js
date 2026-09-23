/**
 * Canonical storefront / provider input names and aliases.
 * Browser aliases such as commentsList are mapped to `comments`.
 */

/** @type {Readonly<Record<string, string>>} */
export const INPUT_ALIASES = Object.freeze({
  url: 'url',
  link: 'url',
  username: 'username',
  comments: 'comments',
  commentslist: 'comments',
  comment_list: 'comments',
  usernames: 'usernames',
  hashtags: 'hashtags',
  hashtag: 'hashtag',
  media: 'media',
  groups: 'groups',
  runs: 'runs',
  interval: 'interval',
  country: 'country',
  device: 'device',
  type_of_traffic: 'type_of_traffic',
  google_keyword: 'google_keyword',
  referring_url: 'referring_url',
});

/** Names the storefront may collect. */
export const STOREFRONT_INPUTS = Object.freeze([
  'url',
  'username',
  'comments',
  'usernames',
  'hashtags',
  'hashtag',
  'media',
  'groups',
  'runs',
  'interval',
  'country',
  'device',
  'type_of_traffic',
  'google_keyword',
  'referring_url',
]);

/**
 * Canonicalize a single input name.
 * @param {unknown} name
 * @returns {string}
 */
export function canonicalInputName(name) {
  const key = String(name ?? '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return INPUT_ALIASES[key] || '';
}

/**
 * Parse a comma-separated Inputs cell (sheet compatibility) into canonical names.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseInputList(raw) {
  if (Array.isArray(raw)) {
    return unique(raw.map(canonicalInputName).filter(Boolean));
  }
  if (!raw || !String(raw).trim()) return [];
  return unique(
    String(raw)
      .split(',')
      .map((part) => canonicalInputName(part))
      .filter(Boolean)
  );
}

/**
 * Normalize CRLF to LF and keep nonempty comment/list entries unchanged.
 * Blank lines are dropped; remaining text is not trimmed or rewritten.
 * @param {unknown} value
 * @returns {{ text: string, entries: string[], count: number }}
 */
export function normalizeNewlineList(value) {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const entries = normalized.split('\n').filter((line) => line.trim().length > 0);
  return {
    text: entries.join('\n'),
    entries,
    count: entries.length,
  };
}

/**
 * Map a raw input object onto canonical keys. Unknown keys are dropped.
 * @param {unknown} inputs
 * @returns {Record<string, string>}
 */
export function canonicalizeInputValues(inputs) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!inputs || typeof inputs !== 'object') return out;
  Object.entries(/** @type {Record<string, unknown>} */ (inputs)).forEach(([key, value]) => {
    const name = canonicalInputName(key);
    if (!name) return;
    if (name === 'comments' || name === 'usernames' || name === 'hashtags' || name === 'groups') {
      out[name] = normalizeNewlineList(value).text;
      return;
    }
    if (name === 'username') {
      out[name] = String(value ?? '')
        .replace(/^@/, '')
        .trim();
      return;
    }
    out[name] = String(value ?? '').trim();
  });
  return out;
}

/**
 * @param {string[]} names
 * @returns {string[]}
 */
function unique(names) {
  return [...new Set(names)];
}
