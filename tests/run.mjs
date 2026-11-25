// Testsuite Veldwerkplanner — combinatie- en planningslogica.
// Gebruik:  node tests/run.mjs            (alle tests)
//           node tests/run.mjs boomkikker (alleen tests waarvan de naam dit bevat)
// Laadt index.html via file:// in headless Chrome (Playwright) en roept de functies van de app aan.
// index.html wordt niet aangepast; alleen in het geheugen van de testpagina worden synthetische
// soorten toegevoegd en wordt het actieve project ingesteld.
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';
import { cases } from './cases.mjs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'index.html');
const APP_URL = pathToFileURL(APP).href;
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

// Protocolbibliotheek (alleen gelezen, om de verwachtingen voor echte functies uit de data af te leiden)
const html = fs.readFileSync(APP, 'utf8');
const LIB = JSON.parse(html.match(/<script type="application\/json" id="default-lib">([\s\S]*?)<\/script>/)[1]);
export const LIBF = {}; // id -> {f, soort}
LIB.soorten.forEach(s => s.functies.forEach(f => { LIBF[f.id] = { f, soort: s }; }));

// ---------- datumhulpjes (UTC, los van de app) ----------
const D = iso => { const [y, m, d] = iso.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const days = (a, b) => Math.round((D(b) - D(a)) / 86400000);
const addD = (iso, n) => new Date(D(iso) + n * 86400000).toISOString().slice(0, 10);
const md = iso => { const [, m, d] = iso.split('-').map(Number); return m * 100 + d; };
const dmv = s => { const [d, m] = s.split('-').map(Number); return m * 100 + d; };
const inDM = (iso, van, tot) => { const x = md(iso), a = dmv(van), b = dmv(tot); return a <= b ? (x >= a && x <= b) : (x >= a || x <= b); };
export const H = { D, days, addD, md, inDM };

// ---------- app laden ----------
async function openPage(browser, today) {
  const ctx = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date(`${today}T09:00:00+01:00`));
  await page.goto(APP_URL);
  await page.waitForFunction(() => typeof renderCombinations === 'function');
  return { ctx, page, errors };
}

// Draait het volledige veldbezoekplan (renderCombinations) voor een scenario en geeft gestructureerde uitvoer.
async function runPlan(browser, sc) {
  const { ctx, page, errors } = await openPage(browser, sc.today);
  try {
    const res = await page.evaluate((sc) => {
      const pad = n => String(n).padStart(2, '0');
      const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      // synthetische soorten toevoegen (zelfde vorm als de bibliotheek-JSON)
      (sc.soorten || []).forEach(s => {
        species.push({ id: s.id, naam: s.naam, categorie: s.categorie || 'Overige', bronUrl: '', gecontroleerd: '', combinatiegroep: s.combinatiegroep || '',
          functies: s.functies.map(f => mkF(f.id, f)) });
      });
      project.selected = sc.selected.slice();
      project.deadline = sc.deadline || '';
      project.planVanaf = sc.planVanaf || '';
      project.visits = JSON.parse(JSON.stringify(sc.visits || {}));
      project.combiAlles = !!sc.combiAlles;
      project.combiSub = !!sc.combiSub;
      project.maxLen = sc.maxLen == null ? null : sc.maxLen;
      // vang de plannen op die daadwerkelijk getoond worden
      const captured = [];
      const orig = planBlockHtml;
      planBlockHtml = function (plan, maxLenMin, nr) {
        captured.push(plan.rounds.map(r => ({
          es: iso(fromN(r.es)), lf: iso(fromN(r.lf)), timeWarn: !!r.timeWarn, subs: r.subs,
          members: r.idx.map(i => ({ fid: plan.nodes[i].fid, idx: plan.nodes[i].m.idx, kind: plan.nodes[i].m.kind, fixed: plan.nodes[i].m.fixed != null }))
        })));
        return orig.apply(this, arguments);
      };
      renderCombinations();
      planBlockHtml = orig;
      const out = document.getElementById('combo-out');
      return {
        groups: captured,
        rounds: captured.flat(),
        domRows: out.querySelectorAll('.timeline-row').length,
        problems: [...out.querySelectorAll(':scope > .risk-note')].map(e => e.textContent.trim()),
        notes: [...out.querySelectorAll(':scope > .detail')].map(e => e.textContent.trim()),
        text: out.innerText
      };
    }, sc);
    res.errors = errors;
    return res;
  } finally { await ctx.close(); }
}

// ---------- algemene invarianten (gelden voor elk plan) ----------
function defsFor(sc) {
  const m = {};
  (sc.soorten || []).forEach(s => s.functies.forEach(f => { m[f.id] = { f, soort: s }; }));
  sc.selected.forEach(id => { if (!m[id] && LIBF[id]) m[id] = LIBF[id]; });
  return m;
}
function invariants(sc, res) {
  const fails = [];
  const defs = defsFor(sc);
  const lo = [sc.today, sc.planVanaf].filter(Boolean).sort().pop();
  const label = id => defs[id] ? `${defs[id].soort.naam} — ${defs[id].f.naam}` : id;
  const hasProblem = id => res.problems.some(p => p.startsWith(label(id)));
  if (res.errors.length) fails.push({ regel: '-', msg: `JavaScript-fout in de app: ${res.errors.join(' | ')}` });
  if (res.domRows !== res.rounds.length) fails.push({ regel: '-', msg: `aantal getoonde veldbezoeken (${res.domRows}) ≠ aantal in het plan (${res.rounds.length})` });
  const byF = {};
  res.rounds.forEach((r, k) => {
    if (r.es > r.lf) fails.push({ regel: '-', msg: `veldbezoek ${k + 1}: vroegste datum ${r.es} ligt na uiterste datum ${r.lf}` });
    // regel 8: niet vóór vandaag / plannen-vanaf, niet na de deadline
    if (r.es < lo && !r.members.every(m => m.fixed)) fails.push({ regel: 8, msg: `veldbezoek ${k + 1} begint ${r.es}, vóór de startdatum ${lo}` });
    if (sc.deadline && r.lf > sc.deadline) fails.push({ regel: 8, msg: `veldbezoek ${k + 1} loopt tot ${r.lf}, na de deadline ${sc.deadline}` });
    const seen = new Set();
    r.members.forEach(m => {
      if (seen.has(m.fid)) fails.push({ regel: 4, msg: `veldbezoek ${k + 1} bevat ${label(m.fid)} twee keer` });
      seen.add(m.fid);
      (byF[m.fid] = byF[m.fid] || []).push(r);
      // regel 3/5: elke dag van [es, lf] ligt in het (ideale of suboptimale of vaste) venster van de functie
      const f = defs[m.fid] && defs[m.fid].f; if (!f) return;
      const wins = [];
      if (f.van && f.tot) wins.push([f.van, f.tot]);
      if (f.vanSub && f.totSub) wins.push([f.vanSub, f.totSub]);
      (f.deelbezoeken || []).forEach(d => wins.push([d.van, d.tot]));
      if (sc.idealOnly && sc.idealOnly.includes(m.fid)) wins.splice(0, wins.length, [f.van, f.tot]);
      for (let d = r.es; d <= r.lf; d = addD(d, 1)) {
        if (!wins.some(([a, b]) => inDM(d, a, b))) { fails.push({ regel: sc.idealOnly && sc.idealOnly.includes(m.fid) ? 3 : 5, msg: `veldbezoek ${k + 1} (${r.es}…${r.lf}): ${d} valt buiten het venster van ${label(m.fid)} (${wins.map(w => w.join('–')).join(' / ')})` }); break; }
      }
    });
    // regel 2: verklaarde onverenigbare paren mogen nooit samen in één veldbezoek
    (sc.incompatibel || []).forEach(([a, b]) => {
      if (seen.has(a) && seen.has(b)) fails.push({ regel: 2, msg: `veldbezoek ${k + 1} combineert ${label(a)} en ${label(b)}, die niet combineerbaar zijn` });
    });
  });
  Object.keys(defs).forEach(fid => {
    if (!sc.selected.includes(fid)) return;
    const f = defs[fid].f;
    const vis = Object.entries(sc.visits || {}).filter(([k]) => k.startsWith(fid + '#')).map(([, v]) => v);
    const done = vis.filter(v => v.status === 'uitgevoerd'), skip = vis.filter(v => v.status === 'vervallen');
    const need = (f.bezoeken || 1) - done.length - skip.length;
    const rs = (byF[fid] || []).slice().sort((a, b) => a.es.localeCompare(b.es));
    // regel 8: precies het resterende aantal bezoeken, tenzij een probleem is gemeld
    if (!hasProblem(fid) && rs.length !== need) fails.push({ regel: 8, msg: `${label(fid)}: ${rs.length} bezoek(en) ingepland, verwacht ${need} (bezoeken ${f.bezoeken} − uitgevoerd ${done.length} − vervallen ${skip.length})` });
    // regel 4: tussenperiode (minimaal tussenSub als die bestaat, anders tussen; ten minste 1 dag)
    const T = f.tussen || 0, Ts = Number(f.tussenSub) > 0 ? Number(f.tussenSub) : T;
    const gap = Math.max(1, sc.strictSpacing && sc.strictSpacing.includes(fid) ? T : Math.min(T, Ts));
    const es = done.map(v => v.datum).concat(rs.map(r => r.es)).sort();
    const lf = done.map(v => v.datum).concat(rs.map(r => r.lf)).sort();
    for (const [nm, arr] of [['vroegste', es], ['uiterste', lf]])
      for (let i = 1; i < arr.length; i++) if (days(arr[i - 1], arr[i]) < gap)
        fails.push({ regel: 4, msg: `${label(fid)}: bij de ${nm} data liggen ${arr[i - 1]} en ${arr[i]} ${days(arr[i - 1], arr[i])} dagen uit elkaar, minimaal ${gap}` });
    // regel 6: deelbezoeken — minstens 'aantal' veldbezoeken volledig binnen het deelvenster
    if (!vis.length && !hasProblem(fid)) (f.deelbezoeken || []).forEach(db => {
      const n = rs.filter(r => { for (let d = r.es; d <= r.lf; d = addD(d, 1)) if (!inDM(d, db.van, db.tot)) return false; return true; }).length;
      if (n < db.aantal) fails.push({ regel: 6, msg: `${label(fid)}: ${n} bezoek(en) volledig in ${db.van}–${db.tot}, vereist ${db.aantal} (data: ${rs.map(r => r.es + '…' + r.lf).join(', ')})` });
    });
  });
  return fails;
}

// ---------- runner ----------
const filter = process.argv[2] ? process.argv[2].toLowerCase() : null;
const sel = cases.filter(c => !filter || c.naam.toLowerCase().includes(filter));
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let pass = 0, fail = 0, info = 0;
const report = [];
const short = s => { const t = typeof s === 'string' ? s : JSON.stringify(s); return t.length > 400 ? t.slice(0, 400) + '…' : t; };
for (const c of sel) {
  let fails = [], detail = '';
  try {
    if (c.type === 'plan') {
      const res = await runPlan(browser, c.scenario);
      fails = invariants(c.scenario, res).concat((c.check ? c.check(res, H) : []).map(m => typeof m === 'string' ? { regel: c.regel, msg: m } : m));
      detail = `plan: ${res.rounds.length} veldbezoek(en): ` + res.rounds.map(r => `[${r.es}…${r.lf}: ${r.members.map(m => m.fid.replace(/^.*--/, '')).join('+')}]`).join(' ')
        + (res.problems.length ? ` | problemen: ${res.problems.join(' / ')}` : '');
    } else {
      const { ctx, page, errors } = await openPage(browser, c.today || '2026-11-25');
      try {
        const v = await page.evaluate(c.run, c.arg === undefined ? null : c.arg);
        fails = (c.check(v, H) || []).map(m => typeof m === 'string' ? { regel: c.regel, msg: m } : m);
        if (errors.length) fails.push({ regel: '-', msg: 'JavaScript-fout: ' + errors.join(' | ') });
        detail = 'uitvoer app: ' + short(v);
      } finally { await ctx.close(); }
    }
  } catch (e) { fails = [{ regel: c.regel, msg: 'testfout: ' + e.message }]; }
  const status = fails.length ? (c.info ? 'INFO' : 'FAIL') : 'PASS';
  if (status === 'PASS') pass++; else if (status === 'FAIL') fail++; else info++;
  console.log(`${status.padEnd(4)}  [regel ${c.regel}] ${c.naam}`);
  if (fails.length) {
    console.log(`        verwacht: ${c.verwacht}`);
    fails.forEach(f => console.log(`        ✗ (regel ${f.regel}) ${f.msg}`));
    console.log(`        ${short(detail)}`);
  }
  report.push({ naam: c.naam, regel: c.regel, status, fails, detail });
}
await browser.close();
fs.writeFileSync(path.join(HERE, 'laatste-resultaat.json'), JSON.stringify(report, null, 1));
console.log(`\n${pass} geslaagd, ${fail} mislukt${info ? `, ${info} ter info (open vraag, telt niet mee)` : ''} — van ${sel.length} tests.`);
process.exit(fail ? 1 : 0);
