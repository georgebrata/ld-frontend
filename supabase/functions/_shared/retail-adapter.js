/**
 * Storefront sheet-row adapter. Accepts `{ ok: true, data: [...] }` rows with
 * ID/Platform/Service/Description/Price/Inputs/Visible/socialpanelId and lowercase aliases.
 */

import { parseInputList } from './inputs.js';
import { RETAIL_CATALOGUE } from './retail-catalogue.js';

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isVisible(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

/**
 * @param {string} platformLabel
 */
function toPlatformSlug(platformLabel) {
  return String(platformLabel ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

/**
 * @param {unknown} value
 * @returns {import('./retail-catalogue.js').RateUnit}
 */
function parseRateUnit(value) {
  const unit = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (unit === 'per_1000' || unit === 'per1000' || unit === 'per_1k') return 'per_1000';
  if (unit === 'per_unit' || unit === 'per_item') return 'per_unit';
  if (unit === 'package') return 'package';
  if (unit === 'per_comment' || unit === 'per_comments') return 'per_comment';
  return '';
}

/**
 * Normalize a sheet-like row onto the retail service model.
 * Invalid entries return null.
 * @param {Record<string, unknown>} row
 * @param {{ defaultCurrency?: string, defaultMarkup?: number }} [defaults]
 * @returns {import('./retail-catalogue.js').RetailService|null}
 */
export function normalizeRetailRow(row, defaults = {}) {
  const platformLabel = String(row.Platform ?? row.platform ?? row.platformLabel ?? '').trim();
  const platform = toPlatformSlug(platformLabel);
  const service = String(row.Service ?? row.service ?? '').trim();
  const id = String(row.ID ?? row.id ?? row.serviceId ?? '').trim();
  if (!id || !platform || !service) return null;

  const socialpanelId = String(
    row.socialpanelId ?? row.SocialPanelId ?? row.socialPanelId ?? row.SocialpanelId ?? ''
  ).trim();

  const rateUnit =
    parseRateUnit(row.rateUnit ?? row.RateUnit ?? row.rate_unit) ||
    (parseInputList(row.Inputs ?? row.inputs).includes('comments') ? 'per_comment' : 'per_1000');

  const markup = Number(row.markupMultiplier ?? row.markup ?? defaults.defaultMarkup ?? 2);
  const step = Number(row.quantityStep ?? row.QuantityStep ?? 1);
  const qtyDefaultRaw = row.quantityDefault ?? row.QuantityDefault;
  const qtyDefault =
    qtyDefaultRaw == null || qtyDefaultRaw === '' ? (rateUnit === 'per_comment' ? null : 1000) : Number(qtyDefaultRaw);

  if (!Number.isFinite(markup) || markup < 1) return null;
  if (!Number.isInteger(step) || step < 1) return null;

  return {
    id,
    platform,
    platformLabel: platformLabel || platform,
    service,
    description: String(row.Description ?? row.description ?? '').trim(),
    inputs: parseInputList(row.Inputs ?? row.inputs ?? ''),
    visible: isVisible(row.Visible ?? row.visible),
    socialpanelId,
    rateUnit,
    retailCurrency: String(row.retailCurrency ?? row.currency ?? defaults.defaultCurrency ?? 'USD')
      .trim()
      .toUpperCase(),
    markupMultiplier: markup,
    quantityStep: step,
    quantityDefault: Number.isInteger(qtyDefault) ? qtyDefault : null,
    packagePriceMinor:
      row.packagePriceMinor == null || row.packagePriceMinor === ''
        ? null
        : Math.round(Number(row.packagePriceMinor)),
    dripEnabled: isVisible(row.dripEnabled ?? row.drip),
  };
}

/**
 * @param {unknown} payload
 * @param {{ defaultCurrency?: string, defaultMarkup?: number }} [defaults]
 */
export function adaptSheetCatalogue(payload, defaults = {}) {
  let rows = [];
  if (Array.isArray(payload)) rows = payload;
  else if (payload && typeof payload === 'object') {
    const body = /** @type {{ ok?: boolean, data?: unknown, services?: unknown }} */ (payload);
    if (body.ok === false) return [];
    if (Array.isArray(body.data)) rows = body.data;
    else if (Array.isArray(body.services)) rows = body.services;
  }
  return rows
    .map((row) => (row && typeof row === 'object' ? normalizeRetailRow(/** @type {any} */ (row), defaults) : null))
    .filter(Boolean);
}

/**
 * Overlay provider ids from `RETAIL_SOCIALPANEL_IDS` JSON (`{"01":"123"}`)
 * without replacing the bundled retail rows.
 * @param {import('./retail-catalogue.js').RetailService[]} rows
 * @param {string|Record<string, unknown>|undefined} raw
 */
export function applySocialpanelIdOverlay(rows, raw) {
  if (raw == null || raw === '') return rows;
  let map = raw;
  if (typeof raw === 'string') {
    try {
      map = JSON.parse(raw);
    } catch {
      return rows;
    }
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) return rows;
  return rows.map((row) => {
    const next = /** @type {Record<string, unknown>} */ (map)[row.id];
    if (next == null || String(next).trim() === '') return row;
    return { ...row, socialpanelId: String(next).trim() };
  });
}

/**
 * Load retail services: optional remote sheet JSON, else bundled catalogue.
 * @param {{
 *   sheetUrl?: string,
 *   socialpanelIds?: string|Record<string, unknown>,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number,
 *   defaultCurrency?: string,
 *   defaultMarkup?: number
 * }} options
 */
export async function loadRetailCatalogue(options = {}) {
  let rows;
  if (options.sheetUrl) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs || 8000);
    try {
      const response = await (options.fetchImpl || fetch)(options.sheetUrl, { signal: controller.signal });
      if (!response.ok) throw new Error(`Retail catalogue HTTP ${response.status}`);
      const json = await response.json();
      const adapted = adaptSheetCatalogue(json, options);
      rows = adapted.length ? adapted : null;
    } finally {
      clearTimeout(timer);
    }
  }
  if (!rows) rows = RETAIL_CATALOGUE.map((row) => ({ ...row }));
  return applySocialpanelIdOverlay(rows, options.socialpanelIds);
}
