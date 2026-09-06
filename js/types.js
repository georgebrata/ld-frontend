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
 * @property {string} socialpanelId
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
 * @typedef {Object} Order
 * @property {string} [_id]
 * @property {string} CustomerEmail
 * @property {string} Service
 * @property {string} ServiceId
 * @property {string} URL
 * @property {string} Notes
 * @property {number|string} Quantity
 * @property {string} Status
 */

/**
 * @typedef {Object} CreateOrderPayload
 * @property {string} customerEmail
 * @property {string} service
 * @property {string} serviceId
 * @property {string} [url]
 * @property {string} [notes]
 * @property {number} quantity
 * @property {string} [status]
 */

export {};
