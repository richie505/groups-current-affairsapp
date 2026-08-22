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
// "My Banks" is meaningless to someone sitting only Group-II, and a nav full of
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
  { to: '/banks', label: 'My Banks', icon: IconFolder, lens: 'g1' },
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
  return `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-brand-600 text-white' : 'text-slate-200 hover:bg-white/10 hover:text-white'
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
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2.5">
        {/* `shrink-0` here plus a 215px theme toggle was what pushed the header
            past the viewport. The wordmark may shrink; on the narrowest screens
            the second half drops, which is what a masthead should do. */}
        <Link to={isAdmin ? '/admin' : '/'} className="min-w-0 truncate font-bold tracking-tight">
          APPSC <span className="hidden text-brand-300 xs:inline">Current Affairs</span>
        </Link>

        <nav className="ml-2 hidden flex-1 items-center gap-0.5 lg:flex">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={linkClass}>
              <Icon />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {!isAdmin ? <LensToggle className="hidden sm:inline-flex" /> : null}
          <form onSubmit={submitSearch} className="hidden md:block">
            <label className="relative block">
              <span className="sr-only">Search current affairs</span>
              <IconSearch className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-sm text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                className="w-36 rounded-md border border-white/15 bg-white/10 py-1 pl-7 pr-2 text-sm text-white placeholder:text-slate-400 focus:w-52 focus:bg-white/15"
              />
            </label>
          </form>
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md p-1.5 text-lg hover:bg-white/10 lg:hidden"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
          >
            {open ? <IconX /> : <IconMenu />}
          </button>
          <div className="hidden items-center gap-2 lg:flex">
            <Link to="/profile" className="max-w-[9rem] truncate text-sm text-slate-300 hover:text-white">
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
        <div className="border-t border-white/10 px-4 pb-3 lg:hidden">
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
              className="w-full rounded-md border border-white/15 bg-white/10 px-2 py-1.5 text-sm text-white placeholder:text-slate-400"
            />
          </form>
          <div className="flex items-center justify-between border-t border-white/10 pt-2">
            <Link to="/profile" className="text-sm text-slate-300" onClick={() => setOpen(false)}>
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
