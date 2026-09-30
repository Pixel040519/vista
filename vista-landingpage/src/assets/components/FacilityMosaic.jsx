// The facilities section on Home: four rooms at a time in a mosaic, with a
// pager to reach the rest. The gallery is managed from VISTA, so nothing here
// may assume how many rooms there are.
import React, { useState } from 'react';
import { Label, HEADING, SECTION } from './ui';

const PAGE_SIZE = 4;

const FEATURE = 'col-span-2 h-64 lg:col-span-2 lg:row-span-2 lg:h-auto';
const WIDE = 'col-span-2 h-44 lg:col-span-2 lg:h-auto';
const SMALL = 'col-span-1 h-40 lg:col-span-1 lg:h-auto';

// One arrangement per number of rooms on the page, so a short last page still
// fills the same two rows instead of leaving holes in the grid.
const LAYOUTS = {
  1: [{ box: 'col-span-2 h-64 lg:col-span-4 lg:row-span-2 lg:h-auto', size: 'lg' }],
  2: [
    { box: FEATURE, size: 'lg' },
    { box: FEATURE, size: 'lg' },
  ],
  3: [
    { box: FEATURE, size: 'lg' },
    { box: 'col-span-1 h-40 lg:col-span-2 lg:h-auto', size: 'md' },
    { box: 'col-span-1 h-40 lg:col-span-2 lg:h-auto', size: 'md' },
  ],
  4: [
    { box: FEATURE, size: 'lg' },
    { box: WIDE, size: 'md' },
    { box: SMALL, size: 'sm' },
    { box: SMALL, size: 'sm' },
  ],
};

const TEXT = {
  lg: { inset: 'inset-x-5 bottom-5 lg:inset-x-7 lg:bottom-7', name: 'text-2xl lg:text-3xl' },
  md: { inset: 'inset-x-4 bottom-4 lg:inset-x-6 lg:bottom-6', name: 'text-base sm:text-lg lg:text-[22px]' },
  sm: { inset: 'inset-x-4 bottom-4 lg:inset-x-5 lg:bottom-5', name: 'text-base lg:text-lg' },
};

const FOCUS =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-[#002855] focus-visible:ring-offset-2 focus-visible:ring-offset-[#F0F4F8] dark:focus-visible:ring-yellow-400 dark:focus-visible:ring-offset-[#001f44]';

const pad = (n) => String(n).padStart(2, '0');

const Chevron = ({ d }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

const PagerButton = ({ label, d, ...props }) => (
  <button
    type="button"
    aria-label={label}
    className={`flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white text-[#001f3f] transition-colors hover:bg-slate-100 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-white dark:border-white/20 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 dark:disabled:hover:bg-white/5 ${FOCUS}`}
    {...props}
  >
    <Chevron d={d} />
  </button>
);

const RoomCard = ({ room, layout, delay, onOpen }) => {
  const text = TEXT[layout.size];
  const count = room.photos.length;
  const caption = layout.size === 'lg' ? room.photos[0]?.caption : '';

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`${room.name} — view ${count} ${count === 1 ? 'photo' : 'photos'}`}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl bg-[#001f3f] text-left text-white ${layout.box} ${FOCUS}`}
    >
      <img
        draggable="false"
        src={room.cover}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
      <span className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-[#001f3f]/95 via-[#001f3f]/55 to-transparent" />
      <span className={`absolute flex items-end justify-between gap-4 ${text.inset}`}>
        <span className="flex min-w-0 flex-col gap-1.5">
          <Label className="text-yellow-400">
            {count} {count === 1 ? 'photo' : 'photos'}
          </Label>
          <span className={`font-bold leading-tight tracking-tight ${text.name}`}>{room.name}</span>
          {caption && (
            <span className="hidden text-[15px] leading-relaxed text-slate-200 sm:block">
              {caption}
            </span>
          )}
        </span>
        {layout.size !== 'sm' && (
          <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/55 bg-white/15 transition-colors group-hover:border-yellow-400 group-hover:bg-yellow-400 group-hover:text-[#001f3f] sm:flex">
            <Chevron d="M7 17 17 7M8 7h9v9" />
          </span>
        )}
      </span>
    </button>
  );
};

// `onOpen(index)` receives the room's index in `facilities`.
const FacilityMosaic = ({ facilities, onOpen }) => {
  const [page, setPage] = useState(0);
  // Which way the last arrow pointed; 0 until one is pressed, so the first
  // page does not animate in on load.
  const [direction, setDirection] = useState(0);

  const total = facilities.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The list can shrink under us when VISTA's gallery replaces the bundled one.
  const current = Math.min(page, pages - 1);
  const start = current * PAGE_SIZE;
  const shown = facilities.slice(start, start + PAGE_SIZE);
  const layout = LAYOUTS[shown.length] || LAYOUTS[4];

  const turn = (delta) => {
    setDirection(delta);
    setPage(current + delta);
  };

  return (
    <section className="overflow-x-clip border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
      <div className={SECTION}>
        <div className="mb-9 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          <div>
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">Facilities</Label>
            <h2 className={`mb-3 ${HEADING}`}>A room built for every kind of learning</h2>
            <p className="max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              Every learning area on the curriculum has its own dedicated room, fully equipped for
              that subject. Open any room to look around.
            </p>
          </div>

          {pages > 1 && (
            <div className="flex shrink-0 items-center gap-4">
              <span
                aria-live="polite"
                className="font-mono text-xs font-medium tracking-[0.1em] text-slate-600 dark:text-slate-300"
              >
                {pad(start + 1)}–{pad(start + shown.length)} / {pad(total)}
              </span>
              <div className="flex gap-2">
                <PagerButton
                  label="Previous rooms"
                  d="m15 18-6-6 6-6"
                  disabled={current === 0}
                  onClick={() => turn(-1)}
                />
                <PagerButton
                  label="More rooms"
                  d="m9 18 6-6-6-6"
                  disabled={current === pages - 1}
                  onClick={() => turn(1)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Keyed by page so the cards remount and the entrance plays each turn. */}
        <div
          key={current}
          className={`grid grid-cols-2 gap-4 lg:grid-cols-4 lg:grid-rows-[15.75rem_15.75rem] ${
            direction > 0 ? 'mosaic-next' : direction < 0 ? 'mosaic-prev' : ''
          }`}
        >
          {shown.map((room, i) => (
            <RoomCard
              key={room.slug}
              room={room}
              layout={layout[i]}
              delay={i * 70}
              onOpen={() => onOpen(start + i)}
            />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FacilityMosaic;
