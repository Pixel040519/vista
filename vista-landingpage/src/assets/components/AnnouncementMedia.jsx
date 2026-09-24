// The picture at the top of an announcement — or, for a post without one, a drawn
// navy tile with its category's icon in the same slot. Used by the Home carousel,
// its modal and the Announcements page, so a post looks the same everywhere and a
// list of mixed posts still lines up.
//
// `className` sizes it: a 16:9 slot on a card (the default), a fixed-height band
// or full-height column in the modal. `large` scales the tile's icon up for the
// bigger slots. Hover zoom applies when an ancestor carries `group`.
import React from 'react';
import { Icon } from './ui';
import { CATEGORY_ICON, MEGAPHONE } from './announcementIcons';

const CATEGORY_PILL =
  'absolute left-3 top-3 rounded-full bg-[#001f3f]/75 px-2.5 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-white ring-1 ring-white/15 backdrop-blur-sm';

export default function AnnouncementMedia({ post, className = 'aspect-[16/9]', large = false }) {
  return (
    <div className={`relative shrink-0 overflow-hidden bg-[#001f3f] dark:bg-[#001024] ${className}`}>
      {post.image ? (
        <img
          draggable="false"
          src={post.image}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
        />
      ) : (
        <div
          aria-hidden="true"
          className="flex h-full w-full items-center justify-center"
          style={{
            backgroundImage:
              'radial-gradient(circle at 50% 45%, rgba(250,204,21,0.10), transparent 60%), repeating-linear-gradient(135deg, rgba(255,255,255,0.045) 0 1px, transparent 1px 14px)',
          }}
        >
          <div
            className={`flex items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-yellow-400 transition-transform duration-500 group-hover:scale-105 ${
              large ? 'h-20 w-20' : 'h-16 w-16'
            }`}
          >
            <Icon size={large ? 38 : 30} strokeWidth={1.75}>
              {CATEGORY_ICON[post.category] || MEGAPHONE}
            </Icon>
          </div>
          <span className="absolute bottom-0 left-6 h-[3px] w-10 rounded-t-full bg-yellow-400" />
        </div>
      )}
      {post.category && <span className={CATEGORY_PILL}>{post.category}</span>}
    </div>
  );
}
