'use strict';

// Which Python to spawn, and how to read what it prints back.
//
// Shared by every caller of a pipeline Python script — the server's ingest
// path and both content-pipeline extractors — because all three had the same
// two bugs and all three fixed them separately would drift.

const { spawnSync } = require('child_process');

// THE INTERPRETER IS NOT CALLED THE SAME THING ON BOTH MACHINES.
//
// This used to default to `python`, which is right on the Windows workstation
// where the app is developed and wrong on the Ubuntu server it deploys to:
// Debian and Ubuntu ship `python3` and no bare `python` at all, unless someone
// installs python-is-python3.
//
// The failure was `spawnSync python ENOENT`, surfaced in the UI as a processing
// job that simply said "failed" — the first upload on the live server died on
// it, with every dependency correctly installed.
//
// So it is detected rather than assumed, once per process. NP_PYTHON still
// wins, for a virtualenv or a specific version.
let cached = null;

function pythonBin() {
  if (cached) return cached;
  if (process.env.NP_PYTHON) return (cached = process.env.NP_PYTHON);
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'pass'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) return (cached = candidate);
  }
  // Nothing found. Return the conventional name so the caller fails with
  // ENOENT naming a real binary, rather than something invented here.
  return (cached = 'python3');
}

/**
 * Parses a JSON document out of a script's stdout, tolerating noise before it.
 *
 * STDOUT IS NOT A PRIVATE CHANNEL. A library can print to it at import time and
 * some do: PyMuPDF 1.28 writes "warning: The `fitz` API is deprecated" to
 * stdout, which turned every extraction into `Unexpected token 'w'`. The import
 * is fixed at source, but the lesson generalises — the next dependency to do
 * this should cost a log line, not an outage.
 *
 * Only leading noise is skipped, and only up to the first brace or bracket.
 * Anything that is not parseable JSON still throws, and the message carries what
 * was actually printed, because "not valid JSON" without the text is the kind of
 * error that takes an hour.
 */
function parseJsonStdout(stdout, { label = 'script' } = {}) {
  const text = String(stdout || '');
  const start = text.search(/[[{]/);
  if (start === -1) {
    throw new Error(`${label} printed no JSON. It said: ${text.trim().slice(0, 400) || '(nothing)'}`);
  }
  if (start > 0) {
    const noise = text.slice(0, start).trim();
    if (noise) console.warn(`[${label}] ignored ${noise.split('\n').length} line(s) before the JSON: ${noise.slice(0, 200)}`);
  }
  try {
    return JSON.parse(text.slice(start));
  } catch (e) {
    throw new Error(`${label} did not return valid JSON (${e.message}). Output began: ${text.trim().slice(0, 400)}`);
  }
}

module.exports = { pythonBin, parseJsonStdout };
