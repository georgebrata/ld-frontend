import { isVisible } from './validate.js';

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
function parseInputs(raw) {
  if (Array.isArray(raw)) return raw.map(String);
  if (!raw) return [];
  const canon = { commentslist: 'commentsList' };
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => canon[s] ?? s)
    .filter(Boolean);
}

/**
 * @param {Record<string, unknown>} row
 */
export function normalizeService(row) {
  const platformLabel = String(row.Platform ?? row.platform ?? '').trim();
  const platform = platformLabel.toLowerCase().replace(/\s+/g, '');
  return {
    id: String(row.ID ?? row.id ?? row.serviceId ?? '').trim(),
    platform,
    platformLabel: platformLabel || platform,
    service: String(row.Service ?? row.service ?? '').trim(),
    label: `${platformLabel} ${row.Service ?? row.service ?? ''}`.trim(),
    description: String(row.Description ?? row.description ?? '').trim(),
    inputs: parseInputs(row.Inputs ?? row.inputs ?? ''),
    socialpanelId: String(
      row.socialpanelId ?? row.SocialPanelId ?? row.socialPanelId ?? row.SocialpanelId ?? ''
    ).trim(),
    visible: isVisible(row.Visible ?? row.visible),
  };
}

/**
 * @param {Record<string, string>} env
 * @returns {Promise<ReturnType<typeof normalizeService>[]>}
 */
export async function fetchVisibleServices(env) {
  const url = `${env.ORDERS_API_URL}?sheet=Services`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Services API error: ${response.status}`);
  const json = await response.json();
  if (!json.ok || !Array.isArray(json.data)) throw new Error('Invalid services response');
  return json.data.map(normalizeService).filter((service) => service.visible && service.id);
}

/**
 * @param {Record<string, string>} env
 * @param {string} serviceId
 */
export async function getVisibleService(env, serviceId) {
  const services = await fetchVisibleServices(env);
  return services.find((service) => service.id === serviceId) ?? null;
}
