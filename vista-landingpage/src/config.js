// The VISTA dashboard is a separate application on its own origin, so links into
// it are ordinary cross-origin links, not react-router routes. Point this at the
// dashboard with VITE_VISTA_URL (see .env.example); the fallback is the address
// its dev server uses (vista-dashboard/vite.config.js pins port 5173).
const VISTA_BASE = (import.meta.env.VITE_VISTA_URL || 'http://localhost:5173').replace(/\/+$/, '');

// Where the LOGIN button and the portal links send people.
export const VISTA_LOGIN_URL = `${VISTA_BASE}/login`;

export default VISTA_BASE;
