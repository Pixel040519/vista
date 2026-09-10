// Compact navy header band used by every page except Home, which has its own
// full-screen photo hero.
import React from 'react';
import { Label } from './ui';

const PageHeader = ({ eyebrow, title, lede }) => (
  <section className="bg-[#001f3f] dark:bg-[#001024]">
    <div className="mx-auto max-w-7xl px-6 py-14 sm:px-12 lg:px-24 lg:py-20">
      {eyebrow && <Label className="mb-4 block text-yellow-400">{eyebrow}</Label>}
      <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[44px]">
        {title}
      </h1>
      {lede && (
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">{lede}</p>
      )}
    </div>
  </section>
);

export default PageHeader;
