// The VISTA dashboard is a separate application on its own origin, so links into
// it are ordinary cross-origin links, not react-router routes. Point this at the
// dashboard with VITE_VISTA_URL (see .env.example); the fallback is the address
// its dev server uses (vista-dashboard/vite.config.js pins port 5173).
const VISTA_BASE = (import.meta.env.VITE_VISTA_URL || 'http://localhost:5173').replace(/\/+$/, '');

// Where the LOGIN button and the portal links send people.
export const VISTA_LOGIN_URL = `${VISTA_BASE}/login`;

// VISTA's API, for the few read-only things this site shows from it (public
// announcements, the facility gallery). Optional: unset, the site is exactly the
// static brochure it was, which is also what it falls back to whenever the API
// is unreachable.
export const API_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

export default VISTA_BASE;
