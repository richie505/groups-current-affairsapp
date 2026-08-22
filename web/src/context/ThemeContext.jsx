import { createContext, useCallback, useContext, useEffect, useState } from 'react';

// Light / dark / follow-the-system.
//
// Three states rather than a boolean, because "match my phone" is what most
// people actually want — and a boolean silently means "ignore the system
// forever" the first time anyone touches the switch.

const KEY = 'appsc_theme';
const ThemeContext = createContext(null);

const prefersDark = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;

function read() {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

const resolve = (pref) => pref === 'dark' || (pref === 'system' && prefersDark());

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(read);
  // The *resolved* answer, not the preference. Almost everything reads the
  // theme through CSS and needs nothing from here, but an <img> can't be
  // restyled into a different file — the logo has a separate dark artwork, and
  // picking it needs "is it dark right now", which under 'system' only the
  // media query knows. Kept in state so a change re-renders those consumers.
  const [isDark, setIsDark] = useState(() => resolve(read()));

  const apply = useCallback((pref) => {
    const dark = resolve(pref);
    setIsDark(dark);
    document.documentElement.classList.toggle('dark', dark);
    // Keeps the mobile browser chrome in step with the page.
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#0b0f19' : '#1d4ed8');
  }, []);

  useEffect(() => {
    apply(preference);
    try {
      if (preference === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, preference);
    } catch {
      // Private mode — the choice just won't persist.
    }
  }, [preference, apply]);

  // Only while following the system: someone who has explicitly chosen light
  // shouldn't be flipped at sunset by their phone's schedule.
  useEffect(() => {
    if (preference !== 'system') return undefined;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [preference, apply]);

  return (
    <ThemeContext.Provider value={{ preference, setPreference, isDark }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
