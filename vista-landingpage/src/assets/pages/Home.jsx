// src/pages/Home.jsx
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Label, CheckIcon } from '../components/ui';
import { VISTA_LOGIN_URL } from '../../config';
import { useFacilities } from '../lib/publicContent';

const quickFacts = [
  { label: 'Founded', value: '1939' },
  { label: 'Levels offered', value: 'Pre-Nursery to Grade 12' },
  { label: 'Languages', value: 'English · Filipino · 中文' },
  { label: 'Campus', value: 'Grace Park West, Caloocan' },
];

const requirements = [
  'Report card from the previous school year (Form 138)',
  'PSA birth certificate, original and photocopy',
  'Two 2×2 photographs',
  'Certificate of good moral character, for transferees',
];

const keyDates = [
  { when: '15 May', what: 'Early-bird enrollment ends', kind: 'Admissions' },
  { when: '8 June', what: 'Regular enrollment opens', kind: 'Admissions' },
  { when: '20 July', what: "Parents' orientation", kind: 'Event' },
  { when: '3 August', what: 'First day of classes', kind: 'Academic' },
  { when: '28 August', what: 'Buwan ng Wika celebration', kind: 'Event' },
];

const academicLevels = [
  {
    name: 'Tots',
    grades: 'Pre-Nursery to Kinder',
    focus: 'Early childhood development through play, discovery and routine',
  },
  {
    name: 'Grade School',
    grades: 'Grades 1 to 6',
    focus: 'Mathematics, Science, English, and Chinese language and culture',
  },
  {
    name: 'Junior High School',
    grades: 'Grades 7 to 10',
    focus: 'Specialised subjects, laboratory work, leadership and outreach',
  },
  {
    name: 'Senior High School',
    grades: 'Grades 11 to 12',
    focus: 'Academic and Technical-Vocational strands for college and career',
  },
];

const portalRoles = [
  {
    who: 'Teachers',
    what: 'Record attendance and scores per subject, and write observations as they go.',
    icon: (
      <>
        <path d="M12 6.5C10.5 5 8.5 4.5 4 4.5v13c4.5 0 6.5.5 8 2 1.5-1.5 3.5-2 8-2v-13c-4.5 0-6.5.5-8 2z" />
        <path d="M12 6.5v13" />
      </>
    ),
  },
  {
    who: 'Advisers',
    what: 'See one class across every learning area — the whole row, not one column.',
    icon: (
      <>
        <path d="M17 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9.5" cy="7" r="3.5" />
        <path d="M22 20v-2a4 4 0 0 0-3-3.87" />
      </>
    ),
  },
  {
    who: 'Parents',
    what: 'Follow your own child’s attendance, grades and behavior from the parent app.',
    icon: (
      <>
        <rect x="6" y="2" width="12" height="20" rx="2" />
        <path d="M11 18h2" />
      </>
    ),
  },
];

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Eleven', 'Twelve'];
const countWord = (n) => NUMBER_WORDS[n] || String(n);

const Home = () => {
  const navigate = useNavigate();

  // VISTA's gallery when it answers, the bundled one until then (or instead).
  const facilities = useFacilities();

  // { room, photo } while the facility viewer is open, null when closed.
  const [viewer, setViewer] = useState(null);
  const activeRoom = viewer ? facilities[viewer.room] : null;
  const activePhoto = activeRoom ? activeRoom.photos[viewer.photo] : null;

  const step = useCallback(
    (delta) =>
      setViewer((v) => {
        if (!v) return v;
        const count = facilities[v.room].photos.length;
        return { ...v, photo: (v.photo + delta + count) % count };
      }),
    [facilities]
  );

  // Keyboard control, and stop the page behind the viewer from scrolling.
  useEffect(() => {
    if (!viewer) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') setViewer(null);
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [viewer, step]);

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
      <Navbar />

      <main className="flex-grow">
        {/* HERO — fills what is left of the first screen below the utility bar (36px)
            and the sticky header (80px). svh so mobile browser chrome doesn't overflow it. */}
        <section className="relative isolate flex min-h-[calc(100svh-116px)] items-center overflow-hidden bg-[#001f3f]">
          <img draggable="false"
            src="/facilities/quadrangle-wide.jpg"
            alt="The Yorklin quadrangle, seen from an upper floor"
            fetchPriority="high"
            className="absolute inset-0 -z-10 h-full w-full object-cover object-[center_58%]"
          />
          {/* Darkened toward the left so the copy stays legible over the photo */}
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-[#001428]/95 via-[#001428]/80 to-[#001428]/70 lg:bg-gradient-to-r lg:from-[#001428]/95 lg:via-[#001428]/80 lg:to-[#001428]/25" />

          <div className="mx-auto w-full max-w-7xl px-6 py-16 sm:px-12 lg:px-24 lg:py-20">
            {/* No second column any more — the copy just runs to a comfortable measure
                and the rest of the frame stays open onto the photo. */}
            <div className="max-w-4xl">
              <div className="mb-6 inline-flex items-center gap-2.5 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 backdrop-blur-sm">
                <span className="block h-2 w-2 rounded-full bg-emerald-400" />
                <Label className="text-white">Enrollment open · SY 2026–2027</Label>
              </div>

              {/* The motto is the school's own, from the seal. */}
              <h1 className="mb-5 text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-[55px]">
                Knowledge, benevolence, courage.
                <span className="block text-yellow-400">Since 1939.</span>
              </h1>

              <p className="mb-8 max-w-xl text-lg leading-relaxed text-slate-200">
                Northern Rizal Yorklin School teaches{' '}
                <span className="whitespace-nowrap">Pre-Nursery</span> through Grade 12 in Grace
                Park West, Caloocan, with Chinese language and culture alongside the Philippine
                curriculum.
              </p>

              <div className="flex flex-col gap-3.5 sm:flex-row sm:items-center">
                <button
                  onClick={() => navigate('/admissions')}
                  className="rounded-full bg-yellow-400 px-8 py-3.5 font-semibold text-[#002855] transition-colors hover:bg-yellow-300"
                >
                  Start an application
                </button>
                <button
                  onClick={() => navigate('/programs')}
                  className="rounded-full border border-white/30 bg-white/10 px-8 py-3.5 font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/20"
                >
                  Explore programs
                </button>
              </div>
            </div>

          </div>
        </section>

        {/* QUICK FACTS */}
        <section className="border-b border-slate-200 bg-white dark:border-white/10 dark:bg-[#00152e]">
          {/* subgrid: labels share one track and values another, so a label that wraps to
              two lines can't shunt its value out of line with the others. */}
          {/* Four across, columns sized to their text and the slack shared out evenly, so the
              gaps read equal instead of short values leaving a hole. Two-up stays on even
              halves — spreading only two items to the edges would leave a void in the middle. */}
          <div className="mx-auto grid max-w-7xl grid-cols-2 grid-rows-[auto_auto] gap-x-8 gap-y-8 px-6 py-8 sm:px-12 lg:grid-cols-[repeat(4,auto)] lg:justify-between lg:px-24">
            {quickFacts.map((fact) => (
              <div key={fact.label} className="row-span-2 grid grid-rows-subgrid gap-2">
                <Label className="text-slate-500 dark:text-slate-400">{fact.label}</Label>
                <span className="text-xl font-semibold leading-snug tracking-tight text-[#001f3f] dark:text-white">
                  {fact.value}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ADMISSIONS */}
        <section className="bg-[#001f3f] text-white dark:bg-[#001024]">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 sm:px-12 lg:grid-cols-[1fr_1.25fr] lg:gap-20 lg:px-24">
            <div>
              <Label className="mb-4 block text-yellow-400">Admissions</Label>
              <h2 className="mb-4 text-3xl font-bold leading-tight tracking-tight">
                What to bring, and when
              </h2>
              <p className="mb-7 leading-relaxed text-slate-300">
                The registrar&apos;s office is open on weekdays. Walk-ins are welcome; an
                appointment is not required.
              </p>
              <ul className="selectable flex list-none flex-col gap-3 p-0">
                {requirements.map((req) => (
                  <li key={req} className="flex items-start gap-3">
                    <CheckIcon className="mt-0.5 shrink-0 text-yellow-400" />
                    <span className="leading-snug text-slate-200">{req}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <Label className="mb-4 block text-slate-400">
                Key dates — School Year 2026–2027
              </Label>
              <div className="flex flex-col">
                {keyDates.map((d) => (
                  <div
                    key={d.what}
                    className="grid grid-cols-[80px_1fr] items-center gap-x-5 gap-y-1 border-b border-white/10 py-4 sm:grid-cols-[92px_1fr_auto]"
                  >
                    <Label className="text-yellow-400">{d.when}</Label>
                    <span className="font-medium text-white">{d.what}</span>
                    <Label className="col-start-2 text-slate-400 sm:col-start-3 sm:text-right">
                      {d.kind}
                    </Label>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* PROGRAMS */}
        <section className="bg-white dark:bg-[#00152e]">
          <div className="mx-auto max-w-7xl px-6 py-16 sm:px-12 lg:px-24 lg:py-20">
            <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Label className="mb-3 block text-slate-500 dark:text-slate-400">
                  Academic programs
                </Label>
                <h2 className="text-3xl font-bold tracking-tight text-[#001f3f] sm:text-4xl dark:text-white">
                  Four levels, one continuous curriculum
                </h2>
              </div>
              <button
                onClick={() => navigate('/programs')}
                className="w-max font-semibold text-blue-700 hover:underline dark:text-yellow-400"
              >
                See full curriculum →
              </button>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
              {/* Header row — desktop only; each card carries its own labels on mobile */}
              <div className="hidden border-b border-slate-200 bg-[#F0F4F8] md:grid md:grid-cols-[240px_180px_1fr] dark:border-white/10 dark:bg-white/5">
                <div className="px-6 py-3.5">
                  <Label className="text-slate-600 dark:text-slate-300">Level</Label>
                </div>
                <div className="px-6 py-3.5">
                  <Label className="text-slate-600 dark:text-slate-300">Grades</Label>
                </div>
                <div className="px-6 py-3.5">
                  <Label className="text-slate-600 dark:text-slate-300">Focus</Label>
                </div>
              </div>

              {academicLevels.map((level, i) => (
                <div
                  key={level.name}
                  className={`flex flex-col gap-1.5 px-6 py-5 md:grid md:grid-cols-[240px_180px_1fr] md:items-center md:gap-0 md:px-0 md:py-0 ${
                    i < academicLevels.length - 1
                      ? 'border-b border-slate-100 dark:border-white/5'
                      : ''
                  }`}
                >
                  <div className="font-semibold text-[#001f3f] md:px-6 md:py-6 dark:text-white">
                    {level.name}
                  </div>
                  <div className="text-sm text-slate-600 md:px-6 md:py-6 md:text-base dark:text-slate-400">
                    {level.grades}
                  </div>
                  <div className="text-sm leading-relaxed text-slate-600 md:px-6 md:py-6 md:text-base dark:text-slate-400">
                    {level.focus}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FACILITIES */}
        <section className="border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
          <div className="mx-auto max-w-7xl px-6 py-16 sm:px-12 lg:px-24 lg:py-20">
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">Facilities</Label>
            <h2 className="mb-3 text-3xl font-bold tracking-tight text-[#001f3f] sm:text-4xl dark:text-white">
              {countWord(facilities.length)} rooms that do one job each
            </h2>
            <p className="mb-9 max-w-2xl text-lg leading-relaxed text-slate-600 dark:text-slate-300">
              Every learning area on the curriculum has a room built for it — not a classroom with
              equipment wheeled in. Open any room to walk around it.
            </p>

            <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
              {facilities.map((room, i) => (
                <button
                  key={room.slug}
                  type="button"
                  onClick={() => setViewer({ room: i, photo: 0 })}
                  aria-label={`${room.name} — view ${room.photos.length} photos`}
                  className="group relative h-40 cursor-pointer overflow-hidden rounded-xl bg-slate-300 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#002855] focus-visible:ring-offset-2 sm:h-48 dark:focus-visible:ring-yellow-400 dark:focus-visible:ring-offset-[#001f44]"
                >
                  <img draggable="false"
                    src={room.cover}
                    alt={room.name}
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-[#001f3f]/70 px-2 py-1 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    {room.photos.length}
                  </span>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#001f3f]/90 to-transparent px-4 pb-3 pt-7">
                    <Label className="text-white">{room.name}</Label>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* VISTA PORTAL */}
        <section className="bg-white dark:bg-[#00152e]">
          <div className="mx-auto grid max-w-7xl gap-12 px-6 py-16 sm:px-12 lg:grid-cols-[1fr_1.5fr] lg:gap-20 lg:px-24 lg:py-20">
            <div>
              <Label className="mb-3 block text-slate-500 dark:text-slate-400">
                The VISTA portal
              </Label>
              <h2 className="mb-4 text-3xl font-bold leading-tight tracking-tight text-[#001f3f] sm:text-[36px] dark:text-white">
                Everyone sees exactly their own part
              </h2>
              <p className="mb-7 leading-relaxed text-slate-600 dark:text-slate-300">
                VISTA is the school&apos;s own student monitoring system. Access is decided by role,
                so a teacher, an adviser and a parent each open a different portal with the same
                login.
              </p>
              <a
                href={VISTA_LOGIN_URL}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-blue-700 hover:underline dark:text-yellow-400"
              >
                Open the portal →
              </a>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {portalRoles.map((role) => (
                <div
                  key={role.who}
                  className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6 dark:border-white/10 dark:bg-white/5"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0F4F8] dark:bg-white/10">
                    <svg
                      width="21"
                      height="21"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="text-[#002855] dark:text-yellow-400"
                      aria-hidden="true"
                    >
                      {role.icon}
                    </svg>
                  </div>
                  <div className="font-semibold text-[#001f3f] dark:text-white">{role.who}</div>
                  <div className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                    {role.what}
                  </div>
                  <div className="mt-1 h-[3px] w-8 rounded-full bg-yellow-400" />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="bg-yellow-400 dark:bg-yellow-500">
          <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-24">
            <div>
              <h2 className="mb-2 text-2xl font-bold leading-tight tracking-tight text-[#002855] sm:text-3xl">
                Ready to enroll for SY 2026–2027?
              </h2>
              <p className="leading-snug text-[#3F3413]">
                Regular enrollment opens 8 June 2026. Early-bird rates end 15 May.
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-3.5 sm:flex-row sm:items-center">
              <button
                onClick={() => navigate('/admissions')}
                className="rounded-full bg-[#002855] px-8 py-3.5 font-semibold text-white transition-colors hover:bg-[#003a7a]"
              >
                Start an application
              </button>
              <button
                onClick={() => navigate('/contact')}
                className="rounded-full border border-[#002855] px-8 py-3.5 font-semibold text-[#002855] transition-colors hover:bg-[#002855] hover:text-white"
              >
                Book a campus tour
              </button>
            </div>
          </div>
        </section>
      </main>

      <Footer />

      {/* FACILITY VIEWER — activePhoto is checked too: the gallery can swap from
          the bundled set to VISTA's while the viewer is open, and the index it
          holds may not exist in the new one. */}
      {activeRoom && activePhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${activeRoom.name} photos`}
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-[100] flex flex-col bg-[#04121f]/95 backdrop-blur-sm"
        >
          {/* Header */}
          <div
            className="flex shrink-0 items-center justify-between gap-4 px-5 py-4 sm:px-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <h3 className="truncate text-lg font-semibold text-white sm:text-xl">
                {activeRoom.name}
              </h3>
              <Label className="text-slate-400">
                {viewer.photo + 1} of {activeRoom.photos.length}
                {activePhoto.caption ? ` · ${activePhoto.caption}` : ''}
              </Label>
            </div>
            <button
              type="button"
              onClick={() => setViewer(null)}
              aria-label="Close"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Stage — arrows overlay the photo so it can use the full width */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 sm:px-8">
            <img draggable="false"
              src={activePhoto.src}
              alt={activePhoto.caption ? `${activeRoom.name} — ${activePhoto.caption}` : activeRoom.name}
              onClick={(e) => e.stopPropagation()}
              className="max-h-full max-w-full rounded-lg object-contain"
            />

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(-1);
              }}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:left-8"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                step(1);
              }}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70 sm:right-8"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>
          </div>

          {/* Thumbnail strip */}
          <div
            className="flex shrink-0 justify-center gap-2 overflow-x-auto px-5 py-5 sm:px-8"
            onClick={(e) => e.stopPropagation()}
          >
            {activeRoom.photos.map((photo, i) => (
              <button
                key={photo.src}
                type="button"
                onClick={() => setViewer((v) => ({ ...v, photo: i }))}
                aria-label={photo.caption || `Photo ${i + 1}`}
                aria-current={i === viewer.photo}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-md border-2 transition-opacity ${
                  i === viewer.photo
                    ? 'border-yellow-400 opacity-100'
                    : 'border-transparent opacity-50 hover:opacity-80'
                }`}
              >
                <img draggable="false"
                  src={photo.thumb}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Home;
