// src/pages/Admissions.jsx
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import { Label, CheckIcon, Icon, SECTION, HEADING } from '../components/ui';

const PIC_ID = '6 copies of 2" x 2" recent colored ID picture';
const PSA = 'Photocopy of PSA Birth Certificate (Filipino students)';
const ICARD = 'Photocopy of I-Card (Foreign students)';
const VERIFY = 'Bring the original copy for verification.';
const MEDICAL = 'Medical / Dental Record (school form/record, as required)';
const ENTRANCE = 'Entrance exam and/or interview (if required; as scheduled)';
const OTHERS = 'Other requirements as may be required by the school';

const sections = [
  {
    id: 'tots-new',
    title: 'Tots (Pre-Nursery to Kindergarten) — new students',
    summary: 'What to bring',
    items: [
      { text: PIC_ID },
      { text: PSA, note: VERIFY },
      { text: ICARD, note: VERIFY },
      {
        text: 'Accomplished Information Sheet',
        note: 'Provided by the school, to be filled out during enrollment.',
      },
      { text: MEDICAL },
      { text: ENTRANCE },
      { text: OTHERS },
    ],
    cta: true,
  },
  {
    id: 'elem-shs-new',
    title: 'Elementary to Senior High — new and transferee students',
    summary: 'What to bring',
    items: [
      { text: PIC_ID },
      { text: PSA, note: VERIFY },
      { text: ICARD, note: VERIFY },
      { text: 'Certificate of Good Moral Character' },
      { text: 'Original Progress Report Card / Form 138 (signed by the School Principal)' },
      { text: 'Accomplished Information Sheet (school form)' },
      { text: MEDICAL },
      { text: ENTRANCE },
      { text: OTHERS },
    ],
    footnote:
      'Specific requirements may still vary by grade level. Please confirm with the Admissions Office.',
    cta: true,
  },
  {
    id: 'old',
    title: 'Old students (continuing)',
    summary: 'What to bring',
    items: [
      { text: '4 copies of 2" x 2" recent colored picture' },
      { text: OTHERS },
    ],
  },
  {
    id: 'returning',
    title: 'Returning students',
    summary: 'How they are processed',
    paragraph:
      'Returning students are typically processed as new students and follow the applicable new student requirements and screening.',
  },
  {
    id: 'payment',
    title: 'Fees and payment',
    summary: 'Basic information',
    items: [
      { text: 'School fees are paid at the Accounting Office.' },
      { text: 'Enrollment is on a school-year basis.' },
      { text: 'Payment may be collected on a semestral or quarterly basis.' },
    ],
    footnote:
      'For the latest fee breakdown, deadlines, and schedules, please contact the school directly.',
  },
];

const Admissions = () => {
  const navigate = useNavigate();
  // Single-open accordion, starting with everything closed: opening a section
  // closes whichever one was open, and clicking an open section closes it.
  const [openId, setOpenId] = useState('');
  const toggle = (id) => setOpenId((prev) => (prev === id ? '' : id));

  return (
    <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
      <Navbar />

      <main className="flex-grow">
        <PageHeader
          eyebrow="Join the Yorklin family"
          title="Admissions"
          lede="Everything you need to prepare for enrollment. Open a section below for the detailed requirements."
        />

        <section className="bg-white dark:bg-[#00152e]">
          <div className={SECTION}>
            {/* PRIVACY NOTICE */}
            <div
              role="note"
              className="mb-10 flex gap-4 rounded-2xl border border-slate-200 bg-[#F0F4F8] p-6 dark:border-white/10 dark:bg-white/5"
            >
              <span className="mt-0.5 shrink-0 text-[#002855] dark:text-yellow-400">
                <Icon size={20}>
                  <rect x="3" y="11" width="18" height="10" rx="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </Icon>
              </span>
              <div>
                <h2 className="mb-2 font-semibold text-[#001f3f] dark:text-white">Privacy notice</h2>
                <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                  This page is for information only. We do not collect, upload, or store personal
                  documents here. Requirements are submitted directly to the school office.
                </p>
                <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
                  Admission follows the age requirements set by the Department of Education (DepEd).
                </p>
              </div>
            </div>

            <Label className="mb-3 block text-slate-500 dark:text-slate-400">Requirements</Label>
            <h2 className={`${HEADING} mb-8`}>What to bring, by student type</h2>

            {/* ACCORDION */}
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
              {sections.map((s, i) => {
                const isOpen = openId === s.id;
                return (
                  <div
                    key={s.id}
                    className={i < sections.length - 1 ? 'border-b border-slate-200 dark:border-white/10' : ''}
                  >
                    <h3>
                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-expanded={isOpen}
                        aria-controls={`panel-${s.id}`}
                        className="flex w-full items-center justify-between gap-5 px-6 py-5 text-left transition-colors hover:bg-[#F0F4F8] dark:hover:bg-white/5"
                      >
                        <span>
                          <span className="block font-semibold text-[#001f3f] dark:text-white">
                            {s.title}
                          </span>
                          <Label className="mt-1 block text-slate-500 dark:text-slate-400">
                            {s.summary}
                          </Label>
                        </span>
                        <span
                          className={`shrink-0 text-slate-500 transition-transform duration-300 dark:text-slate-400 ${
                            isOpen ? 'rotate-180' : ''
                          }`}
                        >
                          <Icon size={20}>
                            <path d="m6 9 6 6 6-6" />
                          </Icon>
                        </span>
                      </button>
                    </h3>

                    {/* grid-rows transition: no max-height ceiling to overflow */}
                    <div
                      id={`panel-${s.id}`}
                      className={`grid transition-all duration-300 ease-out ${
                        isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                      }`}
                    >
                      <div className="overflow-hidden">
                        <div className="selectable px-6 pb-7">
                          {s.paragraph && (
                            <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                              {s.paragraph}
                            </p>
                          )}

                          {s.items && (
                            <ul className="flex list-none flex-col gap-3 p-0">
                              {s.items.map((item) => (
                                <li key={item.text} className="flex items-start gap-3">
                                  <CheckIcon className="mt-0.5 shrink-0 text-yellow-500 dark:text-yellow-400" />
                                  <span>
                                    <span className="leading-snug text-slate-700 dark:text-slate-200">
                                      {item.text}
                                    </span>
                                    {item.note && (
                                      <span className="mt-1 block text-sm text-slate-500 dark:text-slate-400">
                                        {item.note}
                                      </span>
                                    )}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}

                          {s.footnote && (
                            <p className="mt-5 border-l-2 border-yellow-400 pl-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                              {s.footnote}
                            </p>
                          )}

                          {s.cta && (
                            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                              <button
                                onClick={() => navigate('/contact')}
                                className="rounded-full bg-[#002855] px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#003a7a] dark:bg-yellow-500 dark:text-[#002855] dark:hover:bg-yellow-400"
                              >
                                Contact us for schedule
                              </button>
                              <button
                                onClick={() => navigate('/programs')}
                                className="rounded-full border border-slate-300 px-7 py-3 text-sm font-semibold text-[#002855] transition-colors hover:border-slate-400 dark:border-white/15 dark:text-white dark:hover:bg-white/10"
                              >
                                View programs
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* WHEN TO ENROLL — the site publishes no schedule, so this says what is
            true all year and points at the people who know the current dates. */}
        <section className="border-y border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
          <div className={SECTION}>
            <Label className="mb-3 block text-slate-500 dark:text-slate-400">Enrollment</Label>
            <h2 className={`${HEADING} mb-8`}>When to enroll</h2>
            <p className="mb-5 leading-relaxed text-slate-600 dark:text-slate-300">
              The registrar&apos;s office is open on weekdays. Walk-ins are welcome; an
              appointment is not required.
            </p>
            <Link
              to="/contact"
              className="font-semibold text-[#002855] underline-offset-4 hover:text-[#003a7a] hover:underline dark:text-yellow-400 dark:hover:text-yellow-300"
            >
              Contact the registrar &rarr;
            </Link>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
};

export default Admissions;
