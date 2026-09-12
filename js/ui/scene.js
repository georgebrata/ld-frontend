/**
 * Dealer scene: entrance, coat swap, #page reveal, rAF parallax, accessible menu.
 * Native Web Animations + CSS transforms. Reduced motion skips tweens.
 *
 * Deferred scripts still run while document.readyState is "loading". Boot as soon
 * as #wrapper exists; do not wait for DOMContentLoaded (some embedded browsers
 * never deliver it to the page listener).
 */
(function () {
  function start() {
    if (window.__ldSceneStarted) return true;
    if (!document.getElementById('wrapper') && !document.getElementById('menu-trigger')) return false;
    window.__ldSceneStarted = true;
    try {
      bootScene();
    } catch {
      const page = document.getElementById('page');
      const wrapper = document.getElementById('wrapper');
      if (wrapper) wrapper.classList.add('loaded');
      if (page) {
        page.style.opacity = '1';
        page.classList.add('is-revealed');
      }
    }
    return true;
  }

  if (!start()) {
    document.addEventListener('DOMContentLoaded', start);
    window.addEventListener('load', start);
    let attempts = 0;
    const poll = window.setInterval(() => {
      attempts += 1;
      if (start() || attempts > 80) window.clearInterval(poll);
    }, 50);
  }

  function bootScene() {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const easeOut = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
    const easeInOut = 'cubic-bezier(0.455, 0.03, 0.515, 0.955)';

    const wrapper = document.getElementById('wrapper');
    const inner = document.getElementById('inner');
    const page = document.getElementById('page');
    const sky = document.getElementById('sky');
    const intro = document.getElementById('intro');
    const logo = document.getElementById('logo');
    const background = document.getElementById('background');
    const scrolldown = document.getElementById('scrolldown');
    const menuTrigger = document.getElementById('menu-trigger');
    const menuHolder = document.getElementById('menu');
    const coatClosed = document.querySelector('#background svg #Closed');
    const coatOpened = document.querySelector('#background svg #Opened');
    const menuItems = menuHolder ? Array.from(menuHolder.querySelectorAll('.menu')) : [];

    /**
     * @param {Element|null} el
     * @param {Keyframe[]|PropertyIndexedKeyframes} frames
     * @param {number} duration
     * @param {string} easing
     * @param {number} [delay]
     */
    function animate(el, frames, duration, easing, delay) {
      if (!el || prefersReduced || typeof el.animate !== 'function') return Promise.resolve();
      try {
        const anim = el.animate(frames, { duration, easing, delay: delay || 0, fill: 'forwards' });
        if (anim && anim.finished && typeof anim.finished.then === 'function') {
          return anim.finished.catch(() => {});
        }
      } catch {
        /* scroll/menu must still work */
      }
      return Promise.resolve();
    }

    function setCoat(open) {
      if (wrapper) wrapper.classList.toggle('coat-open', open);
      if (!coatOpened || !coatClosed) return;
      coatOpened.style.display = 'block';
      coatClosed.style.display = 'block';
      coatOpened.style.removeProperty('opacity');
      coatClosed.style.removeProperty('opacity');
    }

    function revealPage() {
      if (!page) return;
      page.classList.add('is-revealed');
      page.style.removeProperty('opacity');
    }

    function concealPage() {
      /* Once ordering is revealed, keep it available for keyboard and assistive tech. */
    }

    function isMobileScene() {
      return window.innerWidth <= 768;
    }

    function wiggleCards() {
      if (prefersReduced || isMobileScene()) return;
      document.querySelectorAll('.choice-card, .gcard, .home-card, .service-card').forEach((card) => {
        animate(
          card,
          [
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(5deg)' },
            { transform: 'rotate(-5deg)' },
            { transform: 'rotate(0deg)' },
          ],
          600,
          easeInOut
        );
      });
    }

    if (coatOpened && coatClosed) setCoat(prefersReduced);

    if (prefersReduced) {
      if (wrapper) wrapper.classList.add('loaded');
      if (page) {
        page.style.removeProperty('opacity');
        page.classList.add('is-revealed');
      }
      if (menuTrigger) menuTrigger.style.opacity = '1';
    } else {
      if (wrapper) {
        window.setTimeout(() => wrapper.classList.add('loaded'), 520);
      }
      if (menuTrigger) {
        menuTrigger.style.opacity = '0';
        animate(menuTrigger, [{ opacity: 0 }, { opacity: 1 }], 300, easeInOut, 400);
      }
    }

    let desktop = !isMobileScene();
    let coatOpen = prefersReduced;
    let menuOpen = false;
    let lastDelta = window.scrollY || document.documentElement.scrollTop || 0;
    let lastFocused = null;
    let coatX = 0;
    let ticking = false;

    function coatThresholds() {
      if (desktop) return { openAt: 150, closeAt: 70 };
      const width = window.innerWidth;
      return {
        openAt: Math.min(220, width * 0.48),
        closeAt: Math.min(110, width * 0.22),
      };
    }

    function targetCoatX(delta) {
      if (desktop) return 0;
      return Math.max(-delta / 1.35, -0.5 * window.innerWidth);
    }

    function applyDesktopParallax(delta) {
      if (logo) logo.style.transform = `translate3d(0, ${delta * 0.7}px, 0)`;
      if (intro) intro.style.transform = `translate3d(0, ${-delta * 0.5}px, 0)`;
      if (scrolldown) {
        scrolldown.style.opacity = String(Math.max(1 - delta / 200, 0));
        scrolldown.style.transform = `translate3d(0, ${delta * 0.3}px, 0)`;
      }
      if (sky) sky.style.transform = `translate3d(0, ${-delta * 0.45}px, 0)`;
    }

    function updateCoat(delta) {
      const { openAt, closeAt } = coatThresholds();
      if (delta > openAt && !coatOpen) {
        coatOpen = true;
        setCoat(true);
        revealPage();
        wiggleCards();
      } else if (delta <= closeAt && coatOpen && !prefersReduced) {
        coatOpen = false;
        setCoat(false);
        concealPage();
      }
    }

    function onFrame() {
      const delta = lastDelta;
      const targetX = prefersReduced ? 0 : targetCoatX(delta);
      if (desktop) {
        coatX = 0;
        if (background) {
          background.classList.remove('is-moving');
          background.style.removeProperty('transform');
        }
        if (!prefersReduced) applyDesktopParallax(delta);
        updateCoat(delta);
        return;
      }

      if (prefersReduced) {
        updateCoat(delta);
        return;
      }

      coatX += (targetX - coatX) * 0.18;
      if (Math.abs(targetX - coatX) < 0.35) coatX = targetX;
      if (background) {
        background.classList.toggle('is-moving', coatX !== targetX || Math.abs(coatX) > 0.35);
        background.style.transform = `translate3d(${coatX}px, 0, 0)`;
      }
      updateCoat(delta);
      if (coatX !== targetX) requestFrame();
      else if (background) background.classList.remove('is-moving');
    }

    function requestFrame() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        ticking = false;
        onFrame();
      });
    }

    window.addEventListener(
      'resize',
      () => {
        desktop = !isMobileScene();
        requestFrame();
      },
      { passive: true }
    );

    window.addEventListener(
      'scroll',
      () => {
        lastDelta = window.scrollY || document.documentElement.scrollTop || 0;
        requestFrame();
      },
      { passive: true }
    );

    if (lastDelta > 0) requestFrame();

    function setMenuInert(closed) {
      if (!menuHolder) return;
      menuHolder.hidden = closed;
      if ('inert' in menuHolder) menuHolder.inert = closed;
      else if (closed) menuHolder.setAttribute('inert', '');
      else menuHolder.removeAttribute('inert');
      menuHolder.setAttribute('aria-hidden', closed ? 'true' : 'false');
    }

    setMenuInert(true);

    function trapFocus(event) {
      if (!menuOpen || !menuHolder) return;
      const focusable = [menuTrigger, ...menuItems].filter((el) => el instanceof HTMLElement);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.key !== 'Tab') return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function closeMenu() {
      if (!menuOpen || !menuHolder || !menuTrigger) return;
      menuOpen = false;
      menuTrigger.classList.remove('close');
      menuTrigger.setAttribute('aria-expanded', 'false');
      menuTrigger.setAttribute('aria-label', 'Open menu');
      menuHolder.classList.remove('is-open');
      menuHolder.style.removeProperty('height');
      menuHolder.style.removeProperty('opacity');
      if (inner) inner.classList.remove('hidden');
      if (page) page.removeAttribute('inert');
      menuHolder.removeAttribute('role');
      menuHolder.removeAttribute('aria-modal');
      menuHolder.removeAttribute('aria-label');
      setMenuInert(true);
      document.removeEventListener('keydown', trapFocus, true);
      document.documentElement.style.removeProperty('overflow');
      if (lastFocused instanceof HTMLElement) lastFocused.focus();
    }

    function openMenu() {
      if (!menuHolder || !menuTrigger) return;
      menuOpen = true;
      lastFocused = document.activeElement;
      menuTrigger.classList.add('close');
      menuTrigger.setAttribute('aria-expanded', 'true');
      menuTrigger.setAttribute('aria-label', 'Close menu');
      setMenuInert(false);
      menuHolder.classList.add('is-open');
      menuHolder.style.height = '100vh';
      menuHolder.style.opacity = '1';
      if (inner) inner.classList.add('hidden');
      if (page) page.setAttribute('inert', '');
      menuHolder.setAttribute('role', 'dialog');
      menuHolder.setAttribute('aria-modal', 'true');
      menuHolder.setAttribute('aria-label', 'Site menu');
      document.documentElement.style.overflow = 'hidden';
      document.addEventListener('keydown', trapFocus, true);
      if (!prefersReduced) {
        menuItems.forEach((item, i) => {
          animate(item, [{ transform: 'translateY(500px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], 400, easeOut, i * 50);
        });
      }
      const first = menuItems[0];
      if (first instanceof HTMLElement) first.focus();
    }

    function toggleMenu() {
      if (menuOpen) closeMenu();
      else openMenu();
    }

    if (menuTrigger) {
      menuTrigger.addEventListener('click', toggleMenu);
      document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && menuOpen) {
          event.preventDefault();
          closeMenu();
          menuTrigger.focus();
        }
      });
    }
  }
})();
