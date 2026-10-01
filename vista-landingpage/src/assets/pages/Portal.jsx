// src/pages/Portal.jsx
import React from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { Label, Icon, SECTION, HEADING } from '../components/ui';
import { VISTA_LOGIN_URL, PARENT_APP_ANDROID_URL, PARENT_APP_IOS_URL } from '../../config';

// Only the stores the app is actually published on get a button; with neither
// link configured the panel points to the school office instead.
const downloads = [
  { label: 'Download for Android', href: PARENT_APP_ANDROID_URL },
  { label: 'Download for iPhone', href: PARENT_APP_IOS_URL },
].filter((d) => d.href);

// Teachers and administrators share one sign-in; VISTA decides what each sees
// from the account's role, so both rows lead to the same page.
const staff = ['Teachers', 'Administrators'];

const steps = [
  {
    title: 'Give the school your email',
    text: 'The school office registers it on your child’s record. Access is by invitation; there is no sign-up form.',
  },
  {
    title: 'Install the app',
    text: 'Get the VISTA parent app on your phone from the download section above.',
  },
  {
    title: 'Activate your account',
    text: 'Enter that email in the app. A one-time code arrives in your inbox and is valid for 10 minutes.',
  },
  {
    title: 'Choose your password',
    text: 'You are signed in straight away. The school never sees or sets your password.',
  },
];

const questions = [
  {
    q: 'The code never arrived',
    a: 'Check your spam folder, and make sure you typed the same email the school has on record. If it still does not arrive, ask the school office to confirm your address.',
  },
  {
    q: 'I forgot my password',
    a: 'Parents can reset it from the app’s sign-in screen with a code sent by email. Teachers and administrators choose “Forgot password?” on the VISTA sign-in page.',
  },
  {
    q: 'I have more than one child at the school',
    a: 'One email is one login. All your children appear in the same app once the school has linked them to your address.',
  },
];

const PANEL =
  'rounded-2xl border border-slate-200 bg-white shadow-lg shadow-[#001f3f]/10 dark:border-white/10 dark:bg-[#002855] dark:shadow-none';

const Portal = () => (
  <div className="flex min-h-screen flex-col bg-white font-sans text-slate-800 selection:bg-yellow-300 selection:text-[#002855] dark:bg-[#00152e] dark:text-slate-100">
    <Navbar />

    <main className="flex-grow">
      {/* Not PageHeader: the two panels below overlap this band, so it needs the
          extra room at its foot. */}
      <section className="bg-[#001f3f] dark:bg-[#001024]">
        <div className="mx-auto max-w-7xl px-6 pb-40 pt-14 sm:px-12 lg:px-24 lg:pt-16">
          <Label className="mb-4 block text-yellow-400">The VISTA portal</Label>
          <h1 className="text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-[44px]">
            Parents use the app. Staff sign in on the web.
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-slate-300">
            VISTA is the school&apos;s academic performance monitoring system. Start on the side
            that describes you.
          </p>
        </div>
      </section>

      <section className="bg-[#F0F4F8] dark:bg-[#001f44]">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 sm:px-12 lg:grid-cols-[7fr_5fr] lg:px-24 lg:pb-20">
          {/* PARENTS */}
          <div className={`${PANEL} -mt-24 flex flex-col gap-5 p-7 sm:p-10`}>
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#001f3f] text-yellow-400 dark:bg-white/10">
                <Icon size={24}>
                  <rect x="6" y="2" width="12" height="20" rx="2" />
                  <path d="M11 18h2" />
                </Icon>
              </span>
              <Label className="text-slate-600 dark:text-slate-300">
                Parents &amp; guardians · Mobile app
              </Label>
            </div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight text-[#001f3f] sm:text-[32px] dark:text-white">
              Your child&apos;s school day, on your phone
            </h2>

            {downloads.length > 0 ? (
              <div className="flex flex-col gap-3 sm:flex-row">
                {downloads.map((d) => (
                  <a
                    key={d.label}
                    href={d.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-14 flex-1 items-center justify-between gap-4 rounded-2xl bg-[#002855] px-6 font-semibold text-white transition-colors hover:bg-[#003a7a] dark:bg-yellow-500 dark:text-[#002855] dark:hover:bg-yellow-400"
                  >
                    {d.label}
                    <Icon size={18}>
                      <path d="M12 3v12" />
                      <path d="m7 10 5 5 5-5" />
                      <path d="M5 21h14" />
                    </Icon>
                  </a>
                ))}
              </div>
            ) : (
              <p className="leading-relaxed text-slate-600 dark:text-slate-300">
                The school office provides the VISTA parent app when it registers your email
                address.
              </p>
            )}

            <a
              href="#setup"
              className="font-semibold text-[#002855] underline-offset-4 hover:text-[#003a7a] hover:underline dark:text-yellow-400 dark:hover:text-yellow-300"
            >
              First time? See how to set it up &darr;
            </a>
          </div>

          {/* STAFF */}
          <div className={`${PANEL} flex flex-col gap-5 p-7 sm:p-10 lg:-mt-24`}>
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#002855] dark:bg-white/10 dark:text-yellow-400">
                <Icon size={24}>
                  <rect x="2" y="4" width="20" height="13" rx="2" />
                  <path d="M8 21h8" />
                  <path d="M12 17v4" />
                </Icon>
              </span>
              <Label className="text-slate-600 dark:text-slate-300">School staff · Web</Label>
            </div>
            <h2 className="text-2xl font-bold leading-tight tracking-tight text-[#001f3f] dark:text-white">
              Sign in to VISTA
            </h2>
            <div className="flex flex-col gap-3">
              {staff.map((who) => (
                <a
                  key={who}
                  href={VISTA_LOGIN_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-300 px-5 py-5 text-[17px] font-semibold text-[#001f3f] transition-colors hover:border-[#002855] hover:bg-[#F0F4F8] dark:border-white/15 dark:text-white dark:hover:border-yellow-400 dark:hover:bg-white/5"
                >
                  {who}
                  <Icon size={20}>
                    <path d="M5 12h14" />
                    <path d="m13 6 6 6-6 6" />
                  </Icon>
                </a>
              ))}
            </div>
            <p className="mt-auto text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Both open VISTA in a new tab. Access is by invitation; there is no sign-up. First
              time? Choose &ldquo;Activate your account&rdquo; there and set your own password.
            </p>
          </div>
        </div>
      </section>

      {/* SETUP — scroll-mt clears the sticky nav when "First time?" jumps here */}
      <section id="setup" className="scroll-mt-24 bg-white dark:bg-[#00152e]">
        <div className={SECTION}>
          <Label className="mb-3 block text-slate-500 dark:text-slate-400">
            For parents · First-time setup
          </Label>
          <h2 className={`${HEADING} mb-10`}>Four steps to get the parent app working</h2>
          <ol className="grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, i) => (
              <li
                key={step.title}
                className="flex flex-col gap-3 rounded-2xl border border-slate-200 p-6 dark:border-white/10 dark:bg-white/5"
              >
                <span className="self-start border-b-[3px] border-yellow-400 pb-2 font-mono text-[28px] font-medium leading-none text-[#001f3f] dark:text-white">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <h3 className="text-[17px] font-semibold leading-snug text-[#001f3f] dark:text-white">
                  {step.title}
                </h3>
                <p className="text-[14.5px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {step.text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* COMMON QUESTIONS */}
      <section className="border-t border-slate-200 bg-[#F0F4F8] dark:border-white/10 dark:bg-[#001f44]">
        <div className={`${SECTION} grid gap-10 lg:grid-cols-[4fr_8fr] lg:gap-14`}>
          <div>
            <h2 className="mb-4 text-2xl font-bold tracking-tight text-[#001f3f] sm:text-[28px] dark:text-white">
              Common questions
            </h2>
            <p className="mb-6 leading-relaxed text-slate-600 dark:text-slate-300">
              Anything else, the school office can help.
            </p>
            <Link
              to="/contact"
              className="inline-block rounded-full border border-[#002855] px-7 py-3 text-sm font-semibold text-[#002855] transition-colors hover:bg-white dark:border-white/15 dark:text-white dark:hover:bg-white/10"
            >
              Contact the school
            </Link>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5">
            {questions.map((item, i) => (
              <div
                key={item.q}
                className={`px-6 py-6 ${
                  i < questions.length - 1 ? 'border-b border-slate-200 dark:border-white/10' : ''
                }`}
              >
                <h3 className="mb-1.5 font-semibold text-[#001f3f] dark:text-white">{item.q}</h3>
                <p className="text-[14.5px] leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.a}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>

    <Footer />
  </div>
);

export default Portal;
