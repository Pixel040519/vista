// Small primitives shared by every page, so the design vocabulary lives in one place.
import React from 'react';

// Small uppercase mono label used for section eyebrows and captions.
export const Label = ({ children, className = '' }) => (
  <span className={`font-mono text-[11px] font-medium uppercase tracking-[0.14em] ${className}`}>
    {children}
  </span>
);

export const CheckIcon = ({ className = '' }) => (
  <svg
    className={className}
    width="19"
    height="19"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

// Every stroke icon on the site is drawn on this 24px grid at the same weight.
export const Icon = ({ children, size = 22, className = '', strokeWidth = 2 }) => (
  <svg
    className={className}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

// Bordered card used for programmes, principles, contact details and so on.
export const Card = ({ children, className = '' }) => (
  <div
    className={`rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5 ${className}`}
  >
    {children}
  </div>
);

// Square tile that holds a stroke icon at the top of a card.
export const IconTile = ({ children, className = '' }) => (
  <div
    className={`flex h-10 w-10 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#002855] dark:bg-white/10 dark:text-yellow-400 ${className}`}
  >
    {children}
  </div>
);

export const SECTION = 'mx-auto max-w-7xl px-6 py-16 sm:px-12 lg:px-24 lg:py-20';
export const HEADING = 'text-3xl font-bold tracking-tight text-[#001f3f] sm:text-4xl dark:text-white';
