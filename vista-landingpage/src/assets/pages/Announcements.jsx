// src/pages/Announcements.jsx
//
// Every public announcement, a page at a time.
//
// Two things keep this page short however much the school posts:
//   - Cards start COLLAPSED at one fixed height, the text fading out after about
//     five lines, with Read more / Show less. Each card keeps its own state, and
//     the grid is `items-start`, so opening one never stretches the card beside
//     it (grid's default `stretch` would).
//   - Posts arrive PAGE_SIZE at a time from the API (offset/total), and "Load
//     more announcements" fetches the next page — never the whole archive.
import React, { useEffect, useRef, useState } from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import AnnouncementMedia from '../components/AnnouncementMedia';
import { Label, Icon, SECTION, HEADING } from '../components/ui';
import { FACEBOOK_PAGE } from '../data/announcements';
import { useAnnouncementPages } from '../lib/publicContent';

// Six is three rows of two: enough to scan, short enough that the page is not
// long before anyone has asked for more.
const PAGE_SIZE = 6;

// Height of a collapsed card's text, about five lines. The few pixels of
// tolerance stop a post that runs a line fragment over from earning a button
// that reveals almost nothing.
const COLLAPSED = 132;
const TOLERANCE = 12;

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#002855] focus-visible:ring-offset-2 dark:focus-visible:ring-yellow-400 dark:focus-visible:ring-offset-[#00152e]';

const scrollBehavior = () =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';

const FacebookButton = () => (
  <a
    href={FACEBOOK_PAGE}
    target="_blank"
    rel="noreferrer"
    className="inline-flex w-max items-center gap-2 rounded-full bg-[#002855] px-7 py-3.5 font-semibold text-white transition-colors hover:bg-[#003a7a] dark:bg-yellow-500 dark:text-[#002855] dark:hover:bg-yellow-400"
  >
    <Icon size={18}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </Icon>
    Follow us on Facebook
  </a>
);

const Spinner = () => (
  <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
    <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
  </svg>
);

function AnnouncementCard({ post }) {
  const [expanded, setExpanded] = useState(false);
  // Full height of the text, measured — and re-measured when the width or the
  // web fonts change it, so an open card never clips or leaves a gap.
  const [fullHeight, setFullHeight] = useState(null);
  const cardRef = useRef(null);
  const textRef = useRef(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFullHeight(el.scrollHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const overflows = fullHeight !== null && fullHeight > COLLAPSED + TOLERANCE;
  const open = expanded && overflows;
  const bodyId = `announcement-${post.id}-body`;

  const toggle = () => {
    if (open) {
      // Closing a long post can leave the reader below its card. Bring the
      // card's top back into view (scroll-mt clears the sticky header).
      const top = cardRef.current?.getBoundingClientRect().top ?? 0;
      if (top < 96) cardRef.current?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    }
    setExpanded(!open);
  };

  return (
    <article
      ref={cardRef}
      className="group flex scroll-mt-28 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20"
    >
      <AnnouncementMedia post={post} />

      <div className="flex flex-1 flex-col p-6 sm:p-7">
        <div className="mb-3 flex min-h-6 flex-wrap items-center gap-3">
          {post.isPinned && (
            <span className="rounded-full bg-yellow-400 px-2.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-[#002855]">
              Pinned
            </span>
          )}
          <Label className="text-slate-500 dark:text-slate-400">{post.date}</Label>
        </div>

        {/* tabIndex -1 so "Load more" can hand focus to the first new card. */}
        <h3
          id={`announcement-${post.id}-title`}
          tabIndex={-1}
          className={`mb-3 text-xl font-semibold leading-snug text-[#001f3f] outline-none dark:text-white ${
            open ? '' : 'line-clamp-2 min-h-[2lh]'
          }`}
        >
          {post.title}
        </h3>

        {/* The text box animates between the collapsed height and the measured
            full one. Collapsed, the last lines fade out with a mask, so there
            is no gradient colour to match in dark mode. */}
        <div
          id={bodyId}
          style={{ height: open ? fullHeight : COLLAPSED }}
          className={`overflow-hidden transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
            overflows && !open
              ? '[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_3.5rem),transparent)]'
              : ''
          }`}
        >
          <div ref={textRef} className="selectable">
            {post.summary && (
              <p className="mb-3 font-medium leading-relaxed text-slate-700 dark:text-slate-200">
                {post.summary}
              </p>
            )}
            <p className="whitespace-pre-line leading-relaxed text-slate-600 dark:text-slate-300">
              {post.content}
            </p>
          </div>
        </div>

        {/* Always the same height, so a short post's card lines up with the rest. */}
        <div className="mt-4 flex h-6 items-center">
          {overflows && (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={bodyId}
              className={`inline-flex items-center gap-1.5 rounded text-sm font-semibold text-[#002855] hover:underline dark:text-yellow-400 ${FOCUS_RING}`}
            >
              {open ? 'Show less' : 'Read more'}
              <Icon size={16} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}>
                <path d="m6 9 6 6 6-6" />
              </Icon>
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function SkeletonCard() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5">
      <div className="aspect-[16/9] animate-pulse bg-slate-200 dark:bg-white/10" />
      <div className="flex flex-col gap-3 p-6 sm:p-7">
        <div className="h-3 w-32 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="h-6 w-11/12 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        <div className="mt-2 h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-white/5" />
        <div className="h-4 w-full animate-pulse rounded bg-slate-100 dark:bg-white/5" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-slate-100 dark:bg-white/5" />
      </div>
    </div>
  );
}

// Under the grid: how far through the list the reader is, and the way to go further.
function Pager({ shown, total, hasMore, loadingMore, loadMoreFailed, onLoadMore }) {
  const progress = total ? Math.min(shown / total, 1) : null;
  return (
    <div className="mt-12 flex flex-col items-center gap-4 text-center">
      <div aria-live="polite" className="flex flex-col items-center gap-2.5">
        <Label className="text-slate-500 dark:text-slate-400">
          {total ? `Showing ${shown} of ${total}` : `Showing ${shown}`}
        </Label>
        {progress !== null && (
          <div className="h-1 w-40 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-yellow-400 transition-[width] duration-500"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
        {loadMoreFailed && (
          <p className="text-sm text-red-700 dark:text-red-300">
            Couldn&apos;t load more announcements. Check your connection and try again.
          </p>
        )}
        {!hasMore && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            You&apos;re all caught up — every announcement is shown.
          </p>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          aria-busy={loadingMore}
          className={`inline-flex min-w-60 items-center justify-center gap-2 rounded-full border border-slate-300 px-7 py-3 text-sm font-semibold text-[#002855] transition-colors hover:border-[#002855] hover:bg-[#002855] hover:text-white disabled:cursor-wait disabled:hover:border-slate-300 disabled:hover:bg-transparent disabled:hover:text-[#002855] dark:border-white/15 dark:text-white dark:hover:border-yellow-400 dark:hover:bg-yellow-400 dark:hover:text-[#002855] dark:disabled:hover:border-white/15 dark:disabled:hover:bg-transparent dark:disabled:hover:text-white ${FOCUS_RING}`}
        >
          {loadingMore ? (
            <>
              <Spinner />
              Loading…
            </>
          ) : loadMoreFailed ? (
            'Try again'
          ) : (
            'Load more announcements'
          )}
        </button>
      )}
    </div>
  );
}

const Announcements = () => {
  const { status, announcements, total, hasMore, loadMore, loadingMore, loadMoreFailed } =
    useAnnouncementPages(PAGE_SIZE);

  // After "Load more", move focus to the first new card so a keyboard or screen
  // reader user carries on from there instead of back at the button.
  const focusFrom = useRef(null);
  const onLoadMore = () => {
    focusFrom.current = announcements.length;
    loadMore();
  };
  useEffect(() => {
    const from = focusFrom.current;
    if (from === null || announcements.length <= from) return;
    focusFrom.current = null;
    document
      .getElementById(`announcement-${announcements[from].id}-title`)
      ?.focus({ preventScroll: true });
  }, [announcements]);

  // The pager appears once there is more than one page to talk about.
  const showPager = announcements.length > 0 && (hasMore || announcements.length > PAGE_SIZE);

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
      <Navbar />

      <main className="flex-grow">
        <PageHeader
          eyebrow="Latest updates"
          title="School announcements"
          lede="News, upcoming events and important notices from Northern Rizal Yorklin School."
        />

        <section className="bg-white dark:bg-[#00152e]">
          <div className={SECTION}>
            <div className="mb-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label className="mb-3 block text-slate-500 dark:text-slate-400">Recent posts</Label>
                <h2 className={HEADING}>What&apos;s happening</h2>
              </div>
              <FacebookButton />
            </div>

            {status === 'loading' && (
              <div className="grid items-start gap-6 md:grid-cols-2" aria-busy="true" aria-label="Loading announcements">
                {[0, 1, 2, 3].map((i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            )}

            {status !== 'loading' && announcements.length === 0 && (
              <div className="rounded-2xl border border-slate-200 p-8 text-center dark:border-white/10 dark:bg-white/5">
                <h3 className="text-xl font-semibold text-[#001f3f] dark:text-white">
                  {status === 'ready' ? 'No announcements right now' : 'Announcements are unavailable right now'}
                </h3>
                <p className="mx-auto mt-2 max-w-xl leading-relaxed text-slate-600 dark:text-slate-300">
                  The school also posts news and notices on its Facebook page.
                </p>
              </div>
            )}

            {announcements.length > 0 && (
              // items-start: each card keeps its own height, so opening one
              // makes only its own column taller.
              <div className="grid items-start gap-6 md:grid-cols-2">
                {announcements.map((post) => (
                  <AnnouncementCard key={post.id} post={post} />
                ))}
              </div>
            )}

            {showPager && (
              <Pager
                shown={announcements.length}
                total={total}
                hasMore={hasMore}
                loadingMore={loadingMore}
                loadMoreFailed={loadMoreFailed}
                onLoadMore={onLoadMore}
              />
            )}
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Announcements;
