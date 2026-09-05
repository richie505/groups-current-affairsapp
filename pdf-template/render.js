#!/usr/bin/env node
/* =====================================================================
   render.js — data.json  ->  PDF   (Playwright + Chromium)
   Usage:  node render.js data.json out.pdf
   Requires: npm i playwright  (then: npx playwright install chromium)
   ===================================================================== */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

async function main() {
  const [dataPath = 'data.json', outPath = 'out.pdf'] = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const dir = __dirname;
  const html = fs.readFileSync(path.join(dir, 'template.html'), 'utf8')
    .replace('<script src="build.js"></script>',
      `<script>window.DATA=${JSON.stringify(data).replace(/</g, '\\u003c')};</script><script>${fs.readFileSync(path.join(dir, 'build.js'), 'utf8')}</script>`)
    .replace('<link rel="stylesheet" href="theme.css">', `<style>${fs.readFileSync(path.join(dir, 'theme.css'), 'utf8')}</style>`);

  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1');
  await page.emulateMedia({ media: 'print' });

  const footer = (data.meta && data.meta.footer) || '';
  await page.pdf({
    path: outPath,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate: `<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5px;color:#6B7280;padding:0 13mm;display:flex;justify-content:space-between;">
        <span>${footer.replace(/</g, '&lt;')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    margin: { top: '14mm', right: '13mm', bottom: '16mm', left: '13mm' },
  });
  await browser.close();
  console.log('wrote', outPath);
}

main().catch(e => { console.error(e); process.exit(1); });
