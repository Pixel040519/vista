// src/components/Navbar.jsx
import React, { useState, useEffect } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

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
        <div className={`${label} mx-auto flex h-11 max-w-7xl items-stretch justify-end px-6 sm:justify-between sm:px-12 lg:px-24`}>
          <span className="hidden items-center text-slate-400 sm:flex">
            Knowledge · Benevolence · Courage
          </span>
          <Link
            to="/portal"
            className="flex items-center gap-2 text-yellow-400 transition-colors hover:text-yellow-300 sm:border-l sm:border-white/15 sm:pl-5"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1" />
            </svg>
            VISTA Portal
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
          </Link>
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
                {/* The strip's Portal link scrolls away; this one stays with the pinned nav. */}
                <Link
                  to="/portal"
                  onClick={() => setIsOpen(false)}
                  className="block w-full rounded-full bg-yellow-400 py-3 text-center text-sm font-bold tracking-wide text-[#002855] shadow-sm transition-colors hover:bg-yellow-300 dark:bg-yellow-500 dark:hover:bg-yellow-400"
                >
                  VISTA PORTAL
                </Link>
              </li>
            </ul>
          </div>
        )}
      </header>
    </>
  );
};

export default Navbar;
