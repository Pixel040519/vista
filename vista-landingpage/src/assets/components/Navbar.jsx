// src/components/Navbar.jsx
import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { VISTA_LOGIN_URL } from '../../config';

const Navbar = () => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);

  // 1. LAZY INITIALIZATION: Check local storage. Default to Light Mode if no save exists.
  const [isDark, setIsDark] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });

  // 2. APPLY EFFECT: Only run this when 'isDark' actually changes
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  // 3. TOGGLE FUNCTION: Just flip the boolean, the useEffect will handle the rest
  const toggleTheme = () => setIsDark(!isDark);

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'About', path: '/about' },
    { name: 'Programs', path: '/programs' },
    { name: 'Admissions', path: '/admissions' },
    { name: 'Announcements', path: '/announcements' },
    { name: 'Contact', path: '/contact' },
  ];

  const label = 'font-mono text-[11px] font-medium uppercase tracking-[0.14em]';

  return (
    <>
      {/* Utility bar — scrolls away, unlike the nav below it */}
      <div className="bg-[#001f3f] text-slate-300 dark:bg-[#001024]">
        <div className={`${label} mx-auto flex h-9 max-w-7xl items-center justify-end px-6 sm:px-12 lg:px-24`}>
          {/* The full address needs xl to fit; the locality alone carries the smaller widths. */}
          <span className="selectable xl:hidden">Grace Park West, Caloocan City</span>
          <span className="selectable hidden xl:inline">
            #253 C. Cordero St., Bet. 5th &amp; 6th Ave. Grace Park West, Caloocan City
          </span>
        </div>
      </div>

      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white text-slate-900 shadow-sm transition-colors duration-300 dark:border-white/10 dark:bg-[#002855] dark:text-white">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-6 px-6 sm:px-12 lg:px-24">
          <div className="flex cursor-pointer items-center gap-2" onClick={() => navigate('/')}>
            <img draggable="false"
              src="/logo.png"
              alt="Northern Rizal Yorklin School seal"
              className="h-11 w-auto object-contain sm:h-12"
            />

            <span className="text-base font-semibold leading-tight tracking-tight text-[#001f3f] sm:text-lg dark:text-white">
              <span className="sm:hidden">Yorklin School</span>
              <span className="hidden sm:inline">Northern Rizal Yorklin School</span>
            </span>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden items-center gap-7 xl:flex">
            <ul className="flex list-none gap-6 p-0 text-[14.5px] font-medium">
              {navLinks.map((link) => (
                <li key={link.name}>
                  <NavLink
                    to={link.path}
                    // Without `end`, "/" would count as active on every page.
                    end={link.path === '/'}
                    className={({ isActive }) =>
                      `border-b-2 pb-1 transition-colors ${
                        isActive
                          ? 'border-yellow-400 font-semibold text-[#002855] dark:text-yellow-400'
                          : 'border-transparent text-slate-700 hover:text-[#002855] dark:text-slate-200 dark:hover:text-yellow-400'
                      }`
                    }
                  >
                    {link.name}
                  </NavLink>
                </li>
              ))}
            </ul>

            {/* Theme Toggle Button (Desktop) */}
            <button
              onClick={toggleTheme}
              className="rounded-full p-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
              aria-label="Toggle Dark Mode"
            >
              {isDark ? (
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41" />
                </svg>
              ) : (
                <svg className="h-5 w-5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
                </svg>
              )}
            </button>

            <a
              href={VISTA_LOGIN_URL}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-yellow-400 px-6 py-2.5 text-[13.5px] font-bold tracking-wide text-[#002855] shadow-sm transition-colors hover:bg-yellow-300 dark:bg-yellow-500 dark:hover:bg-yellow-400"
            >
              LOGIN
            </a>
          </nav>

          {/* Mobile Controls */}
          <div className="flex items-center gap-2 xl:hidden">
            {/* Theme Toggle Button (Mobile) */}
            <button
              onClick={toggleTheme}
              className="rounded-full p-2 transition-colors hover:bg-slate-100 dark:hover:bg-white/10"
              aria-label="Toggle Dark Mode"
            >
              {isDark ? (
                <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M19.07 4.93l-1.41 1.41M6.34 17.66l-1.41 1.41" /></svg>
              ) : (
                <svg className="h-5 w-5 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
              )}
            </button>

            <button
              className="p-2 text-slate-900 dark:text-white"
              onClick={() => setIsOpen(!isOpen)}
              aria-label="Toggle Menu"
              aria-expanded={isOpen}
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                {isOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {isOpen && (
          <div className="border-t border-slate-200 bg-white px-6 py-4 sm:px-12 xl:hidden dark:border-white/10 dark:bg-[#001f44]">
            <ul className="flex list-none flex-col gap-4 p-0">
              {navLinks.map((link) => (
                <li key={link.name}>
                  <NavLink
                    to={link.path}
                    end={link.path === '/'}
                    onClick={() => setIsOpen(false)}
                    className={({ isActive }) =>
                      `block border-l-2 pl-3 font-medium transition-colors ${
                        isActive
                          ? 'border-yellow-400 font-semibold text-[#002855] dark:text-yellow-400'
                          : 'border-transparent text-slate-900 hover:text-[#002855] dark:text-white dark:hover:text-yellow-400'
                      }`
                    }
                  >
                    {link.name}
                  </NavLink>
                </li>
              ))}
              <li className="border-t border-slate-200 pt-4 dark:border-white/10">
                <a
                  href={VISTA_LOGIN_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setIsOpen(false)}
                  className="block w-full rounded-full bg-yellow-400 py-3 text-center text-sm font-bold tracking-wide text-[#002855] shadow-sm transition-colors hover:bg-yellow-300 dark:bg-yellow-500 dark:hover:bg-yellow-400"
                >
                  LOGIN
                </a>
              </li>
            </ul>
          </div>
        )}
      </header>
    </>
  );
};

export default Navbar;
