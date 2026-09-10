// src/pages/Contact.jsx
import React from 'react';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import PageHeader from '../components/PageHeader';
import { Label, Icon, IconTile, SECTION, HEADING } from '../components/ui';
import { FACEBOOK_PAGE } from '../data/announcements';

const Contact = () => (
  <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
    <Navbar />

    <main className="flex-grow">
      <PageHeader
        eyebrow="We're here to help"
        title="Contact us"
        lede="Questions about enrollment, programs or the VISTA portal? Reach the school through any of the channels below."
      />

      <section className="bg-white dark:bg-[#00152e]">
        <div className={SECTION}>
          <Label className="mb-3 block text-slate-500 dark:text-slate-400">Get in touch</Label>
          <h2 className={`${HEADING} mb-10`}>Four ways to reach us</h2>

          <div className="selectable grid gap-6 sm:grid-cols-2">
            {/* LOCATION */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5">
              <IconTile>
                <Icon>
                  <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
                  <circle cx="12" cy="10" r="3" />
                </Icon>
              </IconTile>
              <h3 className="text-lg font-semibold text-[#001f3f] dark:text-white">Our location</h3>
              <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                #253 C. Cordero Bet. 5th &amp; 6th Ave.
                <br />
                Grace Park West, Caloocan City
              </p>
            </div>

            {/* PHONE */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5">
              <IconTile>
                <Icon>
                  <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.4-1.2a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z" />
                </Icon>
              </IconTile>
              <h3 className="text-lg font-semibold text-[#001f3f] dark:text-white">Call us</h3>
              <div className="flex flex-col gap-2">
                <a
                  href="tel:0282961782"
                  className="text-slate-600 transition-colors hover:text-[#002855] dark:text-slate-300 dark:hover:text-yellow-400"
                >
                  8296-1782
                </a>
                <a
                  href="tel:0283659318"
                  className="text-slate-600 transition-colors hover:text-[#002855] dark:text-slate-300 dark:hover:text-yellow-400"
                >
                  8365-9318
                </a>
              </div>
            </div>

            {/* EMAIL */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5">
              <IconTile>
                <Icon>
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m2 7 10 6 10-6" />
                </Icon>
              </IconTile>
              <h3 className="text-lg font-semibold text-[#001f3f] dark:text-white">Email us</h3>
              <div className="flex flex-col gap-2">
                <a
                  href="mailto:nrys_1939@yahoo.com.ph"
                  className="break-all text-slate-600 transition-colors hover:text-[#002855] dark:text-slate-300 dark:hover:text-yellow-400"
                >
                  nrys_1939@yahoo.com.ph
                </a>
                <a
                  href="mailto:nrys.1939@gmail.com"
                  className="break-all text-slate-600 transition-colors hover:text-[#002855] dark:text-slate-300 dark:hover:text-yellow-400"
                >
                  nrys.1939@gmail.com
                </a>
              </div>
            </div>

            {/* FACEBOOK */}
            <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 p-7 dark:border-white/10 dark:bg-white/5">
              <IconTile>
                <Icon>
                  <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
                </Icon>
              </IconTile>
              <h3 className="text-lg font-semibold text-[#001f3f] dark:text-white">Message us</h3>
              <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                The school posts its updates and answers messages on its Facebook page.
              </p>
              <a
                href={FACEBOOK_PAGE}
                target="_blank"
                rel="noreferrer"
                className="mt-auto w-max font-semibold text-blue-700 hover:underline dark:text-yellow-400"
              >
                facebook.com/NRYS1939 &rarr;
              </a>
            </div>
          </div>

          <p className="mt-8 border-l-2 border-yellow-400 pl-4 leading-relaxed text-slate-600 dark:text-slate-300">
            The registrar&apos;s office is open on weekdays. Walk-ins are welcome; an appointment is
            not required.
          </p>
        </div>
      </section>
    </main>

    <Footer />
  </div>
);

export default Contact;
