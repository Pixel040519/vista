// Read-only content from VISTA's public API (vista-backend: routes/public.routes.js).
//
// This site must render with the backend down, so every read here fails SOFT:
// a short timeout, and null on any error — never a throw into a render. Callers
// always have something to show without it (the bundled gallery, or an empty
// state that points to Facebook).
import { useCallback, useEffect, useRef, useState } from 'react';
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
 * The Announcements page's list, a page at a time, for its "Load more" button.
 *
 * { status, announcements, total, hasMore, loadMore, loadingMore, loadMoreFailed }
 *   status:  as useAnnouncements, for the FIRST page only — a later page that
 *            fails leaves what is shown alone and sets loadMoreFailed instead.
 *   total:   every live public post, from the API; null if it did not say.
 *   hasMore: more to fetch. Without a total (an API from before paging) it falls
 *            back to "the last page came back full".
 *
 * Posts are de-duplicated by id: one published between two clicks shifts every
 * offset by one, and the post at the edge would otherwise appear twice.
 */
export function useAnnouncementPages(pageSize = 6) {
  const [state, setState] = useState({
    status: API_URL ? 'loading' : 'unavailable',
    announcements: [],
    total: null,
    lastPageFull: false,
    exhausted: false,
    loadingMore: false,
    loadMoreFailed: false,
  });
  // The live list for loadMore to read its offset from, without re-creating
  // loadMore on every change.
  const listRef = useRef([]);
  const busyRef = useRef(false);
  // Mounted — for loadMore, whose request outlives the render that started it.
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!API_URL) return undefined;
    // Per run, so a superseded first-page request can never land.
    let live = true;
    getPublic(`/announcements?limit=${pageSize}&offset=0`).then((data) => {
      if (!live) return;
      if (!data) {
        setState((s) => ({ ...s, status: 'unavailable' }));
        return;
      }
      const first = (data.announcements || []).map(announcementFromApi);
      listRef.current = first;
      setState((s) => ({
        ...s,
        status: 'ready',
        announcements: first,
        total: typeof data.total === 'number' ? data.total : null,
        lastPageFull: first.length === pageSize,
      }));
    });
    return () => {
      live = false;
    };
  }, [pageSize]);

  const loadMore = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setState((s) => ({ ...s, loadingMore: true, loadMoreFailed: false }));
    const data = await getPublic(
      `/announcements?limit=${pageSize}&offset=${listRef.current.length}`
    );
    busyRef.current = false;
    if (!liveRef.current) return;
    if (!data) {
      setState((s) => ({ ...s, loadingMore: false, loadMoreFailed: true }));
      return;
    }
    const page = (data.announcements || []).map(announcementFromApi);
    const seen = new Set(listRef.current.map((p) => p.id));
    const fresh = page.filter((p) => !seen.has(p.id));
    listRef.current = [...listRef.current, ...fresh];
    setState((s) => ({
      ...s,
      announcements: listRef.current,
      total: typeof data.total === 'number' ? data.total : s.total,
      lastPageFull: page.length === pageSize,
      // Nothing new at all is the end, whatever total or the page size say: a
      // post unpublished between clicks leaves total one higher than reachable.
      exhausted: fresh.length === 0,
      loadingMore: false,
    }));
  }, [pageSize]);

  const { lastPageFull, exhausted, ...rest } = state;
  const hasMore =
    state.status === 'ready' &&
    !exhausted &&
    (state.total !== null ? state.announcements.length < state.total : lastPageFull);
  return { ...rest, hasMore, loadMore };
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
