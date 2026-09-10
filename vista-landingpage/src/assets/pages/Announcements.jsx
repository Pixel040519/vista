// src/pages/Announcements.jsx
import React from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import { Label, Icon, SECTION, HEADING } from '../components/ui';
import { announcements, FACEBOOK_PAGE } from '../data/announcements';

const Announcements = () => (
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
            <a
              href={FACEBOOK_PAGE}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-max items-center gap-2 rounded-full bg-[#002855] px-7 py-3.5 font-semibold text-white transition-colors hover:bg-[#003a7a] dark:bg-yellow-500 dark:text-[#002855] dark:hover:bg-yellow-400"
            >
              <Icon size={18}>
                <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
              </Icon>
              See all updates on Facebook
            </a>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            {announcements.map((post) => (
              <article
                key={post.id}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="rounded-full border border-slate-200 bg-[#F0F4F8] px-3 py-1 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[#002855] dark:border-white/10 dark:bg-white/10 dark:text-yellow-400">
                    {post.category}
                  </span>
                  <Label className="text-slate-500 dark:text-slate-400">{post.date}</Label>
                </div>
                <h3 className="text-xl font-semibold leading-snug text-[#001f3f] dark:text-white">
                  {post.title}
                </h3>
                <p className="leading-relaxed text-slate-600 dark:text-slate-300">{post.excerpt}</p>
              </article>
            ))}
          </div>

          <p className="mt-8 border-l-2 border-yellow-400 pl-4 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            The posts above are sample entries. The school&apos;s live announcements are published
            on its Facebook page.
          </p>
        </div>
      </section>
    </main>

    <Footer />
  </div>
);

export default Announcements;
