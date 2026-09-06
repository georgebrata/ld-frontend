/**
 * Dealer scene: entrance, coat swap, #page reveal, rAF parallax, menu.
 * Velocity is used only for discrete entrance / coat / menu tweens.
 */
(function initScene() {
  const $ = window.jQuery;
  if (!$ || !$.fn || typeof $.fn.velocity !== 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initScene);
    } else {
      window.addEventListener('load', initScene, { once: true });
    }
    return;
  }

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = 'easeInOutQuad';

  $(function () {
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
    const $wrapper = $(wrapper);
    const $page = $(page);
    const $coatClosed = $(coatClosed);
    const $coatOpened = $(coatOpened);
    const $menuHolder = $(menuHolder);
    const $menuItems = $('#menu .menu');
    const $inner = $(inner);

    if (!wrapper && !menuTrigger) return;

    /**
     * @param {boolean} open
     * @param {boolean} animate
     */
    function setCoat(open, animate) {
      if (!coatOpened || !coatClosed) return;
      coatOpened.style.display = 'block';
      coatClosed.style.display = 'block';
      if (!animate || prefersReduced) {
        coatOpened.style.opacity = open ? '1' : '0';
        coatClosed.style.opacity = open ? '0' : '1';
        return;
      }
      $coatOpened.velocity('stop').velocity({ opacity: open ? 1 : 0 }, 200, ease);
      $coatClosed.velocity('stop').velocity({ opacity: open ? 0 : 1 }, 200, ease);
    }

    function revealPage() {
      if (!page) return;
      page.classList.add('is-revealed');
      if (prefersReduced) {
        page.style.opacity = '1';
        return;
      }
      $page.velocity('stop').velocity({ opacity: 1 }, 400, ease);
    }

    function concealPage() {
      if (!page || prefersReduced) return;
      page.classList.remove('is-revealed');
      $page.velocity('stop').velocity({ opacity: 0 }, 200, ease);
    }

    function wiggleCards() {
      if (prefersReduced) return;
      const cards = document.querySelectorAll('.gcard, .home-card, .service-card');
      if (!cards.length) return;
      $(cards)
        .velocity({ rotateZ: '5deg' }, 200, ease)
        .velocity({ rotateZ: '-5deg' }, 200, ease)
        .velocity({ rotateZ: '0deg' }, 200, ease);
    }

    if (coatOpened && coatClosed) {
      setCoat(prefersReduced, false);
    }

    if (prefersReduced) {
      if (wrapper) wrapper.classList.add('loaded');
      if (page) {
        page.style.opacity = '1';
        page.classList.add('is-revealed');
      }
      if (menuTrigger) menuTrigger.style.opacity = '1';
    } else {
      if (page) page.style.opacity = '0';
      if (wrapper) {
        $wrapper.velocity({ translateY: 500, opacity: 0 }, 0).velocity(
          { translateY: 0, opacity: 1 },
          500,
          'easeOutQuad',
          function () {
            wrapper.classList.add('loaded');
          }
        );
      }
      if (intro) {
        $(intro).velocity({ translateY: 150 }, 0).velocity({ translateY: 0 }, 500, 'easeOutQuad');
      }
      if (background) {
        $(background).velocity({ translateY: 400 }, 0).velocity({ translateY: 0 }, 500, 'easeOutQuad');
      }
      if (menuTrigger) {
        $(menuTrigger)
          .velocity({ opacity: 0 }, 0)
          .delay(500)
          .velocity({ opacity: 1 }, 300, ease);
      }
    }

    let desktop = window.innerWidth > 768;
    let coatOpen = prefersReduced;
    let menuOpen = false;
    let ticking = false;
    let lastDelta = window.scrollY || 0;

    /**
     * @param {number} delta
     */
    function applyParallax(delta) {
      if (prefersReduced) return;
      if (desktop) {
        if (logo) logo.style.transform = `translateY(${delta * 0.7}px)`;
        if (intro) intro.style.transform = `translateY(${-delta * 0.5}px)`;
        if (scrolldown) {
          scrolldown.style.opacity = String(Math.max(1 - delta / 200, 0));
          scrolldown.style.transform = `translateY(${delta * 0.3}px)`;
        }
        if (sky) sky.style.transform = `translateY(${-delta * 0.45}px)`;
        return;
      }
      if (background) {
        const winWMax = 0.5 * window.innerWidth;
        background.style.transform = `translateX(${Math.max(-delta / 1.5, -winWMax)}px)`;
      }
    }

    function onFrame() {
      ticking = false;
      const delta = lastDelta;
      const threshold = desktop ? 150 : 0.5 * window.innerWidth * 1.5;
      applyParallax(delta);

      if (delta > threshold && !coatOpen) {
        coatOpen = true;
        setCoat(true, true);
        revealPage();
        wiggleCards();
      } else if (delta <= threshold && coatOpen && !prefersReduced) {
        coatOpen = false;
        setCoat(false, true);
        concealPage();
      }
    }

    window.addEventListener(
      'resize',
      function () {
        desktop = window.innerWidth > 768;
      },
      { passive: true }
    );

    window.addEventListener(
      'scroll',
      function () {
        lastDelta = window.scrollY || document.documentElement.scrollTop || 0;
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(onFrame);
        }
      },
      { passive: true }
    );

    if (menuTrigger) {
      menuTrigger.setAttribute('role', 'button');
      menuTrigger.setAttribute('tabindex', '0');
      menuTrigger.setAttribute('aria-label', 'Open menu');
      menuTrigger.setAttribute('aria-expanded', 'false');
      menuTrigger.setAttribute('aria-controls', 'menu');

      const toggleMenu = function () {
        if (!menuHolder) return;
        if (!menuOpen) {
          menuOpen = true;
          menuTrigger.classList.add('close');
          menuTrigger.setAttribute('aria-expanded', 'true');
          menuTrigger.setAttribute('aria-label', 'Close menu');
          if (inner) inner.classList.add('hidden');
          if (prefersReduced) {
            menuHolder.style.height = '100%';
            menuHolder.style.opacity = '1';
            return;
          }
          $menuHolder.velocity({ height: '100%', opacity: 0 }, 0).velocity({ opacity: 1 }, 400, ease);
          $menuItems.velocity('stop').velocity({ translateY: 500, opacity: 0 }, 0);
          $menuItems.each(function (i) {
            $(this)
              .delay(i * 50)
              .velocity({ translateY: 0, opacity: 1 }, 400, 'easeOutQuad');
          });
          return;
        }

        menuOpen = false;
        menuTrigger.classList.remove('close');
        menuTrigger.setAttribute('aria-expanded', 'false');
        menuTrigger.setAttribute('aria-label', 'Open menu');
        if (inner) inner.classList.remove('hidden');
        if (prefersReduced) {
          menuHolder.style.opacity = '0';
          menuHolder.style.height = '0';
          return;
        }
        $menuHolder.velocity({ opacity: 0 }, 400, ease, function () {
          menuHolder.style.height = '0';
        });
      };

      menuTrigger.addEventListener('click', toggleMenu);
      menuTrigger.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleMenu();
        }
      });
    }
  });
})();
