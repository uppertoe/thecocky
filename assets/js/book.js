/* ─────────────────────────────────────────────────────────
   The Great Cocky — page-turn engine
   ─────────────────────────────────────────────────────────
   Spreads are rendered server-side by Hugo. This script:
     • activates one spread at a time
     • handles prev/next, keyboard, swipe, edge-clicks
     • splits paired spreads into two virtual pages on mobile
     • drives the share buttons (end card + nav)
*/

(function () {
  const html = document.documentElement;
  const book = document.getElementById('book');
  const viewport = document.getElementById('book-viewport');
  if (!book || !viewport) return;

  const spreadEls = Array.from(viewport.querySelectorAll('.spread'));
  if (spreadEls.length === 0) return;

  book.classList.add('is-ready');

  // ── Mobile sub-page handling ────────────────────────────
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches;

  function buildVirtualPages() {
    const pages = [];
    spreadEls.forEach((el, idx) => {
      const isPaired = el.querySelectorAll('.leaf').length === 2;
      if (isPaired && isMobile()) {
        pages.push({ spread: idx, half: 0 });
        pages.push({ spread: idx, half: 1 });
      } else {
        pages.push({ spread: idx, half: null });
      }
    });
    return pages;
  }

  let pages = buildVirtualPages();
  let current = 0;
  let lastSpreadIdx = -1;

  const turnMs = (() => {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--turn-dur').trim();
    if (raw.endsWith('ms')) return parseFloat(raw);
    if (raw.endsWith('s'))  return parseFloat(raw) * 1000;
    return 420;
  })();

  const $current = document.getElementById('page-current');
  const $total = document.getElementById('page-total');
  const $prev = document.getElementById('btn-prev');
  const $next = document.getElementById('btn-next');
  const $edgePrev = document.getElementById('edge-prev');
  const $edgeNext = document.getElementById('edge-next');
  const $progressFill = document.getElementById('progress-fill');

  function render() {
    const target = pages[current];
    const newSpreadIdx = target.spread;
    const changed = newSpreadIdx !== lastSpreadIdx;

    spreadEls.forEach((el, idx) => {
      const isActive = idx === newSpreadIdx;
      const wasActive = idx === lastSpreadIdx;

      if (isActive) {
        el.classList.remove('is-leaving');
        // Toggle the half BEFORE replaying the animation so the
        // newly visible leaf is the one that slides in.
        el.classList.toggle('is-mobile-second', target.half === 1);
        // Force-replay the entrance animation on every turn — including
        // within-pair half swaps on mobile — so every transition feels
        // the same as a cross-spread page turn.
        if (el.classList.contains('is-active')) {
          el.classList.remove('is-active');
          void el.offsetWidth;
        }
        el.classList.add('is-active');
      } else {
        if (wasActive && changed) {
          el.classList.remove('is-active');
          el.classList.add('is-leaving');
          setTimeout(() => el.classList.remove('is-leaving'), turnMs + 40);
        } else {
          el.classList.remove('is-active');
          el.classList.remove('is-leaving');
        }
        el.classList.remove('is-mobile-second');
      }

      el.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    });

    lastSpreadIdx = newSpreadIdx;

    $current.textContent = String(current + 1);
    $total.textContent = String(pages.length);
    $prev.disabled = current === 0;
    $next.disabled = current === pages.length - 1;
    if ($progressFill) {
      const pct = pages.length > 1 ? (current / (pages.length - 1)) * 100 : 100;
      $progressFill.style.width = pct + '%';
    }

    try { sessionStorage.setItem('cocky:page', String(current)); } catch (e) {}
  }

  function setDir(delta) {
    book.dataset.dir = delta < 0 ? 'back' : 'fwd';
  }

  function go(delta) {
    const next = current + delta;
    if (next < 0 || next >= pages.length) return;
    setDir(delta);
    current = next;
    render();
    preloadNeighbours();
  }

  function goTo(idx) {
    if (idx < 0 || idx >= pages.length) return;
    setDir(idx - current);
    current = idx;
    render();
    preloadNeighbours();
  }

  // Restore progress
  try {
    const saved = parseInt(sessionStorage.getItem('cocky:page') || '0', 10);
    if (!Number.isNaN(saved) && saved >= 0 && saved < pages.length) current = saved;
  } catch (e) {}

  // ── Wire up controls ────────────────────────────────────
  $prev.addEventListener('click', () => go(-1));
  $next.addEventListener('click', () => go(+1));
  $edgePrev.addEventListener('click', () => go(-1));
  $edgeNext.addEventListener('click', () => go(+1));

  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;
    switch (e.key) {
      case 'ArrowLeft':
      case 'PageUp':
        e.preventDefault();
        go(-1);
        break;
      case 'ArrowRight':
      case 'PageDown':
      case ' ':
        e.preventDefault();
        go(+1);
        break;
      case 'Home':
        e.preventDefault();
        goTo(0);
        break;
      case 'End':
        e.preventDefault();
        goTo(pages.length - 1);
        break;
    }
  });

  // ── Touch / swipe ───────────────────────────────────────
  let touchStartX = null;
  let touchStartY = null;
  viewport.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    const dy = t.clientY - touchStartY;
    touchStartX = touchStartY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    go(dx < 0 ? +1 : -1);
  }, { passive: true });

  // ── Resize: rebuild virtual pages if mobile state changed
  let wasMobile = isMobile();
  window.addEventListener('resize', () => {
    const nowMobile = isMobile();
    if (nowMobile !== wasMobile) {
      wasMobile = nowMobile;
      const targetSpread = pages[current].spread;
      pages = buildVirtualPages();
      current = pages.findIndex(p => p.spread === targetSpread);
      if (current < 0) current = 0;
      render();
    }
  });

  // ── Preload neighbour images for snappier turns ─────────
  function preloadNeighbours() {
    const window_ = 2;
    for (let d = -window_; d <= window_; d++) {
      const idx = current + d;
      if (idx < 0 || idx >= pages.length) continue;
      const sp = spreadEls[pages[idx].spread];
      sp.querySelectorAll('img[loading="lazy"]').forEach(img => {
        img.loading = 'eager';
      });
    }
  }

  render();
  preloadNeighbours();

  // ── Share ───────────────────────────────────────────────
  const shareUrlBase = window.location.href.split('#')[0].split('?')[0];
  const shareTitle = document.title;
  const shareText = (document.querySelector('meta[name="description"]') || {}).content
    || 'A picture book worth passing on.';

  // Each channel gets a ?ref=<channel> tag so analytics can attribute.
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
      if (!navigator.share) return; // stays hidden
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
