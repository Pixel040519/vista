// Read-only content from VISTA's public API (vista-backend: routes/public.routes.js).
//
// This site must render with the backend down, so every read here fails SOFT:
// a short timeout, and null on any error — never a throw into a render. Callers
// always have something to show without it (the bundled gallery, or an empty
// state that points to Facebook).
import { useEffect, useState } from 'react';
import { API_URL } from '../../config';
import { announcementFromApi } from '../data/announcements';
import { bundledFacilities, facilitiesFromApi } from '../data/facilities';

const TIMEOUT_MS = 4000;

export async function getPublic(path) {
  if (!API_URL) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/api/public${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * { status, announcements }
 *   status: 'loading' | 'ready' | 'unavailable'. Unavailable covers both "no
 *   API configured" and "API unreachable", which the page treats the same.
 */
export function useAnnouncements(limit = 20) {
  const [state, setState] = useState({
    status: API_URL ? 'loading' : 'unavailable',
    announcements: [],
  });
  useEffect(() => {
    if (!API_URL) return undefined;
    let live = true;
    getPublic(`/announcements?limit=${limit}`).then((data) => {
      if (!live) return;
      setState(
        data
          ? { status: 'ready', announcements: (data.announcements || []).map(announcementFromApi) }
          : { status: 'unavailable', announcements: [] }
      );
    });
    return () => {
      live = false;
    };
  }, [limit]);
  return state;
}

/**
 * The facility gallery. Starts on the bundled photos and swaps in VISTA's only
 * when it answers with at least one facility, so the section is never empty
 * and never waits on the network.
 */
export function useFacilities() {
  const [rooms, setRooms] = useState(bundledFacilities);
  useEffect(() => {
    if (!API_URL) return undefined;
    let live = true;
    getPublic('/facilities').then((data) => {
      if (!live || !data) return;
      const fromApi = facilitiesFromApi(data.facilities || []);
      if (fromApi.length) setRooms(fromApi);
    });
    return () => {
      live = false;
    };
  }, []);
  return rooms;
}
