/**
 * Canonical input names for the storefront. Aliases such as commentsList map to comments.
 */

const ALIASES = {
  url: 'url',
  link: 'url',
  username: 'username',
  comments: 'comments',
  commentslist: 'comments',
  comments_list: 'comments',
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
};

/**
 * @param {unknown} name
 * @returns {string}
 */
export function canonicalInputName(name) {
  const key = String(name ?? '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
  return ALIASES[key] || '';
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseInputList(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(canonicalInputName).filter(Boolean))];
  }
  if (!raw || !String(raw).trim()) return [];
  return [
    ...new Set(
      String(raw)
        .split(',')
        .map((part) => canonicalInputName(part))
        .filter(Boolean)
    ),
  ];
}

/**
 * @param {unknown} value
 */
export function normalizeNewlineList(value) {
  const normalized = String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const entries = normalized.split('\n').filter((line) => line.trim().length > 0);
  return { text: entries.join('\n'), entries, count: entries.length };
}
