import { servicesApi } from '../api/services-api.js';

const TYPE_SPEED = 55;
const DELETE_SPEED = 35;
const PAUSE_AFTER_TYPE = 2200;
const PAUSE_AFTER_DELETE = 400;
const TAGLINE = 'Boost your socials';

function phrasesFromSnapshot() {
  const phrases = servicesApi.readBootstrapPhrases();
  if (phrases && phrases.length) return phrases;
  return [TAGLINE];
}

function buildTypedMarkup(el) {
  el.classList.add('typed-intro');
  el.textContent = '';

  const stable = document.createElement('span');
  stable.className = 'visually-hidden';
  stable.textContent = TAGLINE;

  const textEl = document.createElement('span');
  textEl.className = 'typed-intro__text';
  textEl.setAttribute('aria-hidden', 'true');

  const cursorEl = document.createElement('span');
  cursorEl.className = 'typed-intro__cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.textContent = '|';

  el.appendChild(stable);
  el.appendChild(textEl);
  el.appendChild(cursorEl);
  return { textEl, cursorEl, stable };
}

function tick(textEl, phrases, phraseIndex, charIndex, isDeleting) {
  const current = phrases[phraseIndex];
  if (!isDeleting) {
    textEl.textContent = current.slice(0, charIndex + 1);
    charIndex += 1;
    if (charIndex === current.length) {
      window.setTimeout(() => tick(textEl, phrases, phraseIndex, charIndex, true), PAUSE_AFTER_TYPE);
      return;
    }
    window.setTimeout(() => tick(textEl, phrases, phraseIndex, charIndex, false), TYPE_SPEED);
    return;
  }
  charIndex -= 1;
  textEl.textContent = current.slice(0, charIndex);
  if (charIndex === 0) {
    const nextIndex = (phraseIndex + 1) % phrases.length;
    window.setTimeout(() => tick(textEl, phrases, nextIndex, 0, false), PAUSE_AFTER_DELETE);
    return;
  }
  window.setTimeout(() => tick(textEl, phrases, phraseIndex, charIndex, true), DELETE_SPEED);
}

/**
 * Typed intro. Assistive technology gets a stable tagline; characters are aria-hidden.
 */
export function initTypedIntro() {
  const el = document.getElementById('intro1');
  if (!el) return;

  const { textEl, cursorEl, stable } = buildTypedMarkup(el);
  const phrases = phrasesFromSnapshot();
  stable.textContent = phrases[0] || TAGLINE;
  textEl.textContent = phrases[0] || TAGLINE;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    cursorEl.remove();
    return;
  }

  textEl.textContent = '';
  tick(textEl, phrases, 0, 0, false);
}
