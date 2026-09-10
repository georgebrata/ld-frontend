/**
 * Admin session via GoTrue REST. No supabase-js — CSP is script-src 'self'.
 */

import { CONFIG } from '../config.js';
import { invokeFunction } from '../lib/supabase-client.js';

export const SESSION_KEY = 'ld.adminSession';
const REFRESH_SKEW_MS = 60 * 1000;

function authUrl(grant) {
  return `${CONFIG.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=${grant}`;
}

function authHeaders() {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
  };
}

/**
 * @returns {{ access_token: string, refresh_token: string, expires_at: number, user: object }|null}
 */
export function getSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setSession(session) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

function storeGrant(json) {
  const expiresIn = Number(json.expires_in) || 3600;
  const session = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + expiresIn * 1000,
    user: json.user || getSession()?.user || null,
  };
  setSession(session);
  return session;
}

async function postGrant(grant, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(authUrl(grant), {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({}));
    return { response, json };
  } finally {
    clearTimeout(timer);
  }
}

function grantError(json, fallback) {
  return json?.error_description || json?.msg || json?.error || fallback;
}

export async function signIn(email, password) {
  const { response, json } = await postGrant('password', { email, password });
  if (!response.ok || !json.access_token) {
    throw new Error(grantError(json, 'Sign in failed.'));
  }
  return storeGrant(json);
}

export async function refreshSession() {
  const current = getSession();
  if (!current?.refresh_token) return null;
  const { response, json } = await postGrant('refresh_token', { refresh_token: current.refresh_token });
  if (!response.ok || !json.access_token) {
    clearSession();
    return null;
  }
  return storeGrant(json);
}

export async function getAccessToken() {
  const session = getSession();
  if (!session) return '';
  if (session.expires_at && session.expires_at - REFRESH_SKEW_MS < Date.now()) {
    const next = await refreshSession();
    return next?.access_token || '';
  }
  return session.access_token;
}

export function signOut() {
  clearSession();
}

export function requireSession() {
  if (getSession()) return true;
  window.location.replace('/admin/');
  return false;
}

function setStatus(el, message, isError = false) {
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('form-error', isError);
}

export async function initLoginPage() {
  if (getSession()) {
    window.location.replace('/admin/products/');
    return;
  }

  const form = document.getElementById('admin-login-form');
  const status = document.getElementById('admin-status');
  const registerLink = document.getElementById('admin-register-link');

  try {
    const { json } = await invokeFunction('admin', { body: { action: 'bootstrap' } });
    if (json?.registerOpen && registerLink) registerLink.hidden = false;
  } catch {
    /* bootstrap is optional for login */
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = String(new FormData(form).get('email') || '').trim();
    const password = String(new FormData(form).get('password') || '');
    setStatus(status, 'Signing in…');
    try {
      await signIn(email, password);
      window.location.replace('/admin/products/');
    } catch (err) {
      setStatus(status, err instanceof Error ? err.message : 'Sign in failed.', true);
    }
  });
}

export async function initRegisterPage() {
  const form = document.getElementById('admin-register-form');
  const status = document.getElementById('admin-status');
  const closed = document.getElementById('admin-register-closed');
  const open = document.getElementById('admin-register-open');

  let registerOpen = false;
  try {
    const { json } = await invokeFunction('admin', { body: { action: 'bootstrap' } });
    registerOpen = Boolean(json?.registerOpen);
  } catch {
    registerOpen = false;
  }

  if (!registerOpen) {
    if (open) open.hidden = true;
    if (closed) closed.hidden = false;
    return;
  }
  if (closed) closed.hidden = true;
  if (open) open.hidden = false;

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = String(new FormData(form).get('email') || '').trim();
    const password = String(new FormData(form).get('password') || '');
    const confirm = String(new FormData(form).get('confirm') || '');
    if (password !== confirm) {
      setStatus(status, 'Passwords do not match.', true);
      return;
    }
    setStatus(status, 'Creating admin…');
    try {
      const { response, json } = await invokeFunction('admin', {
        body: { action: 'register', email, password },
      });
      if (!response.ok) {
        throw new Error(json?.error || 'Registration failed.');
      }
      window.location.replace('/admin/');
    } catch (err) {
      setStatus(status, err instanceof Error ? err.message : 'Registration failed.', true);
    }
  });
}

const pageType = document.body?.dataset?.page;
if (pageType === 'admin-login') {
  initLoginPage();
} else if (pageType === 'admin-register') {
  initRegisterPage();
}
