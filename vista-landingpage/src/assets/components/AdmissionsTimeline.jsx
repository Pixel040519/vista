// The admissions calendar block, shown on Home (navy band) and Admissions (grey
// band).
//
// This is the ONLY renderer of it. The two pages each held their own copy of the
// list before, and the copies had already drifted — Home carried "28 August ·
// Buwan ng Wika" and Admissions did not. If another page needs this block, it
// renders this component; it does not write a third list.
//
// Two states, and the empty one is not "nothing":
//   dates present → the timeline, every row carrying its full date
//   no dates      → the registrar panel, which is permanently true
//
// The fallback is a panel rather than a hidden section on purpose. Home puts
// this in the right-hand column of a two-column band, so hiding it would leave
// the requirements list stranded beside a void — and the question a visitor came
// with ("when do I enroll?") still deserves an answer when the calendar is empty.
import React from 'react';
import { Link } from 'react-router-dom';
import { Label } from './ui';

const TONE = {
  dark: {
    eyebrow: 'text-slate-400',
    row: 'border-white/10',
    when: 'text-yellow-400',
    what: 'text-white',
    kind: 'text-slate-400',
    body: 'text-slate-300',
    link: 'text-yellow-400 hover:text-yellow-300',
  },
  light: {
    eyebrow: 'text-slate-500 dark:text-slate-400',
    row: 'border-slate-200 dark:border-white/10',
    when: 'text-[#002855] dark:text-yellow-400',
    what: 'text-[#001f3f] dark:text-white',
    kind: 'text-slate-500 dark:text-slate-400',
    body: 'text-slate-600 dark:text-slate-300',
    link: 'text-[#002855] hover:text-[#003a7a] dark:text-yellow-400 dark:hover:text-yellow-300',
  },
};

export default function AdmissionsTimeline({
  schoolYear,
  dates = [],
  variant = 'light',
  showEyebrow = true,
}) {
  const t = TONE[variant] || TONE.light;

  if (!dates.length) {
    // Deliberately NOT the "registrar's office is open on weekdays" sentence:
    // Home already carries that in the column beside this one, and Admissions
    // keeps it under this section, so repeating it here reads as a stutter.
    // This says the one thing neither of those does — that there is no schedule
    // yet — and then points somewhere useful.
    return (
      <div>
        {showEyebrow && <Label className={`mb-4 block ${t.eyebrow}`}>Key dates</Label>}
        <p className={`mb-5 leading-relaxed ${t.body}`}>
          The enrollment schedule for the coming school year has not been announced yet.
        </p>
        <Link to="/contact" className={`font-semibold underline-offset-4 hover:underline ${t.link}`}>
          Contact the registrar &rarr;
        </Link>
      </div>
    );
  }

  return (
    <div>
      {showEyebrow && (
        <Label className={`mb-4 block ${t.eyebrow}`}>
          {schoolYear ? `Key dates — School Year ${schoolYear.label}` : 'Key dates'}
        </Label>
      )}
      <div className="flex flex-col">
        {dates.map((d) => (
          <div
            key={d.id}
            className={`grid grid-cols-1 items-baseline gap-x-5 gap-y-1 border-b py-4 last:border-b-0 sm:grid-cols-[minmax(150px,auto)_1fr_auto] ${t.row}`}
          >
            <Label className={t.when}>{d.when}</Label>
            <span className={`font-medium ${t.what}`}>{d.label}</span>
            <Label className={`${t.kind} sm:text-right`}>{d.kind}</Label>
          </div>
        ))}
      </div>
    </div>
  );
}
