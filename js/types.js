/**
 * @typedef {Object} Service
 * @property {string} id
 * @property {string} platform
 * @property {string} platformLabel
 * @property {string} service
 * @property {string} label
 * @property {string} description
 * @property {number|null} price
 * @property {string[]} inputs
 * @property {boolean} visible
 * @property {string} [slug]
 * @property {string} [url]
 */

/**
 * @typedef {Object} PlatformSummary
 * @property {string} platform
 * @property {string} platformLabel
 * @property {string} url
 */

/**
 * @typedef {Object} PublicOrder
 * @property {string} [id]
 * @property {string} [displayId]
 * @property {string} [customerEmail]
 * @property {string} [service]
 * @property {string} [platform]
 * @property {number|string} [quantity]
 * @property {string} [status]
 * @property {string} [target]
 * @property {number} [amountPaidCents]
 */

export {};
