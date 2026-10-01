import React, { useEffect } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import Home from './assets/pages/Home';
import About from './assets/pages/About';
import Programs from './assets/pages/Programs';
import Contact from './assets/pages/Contact';
import Admissions from './assets/pages/Admissions';
import Announcements from './assets/pages/Announcements';
import Portal from './assets/pages/Portal';
import './style.css';

// React Router keeps the previous scroll position across navigations and ignores
// #hash targets. Restore both: jump to the anchor when there is one, otherwise
// start the new page at the top.
function ScrollManager() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    let cancelled = false;

    const go = () => {
      if (cancelled) return;
      // behavior:'auto' is required, not cosmetic: style.css sets a global
      // `scroll-behavior: smooth`, whose animated scroll gets cancelled during a
      // navigation. The smooth rule still applies to in-page anchor clicks.
      if (hash) {
        const el = document.getElementById(hash.slice(1));
        if (el) {
          el.scrollIntoView({ block: 'start', behavior: 'auto' });
          return;
        }
      }
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    };

    // Two frames, so the incoming page has actually been laid out. Scrolling in
    // the same tick silently does nothing: the document is still only
    // viewport-height at that point, so there is nowhere to scroll to yet.
    const schedule = () => requestAnimationFrame(() => requestAnimationFrame(go));

    // On a cold load the web fonts arrive after first paint and change the text
    // metrics, which moves the anchor. Waiting for them stops the jump landing
    // hundreds of pixels off.
    if (hash && document.fonts && document.fonts.status !== 'loaded') {
      document.fonts.ready.then(schedule);
    } else {
      schedule();
    }

    return () => {
      cancelled = true;
    };
  }, [pathname, hash]);

  return null;
}

function App() {
  return (
    <div className="App">
      <ScrollManager />
      <main id="content-area">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/programs" element={<Programs />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/announcements" element={<Announcements />} />
          <Route path="/admissions" element={<Admissions />} />
          <Route path="/portal" element={<Portal />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
