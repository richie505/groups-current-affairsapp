import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLens } from '../context/LensContext';
import LensToggle from './LensToggle';
import ThemeToggle from './ThemeToggle';
import {
  IconCalendar,
  IconLayers,
  IconHelpCircle,
  IconRepeat,
  IconTarget,
  IconBookmark,
  IconFlame,
  IconSearch,
  IconMenu,
  IconX,
  IconAlert,
  IconUsers,
  IconList,
  IconFolder,
  IconBook,
} from './Icon';

// Nav items are filtered by lens, not just by role.
//
// A nav full of
// entries that don't apply is how an app stops feeling like it was built for
// you. The G2-only items stay visible under the G1 lens, though: prelims still
// has to be cleared, and hiding practice from a Group-I candidate would be
// wrong in a way hiding banks from a Group-II candidate is not.
const STUDENT_LINKS = [
  { to: '/', label: 'Today', icon: IconCalendar, end: true },
  { to: '/archive', label: 'Archive', icon: IconLayers },
  { to: '/topics', label: 'Topics', icon: IconTarget },
  { to: '/practice', label: 'Practice', icon: IconHelpCircle },
  { to: '/revision', label: 'Revision', icon: IconRepeat },
  { to: '/mistakes', label: 'Mistakes', icon: IconAlert },
  { to: '/saved', label: 'Saved', icon: IconBookmark },
  { to: '/progress', label: 'Progress', icon: IconFlame },
];

const ADMIN_LINKS = [
  { to: '/admin', label: 'Dashboard', icon: IconTarget, end: true },
  { to: '/admin/editions', label: 'Newspaper import', icon: IconBook },
  { to: '/admin/queue', label: 'Review queue', icon: IconList },
  { to: '/admin/days', label: 'Digests', icon: IconCalendar },
  { to: '/admin/students', label: 'Students', icon: IconUsers },
];

function linkClass({ isActive }) {
  return `flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-brand-600 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
  }`;
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const { showG1 } = useLens();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  if (!user) return null;

  const isAdmin = user.role === 'admin';
  const links = isAdmin
    ? ADMIN_LINKS
    : STUDENT_LINKS.filter((l) => !l.lens || (l.lens === 'g1' && showG1));

  function submitSearch(e) {
    e.preventDefault();
    const term = q.trim();
    if (term.length < 2) return;
    navigate(`/search?q=${encodeURIComponent(term)}`);
    setOpen(false);
  }

  return (
    <header className="bg-ink text-white">
      {/* The header is NOT capped at the reading column.
          `max-w-5xl` is right for prose — 1024px of body text is comfortable —
          and wrong for a control bar, which was being squeezed into that same
          1024px on a 1285px screen while needing 1582px. The page content keeps
          its 5xl column; the bar gets the room it actually needs.
          Uncapped at 2xl, because that is where the icons and the full wordmark
          come back: restoring 286px of content inside a fixed 1280px box is how
          three links got clipped on a 1545px screen. */}
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-2.5 2xl:max-w-none">
        {/* The masthead abbreviates wherever the bar is busy, which is what a
            masthead should do. "Current Affairs" is 110px, and between `xl` and
            `2xl` that is the difference between the nav links fitting and the
            last one being cut off — the brand is the one element on this bar
            that loses nothing by being shortened, because the page it leads to
            is the same either way. */}
        <Link
          to={isAdmin ? '/admin' : '/'}
          className="min-w-0 shrink-0 truncate font-bold tracking-tight"
        >
          APPSC{' '}
          <span className="hidden text-brand-300 xs:max-xl:inline 2xl:inline">Current Affairs</span>
        </Link>

        {/* THE INLINE NAV APPEARS AT `xl`, NOT `lg`, AND THAT IS THE FIX.
            Two faults, one after the other. First, `flex-1` with no `min-w-0`:
            a flex item defaults to `min-width: auto`, so it will not shrink
            below its own content — the nav was not flexible, it was a floor,
            and with a fixed cluster on the right the row pushed the DOCUMENT
            wider. At a 1015px viewport the header ran to 1027px and the page
            grew a horizontal scrollbar with "Log out" clipped at the edge.
            Then `overflow-hidden` stopped the page overflowing by CLIPPING the
            nav — and silently ate the last two admin links, "Digests" and
            "Students", which is a worse bug than the scrollbar because nothing
            says it happened.
            The honest answer is that the links do not fit between 1024 and
            1279, so below `xl` they belong in the menu, which lists all of them.
            `min-w-0` stays as a guard: it lets the row compress if a future
            label grows, rather than shoving the page again. */}
        <nav className="ml-2 hidden min-w-0 flex-1 items-center gap-0.5 overflow-hidden xl:flex">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <span className="hidden 2xl:inline-flex">
                <Icon />
              </span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {!isAdmin ? <LensToggle className="hidden shrink-0 sm:inline-flex" /> : null}
          {/* SEARCH SHRINKS RATHER THAN DISAPPEARS.
              It is the widest thing in this cluster, so it is what yields when
              the header is tight. Hiding it below `xl` was tried and rejected:
              the in-menu search is `md:hidden`, so it would have left a band
              with no search box in the header AND none in the menu, and nothing
              in the nav links to /search. A control that vanishes with no other
              route to it is a worse bug than the one being fixed. So it narrows
              to 96px instead, and widens again on focus and at `xl`. */}
          <form onSubmit={submitSearch} className="hidden min-w-0 md:block">
            <label className="relative block">
              <span className="sr-only">Search current affairs</span>
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-white/50" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-24 min-w-0 rounded-md border border-white/15 bg-white/10 py-1 pl-7 pr-2 text-sm text-white transition-[width] placeholder:text-white/50 focus:w-52 focus:bg-white/15 xl:w-36"
              />
            </label>
          </form>
          <ThemeToggle compact />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-lg hover:bg-white/10 xl:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
          <div className="hidden items-center gap-2 xl:flex">
            <Link to="/profile" className="max-w-[9rem] truncate text-sm text-white/70 hover:text-white">
              {user.name}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium hover:bg-white/10"
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      {open ? (
        <div className="border-t border-white/10 px-4 pb-3 xl:hidden">
          <nav className="grid gap-0.5 py-2 sm:grid-cols-2">
            {links.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={linkClass} onClick={() => setOpen(false)}>
                <Icon />
                {label}
              </NavLink>
            ))}
          </nav>
          {!isAdmin ? <LensToggle className="mb-2 sm:hidden" /> : null}
          <form onSubmit={submitSearch} className="mb-2 md:hidden">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search current affairs…"
              className="w-full rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-white/50"
            />
          </form>
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <Link to="/profile" className="text-sm text-white/70" onClick={() => setOpen(false)}>
              {user.name}
            </Link>
            <button
              type="button"
              onClick={logout}
              className="rounded-md border border-white/20 px-2 py-1 text-xs font-medium"
            >
              Log out
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
