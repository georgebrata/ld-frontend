/**
 * Menu, parallax, and coat swap. Entrance is CSS — do not hide the page.
 */
(function initScene() {
  const $ = window.jQuery;
  if (!$ || !$.fn || typeof $.fn.velocity !== 'function') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initScene);
    }
    return;
  }

  $(function () {
    const $window = $(window);
    const $sky = $('#sky');
    const $intro = $('#intro');
    const $logo = $('#logo');
    const $coatClosed = $('#background svg #Closed');
    const $coatOpened = $('#background svg #Opened');
    const $inner = $('#inner');
    const $background = $('#background');
    const $scrolldown = $('#scrolldown');
    const $menuTrigger = $('#menu-trigger');
    const $menuHolder = $('#menu');
    const $menuItems = $('#menu .menu');
    const $wrapper = $('#wrapper');
    const ease = 'easeInOutQuad';

    if (!$wrapper.length && !$menuTrigger.length) return;

    $wrapper.addClass('loaded');

    if ($coatOpened.length && $coatClosed.length) {
      $coatOpened.css({ display: 'block', opacity: 0 });
      $coatClosed.css({ display: 'block', opacity: 1 });
    }

    let desktop = $window.width() > 768;
    let coatOpen = false;
    let menuOpen = false;

    $window.on('resize', function () {
      desktop = $window.width() > 768;
    });

    $menuTrigger.on('click', function () {
      if (!menuOpen) {
        menuOpen = true;
        $menuTrigger.addClass('close');
        $inner.addClass('hidden');
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
      $menuTrigger.removeClass('close');
      $inner.removeClass('hidden');
      $menuHolder.velocity({ opacity: 0 }, 400, ease, function () {
        $menuHolder.css({ height: 0 });
      });
    });

    $window.on('scroll', function () {
      if (typeof $.fn.velocity !== 'function') return;

      const delta = $window.scrollTop();
      const winW = $window.width();
      const winWMax = 0.5 * winW;

      if (desktop) {
        if ($sky.length) {
          $sky.velocity({ translateY: -delta * 0.7 }, { duration: 0, queue: false });
        }
        if ($intro.length) {
          $intro.velocity({ translateY: -delta * 0.5 }, { duration: 0, queue: false });
        }
        if ($scrolldown.length) {
          $scrolldown.velocity(
            { opacity: Math.max(1 - delta / 200, 0), translateY: delta * 0.3 },
            { duration: 0, queue: false }
          );
        }
        if ($logo.length) {
          $logo.velocity({ translateY: delta * 0.45 }, { duration: 0, queue: false });
        }

        if (delta > 150 && !coatOpen) {
          coatOpen = true;
          $coatOpened.velocity('stop').velocity({ opacity: 1 }, 200, ease);
          $coatClosed.velocity('stop').velocity({ opacity: 0 }, 200, ease);
          $('.gcard, .home-card, .service-card')
            .velocity({ rotateZ: '5deg' }, 200, ease)
            .velocity({ rotateZ: '-5deg' }, 200, ease)
            .velocity({ rotateZ: '0deg' }, 200, ease);
        } else if (delta <= 150 && coatOpen) {
          coatOpen = false;
          $coatOpened.velocity('stop').velocity({ opacity: 0 }, 200, ease);
          $coatClosed.velocity('stop').velocity({ opacity: 1 }, 200, ease);
        }
        return;
      }

      if ($background.length) {
        $background.velocity(
          { translateX: Math.max(-delta / 1.5, -winWMax) },
          { duration: 0, queue: false }
        );
      }

      if (delta > winWMax * 1.5 && !coatOpen) {
        coatOpen = true;
        $coatOpened.velocity('stop').velocity({ opacity: 1 }, 200, ease);
        $coatClosed.velocity('stop').velocity({ opacity: 0 }, 200, ease);
      } else if (delta <= winWMax * 1.5 && coatOpen) {
        coatOpen = false;
        $coatOpened.velocity('stop').velocity({ opacity: 0 }, 200, ease);
        $coatClosed.velocity('stop').velocity({ opacity: 1 }, 200, ease);
      }
    });
  });
})();
