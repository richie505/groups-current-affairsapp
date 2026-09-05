'use strict';

// Renders a compendium `data.json` to PDF with the retention template in
// pdf-template/, using Playwright's bundled Chromium.
//
// WHY THIS EXISTS RATHER THAN pdf-template/render.js
//
// The kit ships a standalone CLI, and it stays there as the reference — it is
// what the kit's README tells you to run and it must keep working. But it
// `require`s playwright from its own directory, and playwright is a dependency
// of the SERVER package, so Node resolves it from server/node_modules and finds
// nothing one folder up. Rather than move the dependency or add a second
// package.json, the app renders from inside the package that owns the
// dependency and reads the kit's three files as data.
//
// The template, the stylesheet and the DOM builder are read from disk on every
// render. They are the layout, they change without the server changing, and a
// cached copy is how you ship yesterday's design after editing theme.css.

const fs = require('fs');
const path = require('path');

const KIT = path.join(__dirname, '..', '..', '..', 'pdf-template');

function inlineHtml(data) {
  const html = fs.readFileSync(path.join(KIT, 'template.html'), 'utf8');
  const build = fs.readFileSync(path.join(KIT, 'build.js'), 'utf8');
  const theme = fs.readFileSync(path.join(KIT, 'theme.css'), 'utf8');
  // `</script>` inside the JSON would close the tag it is sitting in, and `<`
  // is the only character that can do it. The kit escapes the same way.
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html
    .replace(
      '<script src="build.js"></script>',
      `<script>window.DATA=${json};</script><script>${build}</script>`
    )
    .replace('<link rel="stylesheet" href="theme.css">', `<style>${theme}</style>`);
}

/**
 * @param {object} data      the compendium in the template's schema
 * @param {string} outPath   where to write the PDF
 * @returns {Promise<string>} outPath
 */
async function renderCompendium(data, outPath) {
  // Required lazily. The server must start on a machine that has never run
  // `npx playwright install`, and every route except this one works without it.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error(
      'Playwright is not installed. Run `npm --prefix server install` and ' +
        '`npx playwright install chromium` in server/.'
    );
  }

  const footer = String((data.meta && data.meta.footer) || '').replace(/</g, '&lt;');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(inlineHtml(data), { waitUntil: 'load' });
    // build.js sets this when the DOM is finished. Without the wait the PDF is
    // whatever had rendered by the time Chromium was asked, which on a long
    // compendium is a cover page and nothing else.
    await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 30000 });
    await page.emulateMedia({ media: 'print' });
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    await page.pdf({
      path: outPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#6B7280;` +
        `padding:0 13mm;display:flex;justify-content:space-between;">` +
        `<span>${footer}</span>` +
        `<span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      margin: { top: '14mm', right: '13mm', bottom: '16mm', left: '13mm' },
    });
  } finally {
    await browser.close();
  }
  return outPath;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `September` from `2026-09-06`. */
function monthName(iso) {
  const m = Number(String(iso).slice(5, 7));
  return MONTHS[m - 1] || '';
}

/** `APPSC-Current-Affairs-2026-09-06.pdf` — what the browser saves it as. */
function compendiumFilename(date) {
  return `APPSC-Current-Affairs-${date}.pdf`;
}

/** `APPSC-Current-Affairs-September-2026.pdf` for the monthly edition. */
function monthlyFilename(month) {
  return `APPSC-Current-Affairs-${monthName(`${month}-01`)}-${month.slice(0, 4)}.pdf`;
}

module.exports = {
  renderCompendium,
  inlineHtml,
  KIT,
  compendiumFilename,
  monthlyFilename,
  monthName,
};
