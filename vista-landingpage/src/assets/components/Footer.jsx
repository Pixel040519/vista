// src/components/Footer.jsx
import React from 'react';
import { Link } from 'react-router-dom';

const label = 'font-mono text-[11px] font-medium uppercase tracking-[0.14em]';
const linkClass = 'text-slate-300 transition-colors hover:text-yellow-400';

const schoolLinks = [
  { name: 'About', path: '/about' },
  { name: 'Vision & mission', path: '/about#vision' },
  { name: 'Programs', path: '/programs' },
  { name: 'Announcements', path: '/announcements' },
];

const admissionLinks = [
  { name: 'Requirements', path: '/admissions' },
  { name: 'Campus tour', path: '/contact' },
];

const Footer = () => {
  return (
    <footer className="bg-[#001f3f] font-sans text-slate-300 dark:bg-[#001024]">
      {/* Four across only at xl — below that the brand column is too narrow to hold the
          school name on one line, so it spans the full row instead. */}
      <div className="mx-auto grid max-w-7xl gap-10 px-6 py-14 sm:grid-cols-2 sm:px-12 lg:px-24 xl:grid-cols-[1.6fr_1fr_1fr_1fr] xl:gap-12">
        <div className="sm:col-span-2 xl:col-span-1">
          <div className="mb-4 flex items-center gap-3.5">
            <img draggable="false"
              src="/logo.png"
              alt="Northern Rizal Yorklin School seal"
              className="h-12 w-auto object-contain"
            />
            <div className="flex flex-col gap-1">
              <span className={`${label} tracking-[0.26em] text-slate-400`}>北黎刹育仁中學</span>
              <span className="whitespace-nowrap text-base font-semibold leading-snug text-white">
                Northern Rizal Yorklin School
              </span>
            </div>
          </div>
          <p className="selectable text-sm leading-relaxed">
            #253 C. Cordero St., between 5th &amp; 6th Ave.
            <br />
            Grace Park West, Caloocan City
          </p>
        </div>

        <div>
          <div className={`${label} mb-4 text-slate-500`}>School</div>
          <ul className="flex list-none flex-col gap-2.5 p-0 text-sm">
            {schoolLinks.map((link) => (
              <li key={link.name}>
                <Link to={link.path} className={linkClass}>
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className={`${label} mb-4 text-slate-500`}>Admissions</div>
          <ul className="flex list-none flex-col gap-2.5 p-0 text-sm">
            {admissionLinks.map((link) => (
              <li key={link.name}>
                <Link to={link.path} className={linkClass}>
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className={`${label} mb-4 text-slate-500`}>Contact</div>
          <ul className="selectable flex list-none flex-col gap-2.5 p-0 text-sm">
            <li>
              <a href="https://www.facebook.com/NRYS1939" target="_blank" rel="noreferrer" className={linkClass}>
                facebook.com/NRYS1939
              </a>
            </li>
            <li>
              <a href="mailto:nrys_1939@yahoo.com.ph" className={linkClass}>
                nrys_1939@yahoo.com.ph
              </a>
            </li>
            <li>
              <a href="mailto:nrys.1939@gmail.com" className={linkClass}>
                nrys.1939@gmail.com
              </a>
            </li>
            <li>
              <a href="tel:0282961782" className={linkClass}>
                8296-1782
              </a>
            </li>
            <li>
              <a href="tel:0283659318" className={linkClass}>
                8365-9318
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 sm:px-12 lg:px-24">
        <div className="flex flex-col gap-3 border-t border-white/10 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span className={`${label} text-slate-500`}>Knowledge · Benevolence · Courage</span>
          <span>
            &copy; {new Date().getFullYear()} Northern Rizal Yorklin School. All rights reserved.
          </span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
