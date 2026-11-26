// Overzicht: hoe leest de app elke tijdstiptekst uit de protocolbibliotheek?
// Gebruik:  node tests/tijdteksten.mjs [pad/naar/index.html] [uitvoer.json]
// Geeft per unieke tekst (functies én deelbezoeken) het tijdvenster op 21 juni en 15 december,
// en of de app de tekst alleen grof herkent (op basis van een woord als 'avond' of 'overdag').
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import path from 'path';
import fs from 'fs';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(process.argv[2] || path.join(HERE, '..', 'index.html'));
const OUT = process.argv[3];
const CHROME = process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

const html = fs.readFileSync(APP, 'utf8');
const LIB = JSON.parse(html.match(/<script type="application\/json" id="default-lib">([\s\S]*?)<\/script>/)[1]);
const teksten = new Map(); // tekst -> {n, duur:Set, voorbeeld}
const add = (t, duur, wie) => { const k = t || ''; if (!teksten.has(k)) teksten.set(k, { n: 0, duren: new Set(), voorbeeld: wie }); const x = teksten.get(k); x.n++; x.duren.add(duur || 0); };
LIB.soorten.forEach(s => s.functies.forEach(f => {
  add(f.tijdstip, f.duur, `${s.naam} – ${f.naam}`);
  (f.deelbezoeken || []).forEach(d => { if (d.tijdstip) add(d.tijdstip, f.duur, `${s.naam} – ${f.naam} (deelbezoek)`); });
}));

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ timezoneId: 'Europe/Amsterdam', locale: 'nl-NL' });
const page = await ctx.newPage();
await page.goto(pathToFileURL(APP).href);
await page.waitForFunction(() => typeof tijdSlot === 'function');
const rows = await page.evaluate((items) => {
  const hm = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };
  const at = (sl, iso) => {
    const [y, m, d] = iso.split('-').map(Number); const dt = new Date(y, m - 1, d);
    const N = nightMinutes(dt), sun = sunsetMinutes(dt);
    const a = sun + pointVal(sl.s, N, sun), b = sun + pointVal(sl.e, N, sun);
    return `${hm(a)}–${hm(b)}${b - a <= 0 ? ' (LEEG)' : ''}`;
  };
  return items.map(([t, info]) => {
    const duur = Math.max(...info.duren);
    const sl = tijdSlot({ tijdstip: t, duur, voorwaarden: '' });
    return { tekst: t, aantal: info.n, duur, voorbeeld: info.voorbeeld,
      herkend: !sl ? 'NIET' : (sl.rough ? 'grof' : 'ja'),
      juni: sl ? at(sl, '2026-06-21') : '', december: sl ? at(sl, '2026-12-15') : '' };
  });
}, [...teksten].map(([t, x]) => [t, { n: x.n, duren: [...x.duren], voorbeeld: x.voorbeeld }]));
await browser.close();

rows.sort((a, b) => b.aantal - a.aantal);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(`${String(r.aantal).padStart(3)}× [${r.herkend.padEnd(4)}] juni ${r.juni.padEnd(20)} dec ${r.december.padEnd(20)} ${r.tekst || '(leeg)'}`);
