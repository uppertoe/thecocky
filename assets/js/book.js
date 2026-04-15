/* ─────────────────────────────────────────────────────────
   The Great Cocky — page-turn engine
   ─────────────────────────────────────────────────────────
   Spreads are rendered server-side inside a fixed-size viewport.
   Embla Carousel drives the vertical rail, with the wheel-gestures
   plugin mapping trackpad/mousewheel input onto the same drag path
   as a touch swipe. `containScroll: 'trimSnaps'` gives us the hard
   end-stops that the hand-rolled version was missing.

   Desktop: one slide per spread. Mobile: one slide per leaf inside
   paired spreads, with solo spreads still treated as a single page.
*/

(function () {
  const book = document.getElementById('book');
  const viewport = document.getElementById('book-viewport');
  const rail = document.getElementById('book-rail');
  if (!book || !viewport || !rail) return;
  if (typeof EmblaCarousel !== 'function') return;

  book.classList.add('is-ready');

  const mobileMQ = window.matchMedia('(max-width: 760px)');
  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');

  function slidesFor() {
    const selector = mobileMQ.matches
      ? '.spread--solo, .spread:not(.spread--solo) > .leaf'
      : ':scope > .spread';
    return Array.from(rail.querySelectorAll(selector));
  }

  let startIndex = 0;
  try {
    const saved = parseInt(sessionStorage.getItem('cocky:page') || '0', 10);
    if (!Number.isNaN(saved) && saved > 0) startIndex = saved;
  } catch (e) {}

  const plugins = typeof EmblaCarouselWheelGestures === 'function'
    ? [EmblaCarouselWheelGestures({ forceWheelAxis: 'y' })]
    : [];

  const embla = EmblaCarousel(viewport, {
    axis: 'y',
    align: 'start',
    containScroll: 'trimSnaps',
    skipSnaps: false,
    dragFree: false,
    watchDrag: true,
    duration: reducedMQ.matches ? 0 : 26,
    startIndex,
    slides: slidesFor(),
  }, plugins);

  // ── UI wiring ───────────────────────────────────────────
  const $current = document.getElementById('page-current');
  const $total = document.getElementById('page-total');
  const $prev = document.getElementById('btn-prev');
  const $next = document.getElementById('btn-next');
  const $edgePrev = document.getElementById('edge-prev');
  const $edgeNext = document.getElementById('edge-next');
  const $progressFill = document.getElementById('progress-fill');
  const $progressBar = document.getElementById('progress-bar');
  const $hint = document.getElementById('scroll-hint');

  function updateUI() {
    const idx = embla.selectedScrollSnap();
    const total = embla.scrollSnapList().length;
    if ($current) $current.textContent = String(idx + 1);
    if ($total) $total.textContent = String(total);
    if ($prev) $prev.disabled = !embla.canScrollPrev();
    if ($next) $next.disabled = !embla.canScrollNext();
    if ($progressFill) {
      const pct = total > 1 ? (idx / (total - 1)) * 100 : 100;
      $progressFill.style.width = pct + '%';
    }
    if ($progressBar) {
      $progressBar.setAttribute('aria-valuemax', String(total));
      $progressBar.setAttribute('aria-valuenow', String(idx + 1));
    }
    try { sessionStorage.setItem('cocky:page', String(idx)); } catch (e) {}
  }

  embla.on('init', updateUI);
  embla.on('select', updateUI);
  embla.on('reInit', updateUI);

  if ($prev) $prev.addEventListener('click', () => embla.scrollPrev());
  if ($next) $next.addEventListener('click', () => embla.scrollNext());
  if ($edgePrev) $edgePrev.addEventListener('click', () => embla.scrollPrev());
  if ($edgeNext) $edgeNext.addEventListener('click', () => embla.scrollNext());

  // ── Progress-bar scrubbing ─────────────────────────────
  // Tap to jump, drag to scrub. Doubles as the "back to start"
  // affordance — no extra UI required.
  if ($progressBar) {
    let scrubbing = false;
    let lastIdx = -1;

    function pageFromEvent(e) {
      const rect = $progressBar.getBoundingClientRect();
      const total = embla.scrollSnapList().length;
      if (rect.width <= 0 || total <= 1) return 0;
      let frac = (e.clientX - rect.left) / rect.width;
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      return Math.round(frac * (total - 1));
    }

    function jumpTo(idx) {
      if (idx === lastIdx) return;
      lastIdx = idx;
      embla.scrollTo(idx, true); // jump — no animation while dragging
    }

    $progressBar.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      scrubbing = true;
      lastIdx = -1;
      $progressBar.classList.add('is-scrubbing');
      try { $progressBar.setPointerCapture(e.pointerId); } catch (err) {}
      jumpTo(pageFromEvent(e));
      dismissHint();
    });

    $progressBar.addEventListener('pointermove', (e) => {
      if (!scrubbing) return;
      jumpTo(pageFromEvent(e));
    });

    function endScrub(e) {
      if (!scrubbing) return;
      scrubbing = false;
      $progressBar.classList.remove('is-scrubbing');
      try { $progressBar.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    $progressBar.addEventListener('pointerup', endScrub);
    $progressBar.addEventListener('pointercancel', endScrub);
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        embla.scrollPrev();
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        embla.scrollNext();
        break;
      case 'Home':
        e.preventDefault();
        embla.scrollTo(0);
        break;
      case 'End':
        e.preventDefault();
        embla.scrollTo(embla.scrollSnapList().length - 1);
        break;
    }
  });

  // ── Re-init on breakpoint crossing ──────────────────────
  // Crossing the mobile breakpoint changes what counts as a page
  // (whole spreads ↔ individual leaves), so rebuild Embla with the
  // new slide list, re-anchored to the same spread.
  let wasMobile = mobileMQ.matches;
  function handleBreakpoint() {
    const nowMobile = mobileMQ.matches;
    if (nowMobile === wasMobile) return;
    wasMobile = nowMobile;

    const currentSlide = embla.slideNodes()[embla.selectedScrollSnap()];
    const anchor = currentSlide && currentSlide.closest
      ? (currentSlide.closest('.spread') || currentSlide)
      : currentSlide;

    const newSlides = slidesFor();
    let newIdx = newSlides.indexOf(anchor);
    if (newIdx < 0 && anchor) {
      newIdx = newSlides.findIndex((s) =>
        s === anchor
        || (anchor.contains && anchor.contains(s))
        || (s.contains && s.contains(anchor))
      );
    }
    if (newIdx < 0) newIdx = 0;

    embla.reInit({ slides: newSlides, startIndex: newIdx });
  }
  if (mobileMQ.addEventListener) {
    mobileMQ.addEventListener('change', handleBreakpoint);
  } else if (mobileMQ.addListener) {
    mobileMQ.addListener(handleBreakpoint);
  }

  // ── Dismiss the "scroll to read" hint ──────────────────
  let hintDismissed = false;
  function dismissHint() {
    if (hintDismissed || !$hint) return;
    hintDismissed = true;
    $hint.classList.add('is-hidden');
  }
  [$prev, $next, $edgePrev, $edgeNext].forEach((btn) => {
    if (btn) btn.addEventListener('click', dismissHint);
  });
  embla.on('select', dismissHint);
  document.addEventListener('keydown', dismissHint, { once: true });
  window.addEventListener('wheel', dismissHint, { once: true, passive: true });
  viewport.addEventListener('touchstart', dismissHint, { once: true, passive: true });
  setTimeout(dismissHint, 9000);

  // ── Pre-decode images so turns never race the decoder ──
  viewport.querySelectorAll('img').forEach((img) => {
    const decode = () => { if (img.decode) img.decode().catch(() => {}); };
    if (img.complete && img.naturalWidth > 0) decode();
    else img.addEventListener('load', decode, { once: true });
  });

  // ── Share ───────────────────────────────────────────────
  const shareUrlBase = window.location.href.split('#')[0].split('?')[0];
  const shareTitle = document.title;
  const shareText = (document.querySelector('meta[name="description"]') || {}).content
    || 'A picture book worth passing on.';

  const refUrl = (channel) => shareUrlBase + (shareUrlBase.includes('?') ? '&' : '?') + 'ref=' + channel;

  function flashCopied(btn) {
    const original = btn.textContent;
    btn.textContent = 'Link copied';
    btn.classList.add('is-success');
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove('is-success');
    }, 1800);
  }

  document.querySelectorAll('[data-share]').forEach((btn) => {
    const kind = btn.dataset.share;

    if (kind === 'native') {
      if (!navigator.share) return;
      btn.hidden = false;
      btn.addEventListener('click', () => {
        navigator.share({ title: shareTitle, text: shareText, url: refUrl('share') }).catch(() => {});
      });
      return;
    }

    if (kind === 'copy') {
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          await navigator.clipboard.writeText(refUrl('copy'));
          flashCopied(btn);
        } catch (err) {}
      });
      return;
    }

    if (kind === 'email') {
      btn.href = 'mailto:?subject=' + encodeURIComponent(shareTitle)
        + '&body=' + encodeURIComponent(shareText + '\n\n' + refUrl('email'));
      return;
    }

    if (kind === 'bluesky') {
      btn.href = 'https://bsky.app/intent/compose?text='
        + encodeURIComponent(shareTitle + ' — ' + refUrl('bluesky'));
      return;
    }

    if (kind === 'whatsapp') {
      btn.href = 'https://wa.me/?text='
        + encodeURIComponent(shareTitle + ' — ' + refUrl('whatsapp'));
      return;
    }

    if (kind === 'threads') {
      btn.href = 'https://www.threads.net/intent/post?text='
        + encodeURIComponent(shareTitle + ' — ' + refUrl('threads'));
      return;
    }
  });

  // ── Nav share button ────────────────────────────────────
  const $navShare = document.getElementById('nav-share');
  const $navToast = document.getElementById('nav-share-toast');
  if ($navShare) {
    $navShare.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({ title: shareTitle, text: shareText, url: refUrl('nav') });
          return;
        } catch (e) { /* fall through to clipboard */ }
      }
      try {
        await navigator.clipboard.writeText(refUrl('nav'));
        if ($navToast) {
          $navToast.classList.add('is-visible');
          setTimeout(() => $navToast.classList.remove('is-visible'), 1800);
        }
      } catch (e) {}
    });
  }
})();
