// The yellow "Ready to enroll" band at the foot of Home and Programs.
//
// It was duplicated verbatim between the two pages, each with its own hardcoded
// "SY 2026–2027" — in different spellings, one with a literal en-dash and one
// with &ndash;. One component now.
//
// It names no school year and no date on purpose: nothing on the site knows
// either, and "Ready to enroll?" beside the registrar sentence is true in every
// month of every year.
import React from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * `primaryLabel` / `showTour` exist because Programs ends on one button ("See
 * admission requirements") where Home ends on two. That is the only thing that
 * differed between the two copies besides the hardcoded year, so it is a prop
 * rather than a reason to keep two components.
 */
export default function EnrollCta({
  primaryLabel = 'How to enroll',
  showTour = true,
}) {
  const navigate = useNavigate();

  return (
    <section className="bg-yellow-400 dark:bg-yellow-500">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-12 sm:px-12 lg:flex-row lg:items-center lg:justify-between lg:px-24">
        <div>
          <h2 className="mb-2 text-2xl font-bold leading-tight tracking-tight text-[#002855] sm:text-3xl">
            Ready to enroll?
          </h2>
          <p className="leading-snug text-[#3F3413]">
            The registrar&apos;s office is open on weekdays. Walk-ins are welcome.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-3.5 sm:flex-row sm:items-center">
          <button
            onClick={() => navigate('/admissions')}
            className="rounded-full bg-[#002855] px-8 py-3.5 font-semibold text-white transition-colors hover:bg-[#003a7a]"
          >
            {primaryLabel}
          </button>
          {showTour && (
            <button
              onClick={() => navigate('/contact')}
              className="rounded-full border border-[#002855] px-8 py-3.5 font-semibold text-[#002855] transition-colors hover:bg-[#002855] hover:text-white"
            >
              Book a campus tour
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
