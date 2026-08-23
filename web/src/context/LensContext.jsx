import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';

// The track lens.
//
// Group-I Prelims and Group-II are two different published syllabi, examined
// separately, and the same news item belongs to different units in each. Both
// are answered by ticking a box — the lens used to switch between a written
// paper and a ticked one, and now switches between two syllabi. Rather than
// build two apps or two content sets, every screen reads this lens and renders
// the syllabus it asks for.
//
// The lens is *not* the same thing as the account's exam_track. The track is
// what the student is preparing for; the lens is what they want to look at
// right now. Someone on 'both' reads the digest in G2 shape while doing prelims
// revision and in G1 shape while building banks, often on the same day — so the
// lens has to be switchable per session without editing their profile.

const LensContext = createContext(null);

const STORAGE_KEY = 'appsc_ca_lens';
export const LENSES = ['g1', 'g2', 'both'];

// The stored key stays 'g1' rather than becoming 'g1p'. It is written into
// every user's localStorage and into users.exam_track, and renaming it would
// silently reset the lens for everyone who has already chosen one — for a
// label change.
export const LENS_LABELS = {
  g1: 'Group I Prelims',
  g2: 'Group II',
  both: 'Both',
};

export function LensProvider({ children }) {
  const { user } = useAuth();

  // Start from whatever was last chosen, falling back to the account's track.
  // A student on 'g2' should never have to switch the lens on every visit, and
  // a student on 'both' gets the combined view until they narrow it.
  const [lens, setLens] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return LENSES.includes(stored) ? stored : null;
  });

  useEffect(() => {
    if (!lens && user?.exam_track) setLens(user.exam_track);
  }, [user, lens]);

  useEffect(() => {
    if (lens) localStorage.setItem(STORAGE_KEY, lens);
  }, [lens]);

  const value = useMemo(() => {
    const active = lens || user?.exam_track || 'both';
    return {
      lens: active,
      setLens,
      // Derived booleans rather than string comparisons at every call site —
      // `showG1` reads clearly and can't be got wrong the way `lens !== 'g2'`
      // can when someone adds a fourth lens later.
      showG1: active === 'g1' || active === 'both',
      showG2: active === 'g2' || active === 'both',
      isBoth: active === 'both',
    };
  }, [lens, user]);

  return <LensContext.Provider value={value}>{children}</LensContext.Provider>;
}

export function useLens() {
  const ctx = useContext(LensContext);
  // A default rather than a throw: a component rendered outside the provider
  // (a standalone error page, a test) should still render both lanes rather
  // than crash.
  return ctx || { lens: 'both', setLens: () => {}, showG1: true, showG2: true, isBoth: true };
}
