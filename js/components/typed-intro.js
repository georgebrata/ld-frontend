import { servicesApi } from '../api/services-api.js';

/** @type {number} */
const TYPE_SPEED = 55;

/** @type {number} */
const DELETE_SPEED = 35;

/** @type {number} */
const PAUSE_AFTER_TYPE = 2200;

/** @type {number} */
const PAUSE_AFTER_DELETE = 400;

const TAGLINE = 'Boost your socials';

/**
 * Build phrase list: tagline first, then all visible service labels from the API.
 * @returns {Promise<string[]>}
 */
async function buildPhrases() {
  try {
    const services = await servicesApi.getServices();
    const labels = services.map((service) => service.label).filter(Boolean);
    return [TAGLINE, ...labels];
  } catch {
    return [TAGLINE];
  }
}

/**
 * Build typed.js-style DOM inside #intro1.
 * @param {HTMLElement} el
 * @returns {{ textEl: HTMLElement, cursorEl: HTMLElement }}
 */
function buildTypedMarkup(el) {
  el.classList.add('typed-intro');
  el.textContent = '';

  const textEl = document.createElement('span');
  textEl.className = 'typed-intro__text';

  const cursorEl = document.createElement('span');
  cursorEl.className = 'typed-intro__cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.textContent = '|';

  el.appendChild(textEl);
  el.appendChild(cursorEl);

  return { textEl, cursorEl };
}

/**
 * Run the typewriter loop.
 * @param {HTMLElement} textEl
 * @param {string[]} phrases
 * @param {number} phraseIndex
 * @param {number} charIndex
 * @param {boolean} isDeleting
 */
function tick(textEl, phrases, phraseIndex, charIndex, isDeleting) {
  const current = phrases[phraseIndex];

  if (!isDeleting) {
    textEl.textContent = current.slice(0, charIndex + 1);
    charIndex += 1;

    if (charIndex === current.length) {
      window.setTimeout(() => {
        tick(textEl, phrases, phraseIndex, charIndex, true);
      }, PAUSE_AFTER_TYPE);
      return;
    }

    window.setTimeout(() => {
      tick(textEl, phrases, phraseIndex, charIndex, false);
    }, TYPE_SPEED);
    return;
  }

  charIndex -= 1;
  textEl.textContent = current.slice(0, charIndex);

  if (charIndex === 0) {
    const nextIndex = (phraseIndex + 1) % phrases.length;
    window.setTimeout(() => {
      tick(textEl, phrases, nextIndex, 0, false);
    }, PAUSE_AFTER_DELETE);
    return;
  }

  window.setTimeout(() => {
    tick(textEl, phrases, phraseIndex, charIndex, true);
  }, DELETE_SPEED);
}

/**
 * Initialise typed.js-style hero tagline on #intro1.
 */
export async function initTypedIntro() {
  const el = document.getElementById('intro1');
  if (!el) return;

  const { textEl } = buildTypedMarkup(el);
  el.setAttribute('aria-live', 'polite');
  textEl.textContent = TAGLINE;

  const phrases = await buildPhrases();

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    textEl.textContent = phrases[0];
    el.querySelector('.typed-intro__cursor')?.remove();
    return;
  }

  textEl.textContent = '';
  tick(textEl, phrases, 0, 0, false);
}
