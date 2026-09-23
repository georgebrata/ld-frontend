import { invokeFunction } from '../lib/supabase-client.js';
import { clearSession, getAccessToken } from './auth.js';

/**
 * @param {string} action
 * @param {Record<string, unknown>} [payload]
 */
export async function adminAction(action, payload = {}) {
  const token = await getAccessToken();
  /** @type {Record<string, string>} */
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const { response, json } = await invokeFunction('admin', {
    method: 'POST',
    headers,
    body: { action, ...payload },
  });

  if (response.status === 401 && action !== 'bootstrap' && action !== 'register') {
    clearSession();
    window.location.replace('/admin/');
  }

  return { response, json };
}

export async function fetchBootstrap() {
  return adminAction('bootstrap');
}
