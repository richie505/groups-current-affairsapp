/** @type {import('tailwindcss').Config} */

// Dark mode without touching every component.
//
// The obvious approach — adding a `dark:` variant to each of the ~600 colour
// utilities across 30 files — is a lot of edits and, worse, a lot of places to
// silently miss one and leave grey-on-grey text. So the palette itself is
// variable-driven instead: `bg-white` compiles to `rgb(var(--c-white))`, and
// the dark theme redefines that variable once, in index.css.
//
// The scales are then *inverted* under .dark — slate-50 becomes near-black,
// slate-900 becomes near-white — so every existing pairing keeps its intended
// contrast direction. A card that was `bg-white text-slate-900` becomes dark
// card, light text, with no change to the component.
//
// <alpha-value> is Tailwind's placeholder, so opacity modifiers like
// `bg-white/40` and `text-slate-600/50` still work.
const v = (name) => `rgb(var(${name}) / <alpha-value>)`;

const scale = (prefix, steps) =>
  Object.fromEntries(steps.map((s) => [s, v(`--c-${prefix}-${s}`)]));

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900];

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // `white` stays literally white. It is used 41 times as *text on a
        // coloured button* (bg-brand-600 text-white, bg-green-700 text-white),
        // and those fills keep their colour in dark mode — so flipping it
        // would put near-black text on every primary button in the app.
        //
        // Card surfaces therefore need their own token rather than borrowing
        // `bg-white`, and dark chrome that is meant to stay dark in both
        // themes (the highlighter's floating bar) needs `ink`.
        surface: v('--c-surface'),
        ink: v('--c-ink'),
        slate: scale('slate', STEPS),
        brand: scale('brand', [50, 100, 200, 300, 400, 500, 600, 700]),
        green: scale('green', STEPS),
        red: scale('red', STEPS),
        amber: scale('amber', STEPS),
      },
    },
  },
  plugins: [],
};
