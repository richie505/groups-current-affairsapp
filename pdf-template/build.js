/* =====================================================================
   build.js — turns data.json into the document DOM.
   Pure functions; no dependencies. Works in the browser and under Playwright.
   Markdown-lite: **bold** only.
   ===================================================================== */
(function (global) {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const LETTERS = ['a', 'b', 'c', 'd'];

  function tagChips(tags) {
    if (!tags || !tags.length) return '';
    return `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  }

  function table(t) {
    const head = t.header ? `<thead><tr><th>${md(t.header[0])}</th><th>${md(t.header[1])}</th></tr></thead>` : '';
    const rows = t.rows.map(r => `<tr><td>${md(r[0])}</td><td>${md(r[1])}</td></tr>`).join('');
    return `<table class="kv">${head}<tbody>${rows}</tbody></table>`;
  }

  function block(b) {
    if (b.type === 'table') return table(b);
    if (b.type === 'p') return `<p>${md(b.text)}</p>`;
    return '';
  }

  function staticBox(s) {
    if (!s || (!s.summary && !(s.blocks || []).length)) return '';
    let html = `<div class="h4 static">Static linkage</div><div class="static-box">`;
    if (s.summary) html += `<p class="summary">${md(s.summary)}</p>`;
    for (const b of s.blocks || []) {
      html += `<h5>${esc(b.title)}</h5>`;
      if (b.type === 'table') html += table(b);
      else if (b.type === 'p') html += b.items.map(i => `<p>${md(i)}</p>`).join('');
      else html += `<ul>${b.items.map(i => `<li>${md(i)}</li>`).join('')}</ul>`;
    }
    return html + `</div>`;
  }

  // Split "Fact — value" / "Fact: value" into two cells so the eye can scan.
  function fact(f) {
    const m = f.match(/^(.{3,80}?)\s(?:—|–|:)\s(.+)$/);
    if (m) return `<div class="fact"><span class="k">${md(m[1])}</span><span class="v">${md(m[2])}</span></div>`;
    return `<div class="fact single"><span class="k">${md(f)}</span></div>`;
  }

  function question(q) {
    const opts = q.options.map((o, i) => `<li><span>(${LETTERS[i]})</span><span>${esc(o)}</span></li>`).join('');
    return `<div class="q"><div class="stem"><span class="qn">Q${q.q}.</span>${esc(q.stem)}</div><ol>${opts}</ol></div>`;
  }

  function topic(t) {
    let html = `<article class="topic" id="t${t.n}">`;
    html += `<div class="topic-open"><div class="topic-head"><div class="topic-num">${String(t.n).padStart(2, '0')}</div><div><h3>${esc(t.title)}</h3>${tagChips(t.tags)}</div></div>`;
    // Retention layer
    html += `<div class="retain">`;
    if (t.hook) html += `<div class="hook"><div class="lbl">Memory hook</div><div class="txt">${md(t.hook)}</div></div>`;
    if (t.recap && t.recap.length) html += `<div class="recap"><div class="lbl">30-second recap</div><ol>${t.recap.map(r => `<li>${md(r)}</li>`).join('')}</ol></div>`;
    html += `</div></div>`;
    if (t.why_in_news && t.why_in_news.length) html += `<div class="h4">Why in news</div><div class="prose">${t.why_in_news.map(p => `<p>${md(p)}</p>`).join('')}</div>`;
    if (t.key_details && t.key_details.length) html += `<div class="h4">Key details</div><div class="prose">${t.key_details.map(block).join('')}</div>`;
    html += staticBox(t.static_linkage);
    if (t.prelims_facts && t.prelims_facts.length) html += `<div class="h4">Prelims facts</div><div class="facts">${t.prelims_facts.map(fact).join('')}</div>`;
    if (t.questions && t.questions.length) {
      html += `<div class="h4 quiz">Practice questions</div><div class="questions">${t.questions.map(question).join('')}</div>`;
      html += `<div class="answers-strip">Answers → ${t.questions.map(q => `<b>Q${q.q}</b>&nbsp;${q.answer}`).join(' &nbsp;·&nbsp; ')} &nbsp;(explanations in the answer key)</div>`;
    }
    return html + `</article>`;
  }

  function cover(meta, sections) {
    const topics = sections.flatMap(s => s.topics);
    const nQ = topics.reduce((a, t) => a + (t.questions || []).length, 0);
    return `<section class="cover">
      <div class="kicker">${esc(meta.subtitle || '')}</div>
      <h1>${esc(meta.title)}</h1>
      <div class="date">${esc(meta.weekday ? meta.weekday + ', ' : '')}${esc(meta.date)}</div>
      <div class="exams">${(meta.exams || []).map(e => `<span>${esc(e)}</span>`).join('')}</div>
      <div class="stats">
        <div class="stat"><div class="num">${topics.length}</div><div class="lbl">High-yield topics</div></div>
        <div class="stat"><div class="num">${nQ}</div><div class="lbl">Practice questions</div></div>
        <div class="stat"><div class="num">${sections.length}</div><div class="lbl">Sections</div></div>
      </div>
      <div class="howto"><h3>How to study this compendium</h3><ol>
        <li><strong>First pass (10 min):</strong> read only the <em>Memory hook</em> and <em>30-second recap</em> of every topic. That is the skeleton you must retain.</li>
        <li><strong>Second pass (20 min):</strong> read Why in news → Key details → Static linkage. Bold text = the words examiners lift into options.</li>
        <li><strong>Test (5 min per topic):</strong> attempt the 4 practice questions without looking back; check the answer strip; read the explanation only for mistakes.</li>
        <li><strong>Next day:</strong> re-read the one-page <em>Hook sheet</em> at the end. If a hook does not unlock the recap in your head, revisit that topic.</li>
      </ol></div>
      <dl class="meta">
        <dt>Sections</dt><dd>${sections.map(s => `${esc(s.title)} (${s.topics.length})`).join(' · ')}</dd>
        <dt>Format</dt><dd>Memory hook + 30-second recap + Why in news + Key details + Static linkage + Prelims facts + 4 MCQs per topic</dd>
        <dt>Reading time</dt><dd>${esc(meta.reading_time || '')}</dd>
        <dt>Source</dt><dd>${esc(meta.source || '')}</dd>
      </dl>
      <div class="disclaimer">${esc(meta.disclaimer || '')}</div>
    </section>`;
  }

  function toc(sections) {
    return `<section class="toc page-break"><h2>Contents</h2>${sections.map(s => `
      <div class="toc-section"><h3>${esc(s.label)} — ${esc(s.title)}<small>${s.topics.length} topics</small></h3>
      ${s.topics.map(t => `<div class="toc-row"><div class="n">${t.n}</div><div><div>${esc(t.title)}</div>${t.hook ? `<div class="hook">${md(t.hook)}</div>` : ''}<div class="tags">${(t.tags || []).join(' · ')}</div></div></div>`).join('')}
      </div>`).join('')}</section>`;
  }

  function hookSheet(sections) {
    return `<section class="hooksheet page-break"><h2>Hook sheet — one-page revision</h2>
      <p class="intro">Cover the right-hand column and try to recall the recap from the hook alone. Tick the ones you get; revisit the rest.</p>
      ${sections.map(s => `<div class="hookrow"><div></div><div class="sec">${esc(s.label)} — ${esc(s.title)}</div></div>` + s.topics.map(t => `<div class="hookrow"><div class="n">${t.n}</div><div><div class="t">${esc(t.title)}</div><div class="h">${md(t.hook || '')}</div></div></div>`).join('')).join('')}
    </section>`;
  }

  function answerKey(sections) {
    const topics = sections.flatMap(s => s.topics);
    const quick = topics.map(t => t.questions.map(q => `<b>Q${q.q} · ${q.answer}</b>`).join(' ')).join(' ');
    return `<section class="key page-break"><h2>Answer key</h2>
      <p class="intro">Quick check first, then read the reasoning only where you went wrong.</p>
      <div class="quick">${quick}</div><div class="body">
      ${topics.map(t => `<div class="topic-key"><h4>${String(t.n).padStart(2, '0')}. ${esc(t.title)}</h4>
        ${t.questions.map(q => `<div class="ans"><div class="pill">Q${q.q} · ${q.answer}</div><div>${esc(q.explanation || '')}${q.as_of ? ` <span class="asof">Correct as of ${esc(q.as_of)}.</span>` : ''}</div></div>`).join('')}
      </div>`).join('')}</div>
    </section>`;
  }

  function buildDocument(data, root) {
    const { meta, sections } = data;
    let html = cover(meta, sections) + toc(sections);
    for (const s of sections) {
      html += `<div class="section-banner"><div class="lbl">${esc(s.label)}</div><h2>${esc(s.title)}</h2><div class="count">${s.topics.length} topics · Topics ${s.topics[0].n}–${s.topics[s.topics.length - 1].n}</div></div>`;
      html += s.topics.map(topic).join('');
    }
    html += hookSheet(sections) + answerKey(sections);
    root.innerHTML = html;
  }

  global.buildDocument = buildDocument;
})(typeof window !== 'undefined' ? window : globalThis);
