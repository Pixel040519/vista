// News & announcements on Home — the newest public posts, side by side.
//
// Reads the same source as the Announcements page (useAnnouncements), so the two
// can never disagree about what the school has published.
//
// Decisions worth keeping:
//   - The track is native horizontal scroll with CSS scroll-snap, not a slider
//     library. Touch swipe, trackpad and shift+wheel all work for free, and the
//     Previous / Next buttons only nudge it by one card.
//   - Every card has a 16:9 media slot, picture or not. A post without an image
//     gets a drawn tile for its category in that slot, so a row of mixed posts
//     still lines up instead of cards jumping between two heights.
//   - No autoplay. A notice moving while someone reads it is the classic
//     carousel failure, and it is an accessibility failure too.
//   - A card opens the full post in a modal on Home rather than sending the
//     visitor to /announcements. The modal has a FIXED height and its text
//     scrolls inside it, so neither a long post nor opening one ever changes the
//     height of the section behind it.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Label, Icon, IconTile, SECTION, HEADING } from './ui';
import { FACEBOOK_PAGE } from '../data/announcements';
import { useAnnouncements } from '../lib/publicContent';
import AnnouncementMedia from './AnnouncementMedia';
import { MEGAPHONE } from './announcementIcons';

const LIMIT = 9;

// Card width per breakpoint: one with the next peeking in on phones, then two, then three.
const CARD_WIDTH = 'w-[85%] md:w-[calc((100%-1.5rem)/2)] lg:w-[calc((100%-3rem)/3)]';

const scrollBehavior = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002855] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F0F4F8] dark:focus-visible:ring-yellow-400 dark:focus-visible:ring-offset-[#001f44]';

// Inside the modal the surface behind a focus ring is the panel, not the band.
const DIALOG_FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002855] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-yellow-400 dark:focus-visible:ring-offset-[#0d2a4d]';

const ArrowRight = ({ className = '' }) => (
  <Icon size={16} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

function ViewAllLink({ label = 'View all announcements', className = '' }) {
  return (
    <Link
      to="/announcements"
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#002855] px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#003a7a] dark:bg-yellow-500 dark:text-[#002855] dark:hover:bg-yellow-400 ${FOCUS_RING} ${className}`}
    >
      {label}
      <ArrowRight />
    </Link>
  );
}

function NavButtons({ atStart, atEnd, onStep }) {
  const base = `flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-[#002855] transition-colors hover:border-[#002855] hover:bg-[#002855] hover:text-white disabled:pointer-events-none disabled:opacity-35 dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:border-yellow-400 dark:hover:bg-yellow-400 dark:hover:text-[#002855] ${FOCUS_RING}`;
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onStep(-1)}
        disabled={atStart}
        aria-label="Previous announcements"
        className={base}
      >
        <Icon size={20}>
          <path d="m15 18-6-6 6-6" />
        </Icon>
      </button>
      <button
        type="button"
        onClick={() => onStep(1)}
        disabled={atEnd}
        aria-label="Next announcements"
        className={base}
      >
        <Icon size={20}>
          <path d="m9 18 6-6-6-6" />
        </Icon>
      </button>
    </div>
  );
}

function NewsCard({ post, index, total, onOpen, articleRef }) {
  return (
    <article
      ref={articleRef}
      role="group"
      aria-roledescription="slide"
      aria-label={`${index + 1} of ${total}`}
      className={`group relative flex shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-colors has-[button:focus-visible]:ring-2 has-[button:focus-visible]:ring-[#002855] hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:has-[button:focus-visible]:ring-yellow-400 dark:hover:border-white/25 ${CARD_WIDTH}`}
    >
      <AnnouncementMedia post={post} />

      <div className="flex flex-1 flex-col p-6">
        <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
          <Label className="text-slate-500 dark:text-slate-400">{post.date}</Label>
          {post.isPinned && (
            <span className="rounded-full bg-yellow-400 px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#002855]">
              Pinned
            </span>
          )}
        </div>

        {/* The title button stretches over the whole card, so the card is one target. */}
        <h3 className="mb-2 line-clamp-2 min-h-[2lh] text-lg font-semibold leading-snug text-[#001f3f] transition-colors group-hover:text-[#003a7a] dark:text-white dark:group-hover:text-yellow-400">
          <button
            type="button"
            onClick={() => onOpen(post.id)}
            aria-haspopup="dialog"
            className="text-left outline-none after:absolute after:inset-0 after:content-['']"
          >
            {post.title}
          </button>
        </h3>

        {post.excerpt && (
          <p className="line-clamp-3 text-[15px] leading-relaxed text-slate-600 dark:text-slate-300">
            {post.excerpt}
          </p>
        )}

        <span
          aria-hidden="true"
          className="mt-auto inline-flex items-center gap-1.5 pt-5 text-sm font-semibold text-[#002855] dark:text-yellow-400"
        >
          Read more
          <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
        </span>
      </div>
    </article>
  );
}

// The full post, in a modal of fixed height. Only the text column scrolls, so
// the picture and the footer stay put however long the post is.
//
// It stays mounted and fades out rather than unmounting, so closing animates
// with the post still in it; `inert` + `invisible` take it out of the tab order
// and the accessibility tree while shut. It grows from the card that opened it:
// `origin` is that card's centre in the dialog's own coordinates.
function NewsDialog({ post, open, origin, onClose, dialogRef, closeRef, scrollRef, scrolled, setScrolled }) {
  // Keep Tab inside the dialog while it is open.
  const trapFocus = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      inert={!open}
      // Visibility is transitioned only on the way OUT (so the fade can finish).
      // On the way in it must flip at once: a transition from hidden starts
      // hidden, and the close button could not take focus in that first frame.
      className={`fixed inset-0 z-[100] flex items-center justify-center p-4 duration-300 motion-reduce:transition-none sm:p-6 ${
        open
          ? 'visible opacity-100 transition-opacity'
          : 'invisible opacity-0 transition-[opacity,visibility]'
      }`}
    >
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-[#04121f]/70 backdrop-blur-sm"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="news-dialog-title"
        onKeyDown={trapFocus}
        style={{ transformOrigin: origin }}
        className={`relative flex h-[min(40rem,calc(100dvh-2rem))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_64px_-16px_rgba(0,20,40,0.45)] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:h-[min(40rem,calc(100dvh-3rem))] md:flex-row dark:bg-[#0d2a4d] ${
          open ? 'scale-100 opacity-100' : 'scale-[0.92] opacity-0'
        }`}
      >
        {post && (
          <>
            <AnnouncementMedia
              post={post}
              large
              className="h-44 sm:h-56 md:h-auto md:w-[42%] md:self-stretch"
            />

            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {/* Header: stays put while the text scrolls, so the close button
                  never sits on top of it. Its rule appears once the text has
                  scrolled beneath it. */}
              <div
                className={`flex shrink-0 items-center justify-between gap-4 border-b py-3 pl-6 pr-3 transition-colors sm:pl-8 sm:pr-4 lg:pl-10 ${
                  scrolled ? 'border-slate-200 dark:border-white/10' : 'border-transparent'
                }`}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-3">
                  {post.isPinned && (
                    <span className="rounded-full bg-yellow-400 px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#002855]">
                      Pinned
                    </span>
                  )}
                  <Label className="text-slate-500 dark:text-slate-400">{post.date}</Label>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  onClick={onClose}
                  aria-label="Close announcement"
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-600 transition-colors hover:border-[#002855] hover:text-[#002855] dark:border-white/15 dark:text-slate-300 dark:hover:border-yellow-400 dark:hover:text-yellow-400 ${DIALOG_FOCUS_RING}`}
                >
                  <Icon size={18}>
                    <path d="M18 6 6 18M6 6l12 12" />
                  </Icon>
                </button>
              </div>

              <div
                ref={scrollRef}
                onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
                className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-8 pt-2 sm:px-8 lg:px-10"
              >
                <h3
                  id="news-dialog-title"
                  className="mb-4 text-2xl font-bold leading-snug tracking-tight text-[#001f3f] sm:text-[28px] dark:text-white"
                >
                  {post.title}
                </h3>
                {post.summary && (
                  <p className="selectable mb-4 font-medium leading-relaxed text-slate-700 dark:text-slate-200">
                    {post.summary}
                  </p>
                )}
                <p className="selectable whitespace-pre-line leading-relaxed text-slate-600 dark:text-slate-300">
                  {post.content}
                </p>
              </div>

              <div className="flex shrink-0 items-center justify-between gap-4 border-t border-slate-200 px-6 py-4 sm:px-8 lg:px-10 dark:border-white/10">
                <Link
                  to="/announcements"
                  className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-[#002855] hover:underline dark:text-yellow-400 ${DIALOG_FOCUS_RING}`}
                >
                  All announcements
                  <ArrowRight />
                </Link>
                <button
                  type="button"
                  onClick={onClose}
                  className={`rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-[#002855] transition-colors hover:border-[#002855] hover:bg-[#002855] hover:text-white dark:border-white/15 dark:text-white dark:hover:border-yellow-400 dark:hover:bg-yellow-400 dark:hover:text-[#002855] ${DIALOG_FOCUS_RING}`}
                >
                  Close
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div
      className={`flex shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5 ${CARD_WIDTH}`}
    >
      <div className="aspect-[16/9] animate-pulse bg-slate-200 dark:bg-white/10" />
      <div className="flex flex-col gap-3 p-6">
        <div className="h-3 w-28 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="h-5 w-11/12 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="h-5 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="mt-2 h-3.5 w-full animate-pulse rounded bg-slate-100 dark:bg-white/5" />
        <div className="h-3.5 w-5/6 animate-pulse rounded bg-slate-100 dark:bg-white/5" />
      </div>
    </div>
  );
}

export default function NewsCarousel() {
  const { status, announcements } = useAnnouncements(LIMIT);
  const posts = announcements;
  const hasPosts = posts.length > 0;
  const isEmpty = status !== 'loading' && !hasPosts;

  const trackRef = useRef(null);
  // Which ends the track is scrolled to. Both true = everything fits, no buttons.
  const [edges, setEdges] = useState({ atStart: true, atEnd: true });

  const measure = useCallback(() => {
    const el = trackRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = { atStart: el.scrollLeft <= 1, atEnd: el.scrollLeft >= max - 1 };
    setEdges((prev) =>
      prev.atStart === next.atStart && prev.atEnd === next.atEnd ? prev : next
    );
  }, []);

  useEffect(() => {
    const el = trackRef.current;
    if (!el || !hasPosts) return undefined;
    el.addEventListener('scroll', measure, { passive: true });
    // Also fires once on observe, which takes the first measurement before paint.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      ro.disconnect();
    };
  }, [hasPosts, posts.length, measure]);

  // Move by exactly one card (plus the gap), and let scroll-snap settle it.
  const step = useCallback((dir) => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.firstElementChild;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const distance = card ? card.getBoundingClientRect().width + gap : el.clientWidth;
    el.scrollBy({ left: dir * distance, behavior: scrollBehavior() });
  }, []);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    }
  };

  const showNav = hasPosts && !(edges.atStart && edges.atEnd);

  // ── The modal ────────────────────────────────────────────────────────────
  // openId is what is open now; shownId is what the dialog holds, which
  // outlives openId while the dialog fades out.
  const [openId, setOpenId] = useState(null);
  const [shownId, setShownId] = useState(null);
  const [origin, setOrigin] = useState('50% 50%');
  const [scrolled, setScrolled] = useState(false);
  const shown = posts.find((p) => p.id === shownId) || null;
  const isOpen = openId !== null && posts.some((p) => p.id === openId);

  const cardRefs = useRef(new Map());
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const scrollRef = useRef(null);

  const open = (id) => {
    // Grow out of the card that was chosen. The dialog is mounted (invisible) at
    // all times, so its box can be measured before it appears.
    const card = cardRefs.current.get(id)?.getBoundingClientRect();
    const box = dialogRef.current?.getBoundingClientRect();
    if (card && box) {
      setOrigin(
        `${card.left + card.width / 2 - box.left}px ${card.top + card.height / 2 - box.top}px`
      );
    }
    // Every post starts at its top, whatever the last one was scrolled to.
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setScrolled(false);
    setShownId(id);
    setOpenId(id);
  };

  const close = useCallback(() => {
    // Hand focus back to the card that opened it, not to the top of the page.
    if (openId) cardRefs.current.get(openId)?.querySelector('button')?.focus({ preventScroll: true });
    setOpenId(null);
  }, [openId]);

  // While open: the page behind does not scroll, Escape closes, and focus moves
  // into the dialog. The scrollbar's width is padded back so the page does not
  // shift sideways when it disappears.
  useEffect(() => {
    if (!isOpen) return undefined;
    const body = document.body;
    const previous = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;
    body.style.overflow = 'hidden';
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    closeRef.current?.focus({ preventScroll: true });

    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
    };
  }, [isOpen, close]);

  return (
    <section className="border-b border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
      <div className={SECTION}>
        <div className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">
              News &amp; announcements
            </Label>
            <h2 className={HEADING}>Latest from Yorklin</h2>
          </div>

          {!isEmpty && (
            <div className="hidden items-center gap-4 sm:flex">
              {showNav && <NavButtons {...edges} onStep={step} />}
              <ViewAllLink />
            </div>
          )}
        </div>

        {status === 'loading' && (
          <div
            className="-mx-6 flex gap-6 overflow-hidden px-6 sm:mx-0 sm:px-0"
            aria-busy="true"
            aria-label="Loading announcements"
          >
            {[0, 1, 2].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {hasPosts && (
          // Bleeds to the screen edge on phones so the next card visibly runs off it.
          // The 4px of padding on every side keeps the cards' focus ring from being
          // clipped by the scroll container.
          <div
            ref={trackRef}
            role="region"
            aria-roledescription="carousel"
            aria-label="Latest announcements"
            onKeyDown={onKeyDown}
            className="no-scrollbar -mx-6 -my-1 flex snap-x snap-mandatory scroll-px-6 gap-6 overflow-x-auto px-6 py-1 sm:-mx-1 sm:scroll-px-1 sm:px-1"
          >
            {posts.map((post, i) => (
              <NewsCard
                key={post.id}
                post={post}
                index={i}
                total={posts.length}
                onOpen={open}
                articleRef={(el) => {
                  if (el) cardRefs.current.set(post.id, el);
                  else cardRefs.current.delete(post.id);
                }}
              />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 sm:flex-row sm:items-center sm:justify-between sm:p-7 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-start gap-4">
              <IconTile className="shrink-0">
                <Icon size={20}>{MEGAPHONE}</Icon>
              </IconTile>
              <div>
                <h3 className="font-semibold text-[#001f3f] dark:text-white">
                  {status === 'ready'
                    ? 'No announcements right now'
                    : 'Announcements are unavailable right now'}
                </h3>
                <p className="mt-1 leading-relaxed text-slate-600 dark:text-slate-300">
                  The school also posts news and notices on its Facebook page.
                </p>
              </div>
            </div>
            <a
              href={FACEBOOK_PAGE}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex w-max shrink-0 items-center gap-2 rounded-full border border-slate-300 px-6 py-3 text-sm font-semibold text-[#002855] transition-colors hover:border-[#002855] dark:border-white/15 dark:text-white dark:hover:bg-white/10 ${FOCUS_RING}`}
            >
              Visit our Facebook page
              <ArrowRight />
            </a>
          </div>
        )}

        {/* Phones: the controls sit under the cards, where the thumb already is. */}
        {!isEmpty && (
          <div className="mt-6 flex items-center justify-between gap-4 sm:hidden">
            {/* Shorter label: the full one wraps beside the arrows at phone widths. */}
            <ViewAllLink label="All announcements" className="flex-1" />
            {showNav && <NavButtons {...edges} onStep={step} />}
          </div>
        )}
      </div>

      {hasPosts && (
        <NewsDialog
          post={shown}
          open={isOpen}
          origin={origin}
          onClose={close}
          dialogRef={dialogRef}
          closeRef={closeRef}
          scrollRef={scrollRef}
          scrolled={scrolled}
          setScrolled={setScrolled}
        />
      )}
    </section>
  );
}
