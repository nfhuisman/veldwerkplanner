// Testgevallen Veldwerkplanner. Elke verwachting is afgeleid uit de regels van de eigenaar (README),
// de protocoldata en de handleiding — NIET uit wat de app teruggeeft.
//
// Twee soorten tests:
//  type 'unit': run(arg) draait in de pagina (alleen app-functies en arg gebruiken), check(waarde, H) geeft een lijst met fouten.
//  type 'plan': scenario wordt door het volledige veldbezoekplan (renderCombinations) gehaald. Daarna worden de algemene
//               invarianten uit run.mjs gecontroleerd (venster, tussenperiode, deelbezoeken, aantallen, deadline,
//               onverenigbare paren) plus de eigen check(res, H) van het geval.
//  res.rounds = [{es, lf, members:[{fid, idx, kind, fixed}]}]  (es/lf = vroegste/uiterste datum, ISO)
//  res.problems = risicomeldingen, res.notes = overige meldingen, res.text = alle tekst van het plan.

// ---------- tijdstipteksten ----------
const NACHT = 'vanaf 0 min na zonsondergang tot 0 min voor zonsopkomst';          // hele nacht (vleermuizen)
const SCHEMER = '1 uur voor zonsondergang tot een half uur na zonsondergang';       // gierzwaluw
const DAG1014 = 'ochtend tot begin middag (10:00-14:00 uur)';                       // boomkikker zomerbiotoop
const OCHTEND = 'ochtendbezoek: eindtijd 60 min voor zonsopkomst';                 // alleen-ochtend vleermuiscontrole
const ZWERM = '0:00 - 2:00 uur';
const PAAR = 'vanaf 60 min na zonsondergang tot 0 uur voor zonsopkomst';

// Referentie De Bilt (CEST/CET), voor tijdcontroles met tolerantie ±15 min (regel 9)
// 21-06-2026: zonsondergang ca. 22:04, zonsopkomst ca. 05:19 ; 15-12-2026: zonsondergang ca. 16:28, zonsopkomst ca. 08:41
const JUN = { date: '2026-06-21', ss: 22 * 60 + 4, sr: 24 * 60 + 5 * 60 + 19 };
const DEC = { date: '2026-12-15', ss: 16 * 60 + 28, sr: 24 * 60 + 8 * 60 + 41 };
const TOL = 15;
const hm = m => { const x = ((Math.round(m) % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`; };

// Rekent in de pagina een tijdstiptekst om naar begin/eind in minuten na middernacht van de opgegeven datum
// (waarden > 1440 = na middernacht). Gebruikt de eigen parser van de app (tijdSlot) en de eigen zon-berekening.
function slotRun({ tijdstip, duur, date }) {
  const [y, m, d] = date.split('-').map(Number); const dt = new Date(y, m - 1, d);
  const sl = tijdSlot({ tijdstip, duur, voorwaarden: '' });
  if (!sl) return null;
  const N = nightMinutes(dt), sun = sunsetMinutes(dt);
  return { vs: Math.round(sun + pointVal(sl.s, N, sun)), ve: Math.round(sun + pointVal(sl.e, N, sun)), slot: sl };
}
function slotCase(naam, tijdstip, duur, ref, expS, expE, extra) {
  return {
    type: 'unit', regel: 3, naam,
    verwacht: `begin ${hm(expS)}, eind ${hm(expE)} (±${TOL} min) op ${ref.date}`,
    arg: { tijdstip, duur, date: ref.date }, run: slotRun,
    check: v => {
      if (!v) return ['tijdstip niet herkend'];
      const out = [];
      if (Math.abs(v.vs - expS) > TOL) out.push(`begin: verwacht ${hm(expS)}, app ${hm(v.vs)} (slot ${JSON.stringify(v.slot.s)})`);
      if (Math.abs(v.ve - expE) > TOL) out.push(`eind: verwacht ${hm(expE)}, app ${hm(v.ve)} (slot ${JSON.stringify(v.slot.e)})`);
      if (v.ve - v.vs < (expE - expS) - TOL) out.push(`lengte tijdvenster: verwacht ${expE - expS} min, app ${v.ve - v.vs} min`);
      return out.concat(extra ? extra(v) : []);
    }
  };
}

// Combineerbaarheid qua tijdstip (timeEval van de app) voor een aantal combinaties.
function compatRun({ fs, combos, date, maxLen }) {
  const [y, m, d] = date.split('-').map(Number); const dt = new Date(y, m - 1, d);
  const mem = fs.map(f => ({ slot: tijdSlot(Object.assign({ voorwaarden: '' }, f)) }));
  return combos.map(c => !!timeEval(c.map(i => mem[i]), dt, maxLen));
}
function compatCase(naam, regel, fs, combos, expect, date, waarom) {
  return {
    type: 'unit', regel, naam, verwacht: `${combos.map((c, i) => c.join('+') + (expect[i] ? ' combineerbaar' : ' NIET combineerbaar')).join('; ')} — ${waarom}`,
    arg: { fs, combos, date, maxLen: 240 }, run: compatRun,
    check: v => combos.map((c, i) => v[i] === expect[i] ? null : `combinatie ${c.map(k => fs[k].tijdstip).join(' + ')}: verwacht ${expect[i] ? 'combineerbaar' : 'niet combineerbaar'}, app zegt ${v[i] ? 'combineerbaar' : 'niet combineerbaar'}`).filter(Boolean)
  };
}

// ---------- synthetische functies (zelfde vorm als de bibliotheek-JSON) ----------
const F = (L, o) => Object.assign({ id: 't-' + L, naam: 'Functie ' + L, van: '01-06', tot: '30-06', vanSub: '', totSub: '', bezoeken: 1, tussen: 0, tussenSub: 0,
  tijdstip: NACHT, duur: 2, personen: 1, bron: 'test', voorwaarden: '', deelbezoeken: [], protocolversie: '', indicatief: false, alternatiefGroep: '' }, o || {});
// elke synthetische functie in een eigen soort, alle in dezelfde combinatiegroep ('Overige')
const scen = (o) => {
  const fns = o.fns || [];
  return Object.assign({ today: '2027-01-15', visits: {}, combiAlles: false, combiSub: false },
    o, { soorten: fns.map(f => ({ id: 'sp-' + f.id, naam: 'Testsoort ' + f.id.slice(2), categorie: o.categorie || 'Overige', functies: [f] })),
      selected: fns.map(f => f.id).concat(o.lib || []), fns: undefined, lib: undefined });
};
const count = (n, waarom) => res => res.rounds.length === n ? [] : [{ regel: 1, msg: `aantal veldbezoeken: verwacht ${n} (${waarom}), app ${res.rounds.length}` }];
const of = (res, fid) => res.rounds.filter(r => r.members.some(m => m.fid === fid)).sort((a, b) => a.es.localeCompare(b.es));
const within = (res, fid, a, b, regel) => of(res, fid).filter(r => r.es < a || r.lf > b).map(r => ({ regel, msg: `${fid}: veldbezoek ${r.es}…${r.lf} valt niet binnen ${a}…${b}` }));
const all = (...fs) => (res, H) => fs.flatMap(f => f(res, H));

// echte bibliotheekfuncties
const L = {
  kraam: 'sp-gewone-dwergvleermuis--kraamverblijfplaats',
  zomer: 'sp-gewone-dwergvleermuis--zomerverblijfplaats',
  gzKlein: 'sp-gierzwaluw--nest-klein-plangebied-max-3-woningen-gierend-in-',
  gzGroot: 'sp-gierzwaluw--nest-groot-plangebied-meer-dan-3-woningen-intens',
  bkVoort: 'sp-boomkikker--voortplantingsbiotoop',
  bkZomer: 'sp-boomkikker--zomerbiotoop-juvenielen-en-adulten',
  alpen: 'sp-alpenwatersalamander--voortplantingsbiotoop-larven-en-adulten',
  das: 'sp-das--inventariseren-van-achtergelaten-sporen-burchten',
};

export const cases = [
  // ======================= Regel 9: zon-berekening (sanity) =======================
  {
    type: 'unit', regel: 9, naam: 'Zonsondergang half december ca. 16:30 en eind juni ca. 22:00 (zomertijd)',
    verwacht: `15-12: ${hm(DEC.ss)} ±${TOL}; 21-06: ${hm(JUN.ss)} ±${TOL}`,
    run: () => [sunsetMinutes(new Date(2026, 11, 15)), sunsetMinutes(new Date(2026, 5, 21))],
    check: v => [Math.abs(v[0] - DEC.ss) > TOL ? `15-12: app ${hm(v[0])}` : null, Math.abs(v[1] - JUN.ss) > TOL ? `21-06: app ${hm(v[1])}` : null].filter(Boolean)
  },
  {
    type: 'unit', regel: 9, naam: 'Zonsopkomst half december ca. 08:40 en eind juni ca. 05:20',
    verwacht: `15-12: ${hm(DEC.sr)} ±${TOL}; 21-06: ${hm(JUN.sr)} ±${TOL}`,
    run: () => [new Date(2026, 11, 15), new Date(2026, 5, 21)].map(d => sunsetMinutes(d) + nightMinutes(d)),
    check: v => [Math.abs(v[0] - DEC.sr) > TOL ? `15-12: app ${hm(v[0])}` : null, Math.abs(v[1] - JUN.sr) > TOL ? `21-06: app ${hm(v[1])}` : null].filter(Boolean)
  },

  // ======================= Regel 3: tijdstipteksten begrijpen =======================
  slotCase('Tijdstip "vanaf 60 min na zonsondergang tot 0 uur voor zonsopkomst" (juni)', PAAR, 2, JUN, JUN.ss + 60, JUN.sr),
  slotCase('Tijdstip "vanaf 60 min na zonsondergang tot 0 uur voor zonsopkomst" (december)', PAAR, 2, DEC, DEC.ss + 60, DEC.sr),
  slotCase('Tijdstip "vanaf een half uur na zonsondergang tot middernacht"', 'vanaf een half uur na zonsondergang tot middernacht', 0, JUN, JUN.ss + 30, 1440),
  slotCase('Tijdstip "tussen zonsondergang en middernacht" (4 functies in de bibliotheek)', 'tussen zonsondergang en middernacht', 0, JUN, JUN.ss, 1440),
  slotCase('Tijdstip "1 uur voor zonsondergang tot een half uur na zonsondergang"', SCHEMER, 0, JUN, JUN.ss - 60, JUN.ss + 30),
  slotCase('Tijdstip "0:00 - 2:00 uur" (nacht na de datum)', ZWERM, 2, JUN, 1440, 1440 + 120),
  // Dagvensters liggen in het rekenkader van de app op de dag ná de avond van de datum (net als 'overdag'
  // en de ochtendbezoeken in deze testset), dus 10:00 = 1440 + 600.
  slotCase('Tijdstip "ochtend tot begin middag (10:00-14:00 uur)"', DAG1014, 0, JUN, 1440 + 600, 1440 + 840),
  // Toegevoegd 25-11-2026: formuleringen uit bibliotheek v72
  slotCase('Tijdstip "vanaf zonsondergang tot 3 uur en 45 minuten daarna"', "'s avonds, vanaf zonsondergang tot 3 uur en 45 minuten daarna", 0, JUN, JUN.ss, JUN.ss + 225),
  slotCase('Tijdstip "direct vanaf zonsondergang, uiterlijk 120 minuten daarna"', 'direct vanaf zonsondergang, uiterlijk 120 minuten daarna', 0, JUN, JUN.ss, JUN.ss + 120),
  slotCase('Tijdstip "tussen zonsondergang en zonsopgang (\'s nachts)"', "tussen zonsondergang en zonsopgang ('s nachts)", 0, DEC, DEC.ss, DEC.sr),
  slotCase('Tijdstip "tussen 22:00 en 01:00 uur (of vanaf 0 min na zonsondergang)"', 'tussen 22:00 en 01:00 uur (of vanaf 0 min na zonsondergang)', 0, JUN, 22 * 60, 25 * 60),
  slotCase('Tijdstip "vanaf 15 min na zonsondergang tot 60 min voor zonsopkomst (suboptimaal: …)" → ideale venster', 'vanaf 15 min na zonsondergang tot 60 min voor zonsopkomst (suboptimaal: tot 30 min voor zonsopkomst)', 2, JUN, JUN.ss + 15, JUN.sr - 60),
  compatCase('"overdag (ochtend of namiddag)" is overdag: combineerbaar met 10:00 tot 17:00, niet met een nachtbezoek', 3,
    [{ tijdstip: 'overdag (ochtend of namiddag)', duur: 0 }, { tijdstip: '10:00 tot 17:00', duur: 0 }, { tijdstip: NACHT, duur: 2 }],
    [[0, 1], [0, 2]], [true, false], '2027-06-15', 'het eerstgenoemde dagdeel (overdag) telt'),
  slotCase('Tijdstip alleen-ochtend vleermuis: "eindtijd 60 min voor zonsopkomst" (2 uur)', OCHTEND, 2, JUN, JUN.sr - 180, JUN.sr - 60),
  {
    type: 'unit', regel: 3, naam: 'Tijdstip "overdag" valt tussen zonsopkomst en zonsondergang',
    verwacht: `begin en eind tussen ca. ${hm(JUN.sr)} en ${hm(JUN.ss)} (±${TOL}), positieve lengte`,
    arg: { tijdstip: 'overdag', duur: 0, date: JUN.date }, run: slotRun,
    check: v => {
      if (!v) return ['tijdstip niet herkend'];
      const c = x => ((x % 1440) + 1440) % 1440, lo = JUN.sr - 1440 - TOL, hi = JUN.ss + TOL, out = [];
      if (c(v.vs) < lo || c(v.vs) > hi) out.push(`begin ${hm(v.vs)} valt niet overdag`);
      if (c(v.ve) < lo || c(v.ve) > hi) out.push(`eind ${hm(v.ve)} valt niet overdag`);
      if (!(v.ve > v.vs)) out.push(`lengte ${v.ve - v.vs} min`);
      return out;
    }
  },

  // ======================= Regel 3 / 2: combineerbaarheid qua tijdstip =======================
  compatCase('Schemerbezoek (gierzwaluw) en 10:00–14:00 (boomkikker) zijn nooit combineerbaar', 3,
    [{ tijdstip: SCHEMER, duur: 0 }, { tijdstip: DAG1014, duur: 0 }], [[0, 1]], [false], '2027-07-05', 'schemer en middag liggen uren uit elkaar'),
  compatCase('Twee functies 10:00–14:00 zijn combineerbaar', 3,
    [{ tijdstip: DAG1014, duur: 0 }, { tijdstip: DAG1014, duur: 0 }], [[0, 1]], [true], '2027-07-15', 'zelfde tijdvenster'),
  compatCase('Twee nachtvensters (kraam + zomerverblijf, 2 uur) zijn combineerbaar', 3,
    [{ tijdstip: NACHT, duur: 2 }, { tijdstip: NACHT, duur: 2 }], [[0, 1]], [true], '2027-06-15', 'zelfde nachtvenster, ruim lang genoeg'),
  compatCase('"0:00 - 2:00 uur" (2 uur) en "vanaf 60 min na zonsondergang tot zonsopkomst" (2 uur) zijn combineerbaar', 3,
    [{ tijdstip: ZWERM, duur: 2 }, { tijdstip: PAAR, duur: 2 }], [[0, 1]], [true], '2027-08-20', 'overlap 0:00–2:00 is precies de vereiste 2 uur'),
  compatCase('Ochtendbezoek (eind 60 min voor zonsopkomst) en schemerbezoek zijn niet combineerbaar', 3,
    [{ tijdstip: OCHTEND, duur: 2 }, { tijdstip: SCHEMER, duur: 0 }], [[0, 1]], [false], '2027-06-20', 'avondschemer en ochtend liggen > 4 uur uit elkaar'),
  compatCase('Ochtendbezoek en hele-nacht-vleermuisbezoek (2 uur) zijn combineerbaar', 3,
    [{ tijdstip: OCHTEND, duur: 2 }, { tijdstip: NACHT, duur: 2 }], [[0, 1]], [true], '2027-06-20', 'het nachtvenster omvat de ochtendperiode'),
  compatCase('Schemerbezoek en "0:00 - 2:00 uur" passen niet binnen 4 uur', 3,
    [{ tijdstip: SCHEMER, duur: 0 }, { tijdstip: ZWERM, duur: 2 }], [[0, 1]], [false], '2027-07-05', 'van 1 uur vóór zonsondergang tot 2:00 is > 4 uur'),
  compatCase('Keten A~B, B~C, A≁C (18–19, 20–21, 22–23 uur, max. 4 uur): A+B+C mag niet', 2,
    [{ tijdstip: '18:00 - 19:00', duur: 1 }, { tijdstip: '20:00 - 21:00', duur: 1 }, { tijdstip: '22:00 - 23:00', duur: 1 }],
    [[0, 1], [1, 2], [0, 2], [0, 1, 2]], [true, true, false, false], '2027-06-15', 'A+C duurt 5 uur > max. 4 uur, dus ook A+B+C niet'),

  // ======================= Regel 5: jaargrens (venster-berekening) =======================
  {
    type: 'unit', regel: 5, naam: 'Venster 01-12 t/m 01-03 loopt over de jaargrens',
    verwacht: 'ideaal 2026-12-01 … 2027-03-01',
    run: () => { const w = windowsForYear({ van: '01-12', tot: '01-03', vanSub: '', totSub: '' }, 2026); const p = n => String(n).padStart(2, '0'), i = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; return [i(w.ideal.start), i(w.ideal.end)]; },
    check: v => (v[0] === '2026-12-01' && v[1] === '2027-03-01') ? [] : [`app: ${v.join(' … ')}`]
  },
  {
    type: 'unit', regel: 5, naam: 'Das: ideaal 01-09 t/m 31-05 over de jaargrens',
    verwacht: 'ideaal 2026-09-01 … 2027-05-31',
    run: () => { const x = findFunctie('sp-das--inventariseren-van-achtergelaten-sporen-burchten').functie; const w = windowsForYear(x, 2026); const p = n => String(n).padStart(2, '0'), i = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; return [i(w.ideal.start), i(w.ideal.end)]; },
    check: v => (v[0] === '2026-09-01' && v[1] === '2027-05-31') ? [] : [`app: ${v.join(' … ')}`]
  },

  // ======================= Regel 1: minimaal aantal veldbezoeken =======================
  {
    type: 'plan', regel: 1, naam: 'Minimum: A(2×, 20 d) + B(2×, 20 d) + C(1×) in hetzelfde venster → 2 veldbezoeken',
    verwacht: '2 veldbezoeken (A1+B1+C, A2+B2)',
    scenario: scen({ fns: [F('A', { van: '01-05', bezoeken: 2, tussen: 20 }), F('B', { van: '01-05', bezoeken: 2, tussen: 20 }), F('C', { van: '01-05' })] }),
    check: count(2, 'A en B hebben elk 2 bezoeken nodig, alles is combineerbaar')
  },
  {
    type: 'plan', regel: 1, naam: 'Minimum: A(3×, 10 d) juni + B (1–5 juni) + C (25–30 juni) → 3 veldbezoeken',
    verwacht: '3 veldbezoeken (A1+B, A2, A3+C)',
    scenario: scen({ fns: [F('A', { bezoeken: 3, tussen: 10 }), F('B', { tot: '05-06' }), F('C', { van: '25-06' })] }),
    check: count(3, 'A heeft 3 bezoeken; B en C passen bij het eerste en laatste')
  },
  {
    type: 'plan', regel: 1, naam: 'Minimum (gulzig-valkuil): A juni, B 1–10 juni, C 20–30 juni, D 2× (15 d) → 2 veldbezoeken',
    verwacht: '2 veldbezoeken (B+D1+A begin juni, C+D2 eind juni)',
    scenario: scen({ fns: [F('A'), F('B', { tot: '10-06' }), F('C', { van: '20-06' }), F('D', { bezoeken: 2, tussen: 15 })] }),
    check: count(2, 'B en C sluiten elkaar uit, D heeft 2 bezoeken; A past bij een van beide')
  },
  {
    type: 'plan', regel: 1, naam: 'Minimum: 2× schemer + 2× overdag (1 bezoek elk, juni) → 2 veldbezoeken',
    verwacht: '2 veldbezoeken (schemerpaar, dagpaar); nooit schemer met overdag',
    scenario: scen({
      fns: [F('S1', { tijdstip: SCHEMER, duur: 0 }), F('S2', { tijdstip: SCHEMER, duur: 0 }), F('O1', { tijdstip: 'overdag', duur: 2 }), F('O2', { tijdstip: 'overdag', duur: 2 })],
      incompatibel: [['t-S1', 't-O1'], ['t-S1', 't-O2'], ['t-S2', 't-O1'], ['t-S2', 't-O2']]
    }),
    check: count(2, 'twee tijdclusters')
  },
  {
    type: 'plan', regel: 1, naam: 'Minimum: A(2×, 20 d) + B(2×, 5 d) in juni → 2 veldbezoeken',
    verwacht: '2 veldbezoeken; B liftt mee met A',
    scenario: scen({ fns: [F('A', { bezoeken: 2, tussen: 20 }), F('B', { bezoeken: 2, tussen: 5 })] }),
    check: count(2, 'B past bij beide bezoeken van A')
  },

  // ======================= Regel 2: alleen paarsgewijs combineerbaar =======================
  {
    type: 'plan', regel: 2, naam: 'Keten tijdstip: 18–19 ~ 20–21 ~ 22–23 uur → A en C nooit samen, 2 veldbezoeken',
    verwacht: 'geen veldbezoek met A+C (5 uur > 4 uur); minimum 2',
    scenario: scen({
      fns: [F('A', { tijdstip: '18:00 - 19:00', duur: 1 }), F('B', { tijdstip: '20:00 - 21:00', duur: 1 }), F('C', { tijdstip: '22:00 - 23:00', duur: 1 })],
      incompatibel: [['t-A', 't-C']]
    }),
    check: count(2, 'A+B en C, of A en B+C')
  },
  {
    type: 'plan', regel: 2, naam: 'Keten datum: A 1–20 mei ~ B 15 mei–10 juni ~ C 5–30 juni → A en C nooit samen',
    verwacht: 'geen veldbezoek met A+C; minimum 2',
    scenario: scen({ fns: [F('A', { van: '01-05', tot: '20-05' }), F('B', { van: '15-05', tot: '10-06' }), F('C', { van: '05-06' })], incompatibel: [['t-A', 't-C']] }),
    check: count(2, 'A+B en C, of A en B+C')
  },

  // ======================= Regel 3: combineren op datum en tijdstip =======================
  {
    type: 'plan', regel: 3, naam: 'Gierzwaluw (schemer) en boomkikker zomerbiotoop (10–14 uur) nooit in één veldbezoek',
    verwacht: '2 + 5 = 7 veldbezoeken, geen combinatie (combineren tussen groepen aan)',
    scenario: scen({ lib: [L.gzKlein, L.bkZomer], combiAlles: true, incompatibel: [[L.gzKlein, L.bkZomer]] }),
    check: count(7, 'tijdstippen sluiten elkaar uit')
  },
  {
    type: 'plan', regel: 3, naam: 'Boomkikker voortplanting (½ u na zonsondergang–middernacht) + alpenwatersalamander (zonsondergang–middernacht) → 3',
    verwacht: '3 veldbezoeken: alle 2 salamanderbezoeken liften mee met de 3 boomkikkerbezoeken',
    scenario: scen({ lib: [L.bkVoort, L.alpen] }),
    check: count(3, 'avondvensters overlappen, datumvensters ook')
  },
  {
    type: 'plan', regel: 3, naam: 'Geen overlap in datum (april vs juni) → niet combineren',
    verwacht: '2 veldbezoeken',
    scenario: scen({ fns: [F('A', { van: '01-04', tot: '30-04' }), F('B')], incompatibel: [['t-A', 't-B']] }),
    check: count(2, 'vensters overlappen niet')
  },
  {
    type: 'plan', regel: 3, naam: 'Twee functies 10:00–14:00 in hetzelfde venster → 1 veldbezoek',
    verwacht: '1 veldbezoek',
    scenario: scen({ fns: [F('A', { tijdstip: DAG1014, duur: 0, van: '01-07', tot: '31-07' }), F('B', { tijdstip: DAG1014, duur: 0, van: '01-07', tot: '31-07' })] }),
    check: count(1, 'zelfde dagvenster')
  },
  {
    type: 'plan', regel: 3, naam: 'Ochtendbezoek, schemerbezoek en nachtbezoek (juni) → 2, ochtend nooit met schemer',
    verwacht: '2 veldbezoeken; ochtend + schemer nooit samen',
    scenario: scen({ fns: [F('M', { tijdstip: OCHTEND, duur: 2 }), F('K', { tijdstip: SCHEMER, duur: 0 }), F('N')], incompatibel: [['t-M', 't-K']] }),
    check: count(2, 'ochtend en schemer liggen te ver uit elkaar')
  },
  {
    type: 'plan', regel: 3, naam: 'Tijdcombinatie hangt af van de datum: 18:00–19:00 + schemer (mrt–jun) alleen vóór ca. half mei',
    verwacht: '1 veldbezoek, uiterste datum ≤ 2027-05-22: van 18:00 tot 30 min na zonsondergang ≤ 4 uur kan alleen zolang zonsondergang ≤ ca. 21:30 (± 15 min). (Schemer hier met cijfers geschreven, zodat de test los staat van het "een half uur"-parseerprobleem.)',
    scenario: scen({ fns: [F('A', { van: '01-03', tijdstip: '18:00 - 19:00', duur: 1 }), F('B', { van: '01-03', tijdstip: '1 uur voor zonsondergang tot 30 min na zonsondergang', duur: 0 })] }),
    check: all(count(1, 'combineerbaar in maart–begin mei'),
      r => r.rounds.filter(x => x.members.length > 1 && x.lf > '2027-05-22').map(x => ({ regel: 3, msg: `gecombineerd bezoek loopt tot ${x.lf}; dan is zonsondergang + 30 min − 18:00 > 4 uur` })))
  },
  {
    type: 'plan', regel: 3, naam: 'Suboptimaal UIT:A ideaal juni (sub 15 mei–15 juli) + B juli → 2, A in juni',
    verwacht: '2 veldbezoeken, A binnen de ideale periode',
    scenario: scen({ fns: [F('A', { vanSub: '15-05', totSub: '15-07' }), F('B', { van: '01-07', tot: '31-07' })], idealOnly: ['t-A'] }),
    check: count(2, 'zonder suboptimale periode overlappen A en B niet')
  },
  {
    type: 'plan', regel: 3, naam: 'Suboptimaal AAN: zelfde situatie → 1 veldbezoek (1–15 juli)',
    verwacht: '1 veldbezoek tussen 1 en 15 juli (handleiding: suboptimaal benutten als dat veldbezoeken bespaart)',
    scenario: scen({ fns: [F('A', { vanSub: '15-05', totSub: '15-07' }), F('B', { van: '01-07', tot: '31-07' })], combiSub: true }),
    check: all(count(1, 'A suboptimaal begin juli samen met B'), r => within(r, 't-A', '2027-07-01', '2027-07-15', 3))
  },

  // ======================= Regel 4: tussenperiode =======================
  {
    type: 'plan', regel: 4, naam: 'Tussenperiode: 3 bezoeken, min. 14 dagen, juni–juli',
    verwacht: '3 veldbezoeken, onderling ≥ 14 dagen (vroegste én uiterste data)',
    scenario: scen({ fns: [F('A', { tot: '31-07', bezoeken: 3, tussen: 14 })], strictSpacing: ['t-A'] }),
    check: count(3, '3 bezoeken van één functie')
  },
  {
    type: 'plan', regel: 4, naam: 'Suboptimale tussenperiode: 3× in juni, tussen 20 (sub 10) → wel planbaar, ≥ 10 dagen',
    verwacht: '3 veldbezoeken in juni met ≥ 10 dagen ertussen, geen probleemmelding (20 dagen past niet in 30 dagen)',
    scenario: scen({ fns: [F('A', { bezoeken: 3, tussen: 20, tussenSub: 10 })] }),
    check: all(count(3, '3 bezoeken'), r => r.problems.length ? [{ regel: 4, msg: 'onverwachte probleemmelding: ' + r.problems.join(' / ') }] : [], r => within(r, 't-A', '2027-06-01', '2027-06-30', 4))
  },

  // ======================= Regel 5: jaargrens in het plan =======================
  {
    type: 'plan', regel: 5, naam: 'Jaargrens: 01-12 t/m 01-03, 2× (20 d), vandaag 25-11-2026',
    verwacht: 'beide bezoeken tussen 2026-12-01 en 2027-03-01',
    scenario: scen({ today: '2026-11-25', fns: [F('A', { van: '01-12', tot: '01-03', bezoeken: 2, tussen: 20, tijdstip: 'overdag' })], strictSpacing: ['t-A'] }),
    check: all(count(2, '2 bezoeken'), r => within(r, 't-A', '2026-12-01', '2027-03-01', 5))
  },
  {
    type: 'plan', regel: 5, naam: 'Jaargrens: 01-12 t/m 01-03, 2× (20 d), vandaag 10-01-2027 → nog dit seizoen',
    verwacht: 'beide bezoeken tussen 2027-01-10 en 2027-03-01 (lopend seizoen, niet pas volgende december)',
    scenario: scen({ today: '2027-01-10', fns: [F('A', { van: '01-12', tot: '01-03', bezoeken: 2, tussen: 20, tijdstip: 'overdag' })], strictSpacing: ['t-A'] }),
    check: all(count(2, '2 bezoeken'), r => within(r, 't-A', '2027-01-10', '2027-03-01', 5))
  },
  {
    type: 'plan', regel: 5, naam: 'Das (01-09 t/m 31-05, 3 bezoeken), vandaag 25-11-2026 → dit seizoen, ideale periode',
    verwacht: '3 veldbezoeken tussen 2026-11-25 en 2027-05-31',
    scenario: scen({ today: '2026-11-25', lib: [L.das], idealOnly: [L.das] }),
    check: all(count(3, '3 bezoeken'), r => within(r, L.das, '2026-11-25', '2027-05-31', 5))
  },
  {
    type: 'plan', regel: 6, naam: 'Deelbezoek over de jaargrens: venster 01-11 t/m 28-02, 1× in 15-12 t/m 15-01',
    verwacht: '2 veldbezoeken in 2026-11-01…2027-02-28, waarvan 1 volledig in 15-12-2026…15-01-2027',
    scenario: scen({ today: '2026-10-01', fns: [F('A', { van: '01-11', tot: '28-02', bezoeken: 2, tussen: 14, tijdstip: 'overdag', deelbezoeken: [{ aantal: 1, van: '15-12', tot: '15-01', tijdstip: '' }] })] }),
    check: all(count(2, '2 bezoeken'), r => within(r, 't-A', '2026-11-01', '2027-02-28', 5))
  },

  // ======================= Regel 6: deelbezoeken =======================
  {
    type: 'plan', regel: 6, naam: 'Deelbezoek: 2× (20 d) in 15-05 t/m 15-07, waarvan 1 in juni',
    verwacht: '2 veldbezoeken, één volledig in juni',
    scenario: scen({ fns: [F('A', { van: '15-05', tot: '15-07', bezoeken: 2, tussen: 20, deelbezoeken: [{ aantal: 1, van: '01-06', tot: '30-06', tijdstip: '' }] })] }),
    check: count(2, '2 bezoeken')
  },
  {
    type: 'plan', regel: 6, naam: 'Boomkikker zomerbiotoop: 5 bezoeken, 1 in juli, 1 in 16–31 aug, 1 in 1–15 sep',
    verwacht: '5 veldbezoeken tussen 1 juli en 15 sept, deelvensters gevuld',
    scenario: scen({ lib: [L.bkZomer] }),
    check: all(count(5, '5 bezoeken, één functie'), r => within(r, L.bkZomer, '2027-07-01', '2027-09-15', 6))
  },
  {
    // Bijgewerkt 25-11-2026 na bibliotheek v72: zomerverblijfplaats heeft nu 1 verplicht ochtendbezoek
    // (deelbezoek 15-05…15-07, "ochtend: tot 0 min voor zonsopkomst"). Dat kan niet samen met het
    // schemerbezoek van de gierzwaluw, dus is er één veldbezoek meer nodig dan in de oude data (was 2).
    type: 'plan', regel: 6, naam: 'Gewone dwergvleermuis kraam + zomerverblijf + gierzwaluw (klein), alles combineren → 3',
    verwacht: '3 veldbezoeken: 2 avondbezoeken met gierzwaluw (1× in 1–15 juli) + 1 ochtendbezoek zomerverblijf; kraam 1× in juni',
    scenario: scen({ lib: [L.kraam, L.zomer, L.gzKlein], combiAlles: true }),
    check: all(count(3, '2× gierzwaluw (schemer) + 1 verplicht ochtendbezoek zomerverblijf dat niet met schemer kan'),
      r => of(r, L.gzKlein).length === 2 ? [] : [{ regel: 6, msg: `gierzwaluw: verwacht in 2 veldbezoeken, app ${of(r, L.gzKlein).length}` }])
  },
  {
    type: 'plan', regel: 1, naam: 'Zelfde set zonder "combineren tussen groepen" → 2 (vleermuizen) + 2 (vogels) = 4',
    verwacht: '4 veldbezoeken',
    scenario: scen({ lib: [L.kraam, L.zomer, L.gzKlein] }),
    check: all(count(4, 'vleermuizen en vogels zijn aparte combinatiegroepen (handleiding)'),
      r => r.rounds.filter(x => x.members.some(m => m.fid === L.gzKlein) && x.members.some(m => m.fid !== L.gzKlein)).map(() => ({ regel: 3, msg: 'gierzwaluw gecombineerd met andere groep terwijl dat uit staat' })))
  },

  // ======================= Regel 7: alternatieven =======================
  {
    type: 'plan', regel: 7, naam: 'Beide gierzwaluw-alternatieven (Omvang plangebied) geselecteerd → melding alternatieven',
    verwacht: 'een melding dat de functies alternatieven voor elkaar zijn',
    scenario: scen({ lib: [L.gzKlein, L.gzGroot] }),
    check: r => r.notes.some(n => /alternatieven/i.test(n)) ? [] : ['geen melding over alternatieven; meldingen: ' + JSON.stringify(r.notes)]
  },
  {
    type: 'plan', regel: 7, naam: 'Eén gierzwaluw-alternatief geselecteerd → geen melding dat het andere ontbreekt, 2 bezoeken',
    verwacht: '2 veldbezoeken, geen alternatief-/ontbreekt-melding',
    scenario: scen({ lib: [L.gzKlein] }),
    check: all(count(2, '2 bezoeken'), r => r.notes.filter(n => /alternatie|hoort altijd/i.test(n)).map(n => 'onverwachte melding: ' + n))
  },

  // ======================= Regel 8: statussen, startdatum en deadline =======================
  {
    type: 'plan', regel: 8, naam: 'Uitgevoerd bezoek telt niet meer mee; volgend bezoek ≥ 10 dagen erna',
    verwacht: '2 veldbezoeken, eerste op of na 2027-06-20 (uitgevoerd 2027-06-10, tussen 10)',
    scenario: scen({ today: '2027-06-15', fns: [F('A', { tot: '31-07', bezoeken: 3, tussen: 10 })], visits: { 't-A#0': { status: 'uitgevoerd', datum: '2027-06-10' } }, strictSpacing: ['t-A'] }),
    check: all(count(2, '3 − 1 uitgevoerd'), r => within(r, 't-A', '2027-06-20', '2027-07-31', 8))
  },
  {
    type: 'plan', regel: 8, naam: 'Vervallen bezoek wordt niet opnieuw gepland',
    verwacht: '2 veldbezoeken (3 − 1 vervallen)',
    scenario: scen({ fns: [F('A', { tot: '31-07', bezoeken: 3, tussen: 10 })], visits: { 't-A#1': { status: 'vervallen', datum: '' } } }),
    check: count(2, '3 − 1 vervallen')
  },
  {
    type: 'plan', regel: 8, naam: 'Alle bezoeken uitgevoerd → geen veldbezoeken meer',
    verwacht: '0 veldbezoeken, melding dat alles is uitgevoerd',
    scenario: scen({ today: '2027-06-25', fns: [F('A', { bezoeken: 2, tussen: 5 })], visits: { 't-A#0': { status: 'uitgevoerd', datum: '2027-06-05' }, 't-A#1': { status: 'uitgevoerd', datum: '2027-06-15' } } }),
    check: all(count(0, 'niets meer te doen'), r => /uitgevoerd of vervallen/.test(r.text) ? [] : ['geen melding "alle bezoeken uitgevoerd"'])
  },
  {
    type: 'plan', regel: 8, naam: 'Gepland bezoek met datum ligt vast; tweede bezoek ≥ 14 dagen later',
    verwacht: 'veldbezoek precies op 2027-06-05 met A; ander A-bezoek ≥ 2027-06-19; B combineert → 2 veldbezoeken',
    scenario: scen({ today: '2027-05-01', fns: [F('A', { bezoeken: 2, tussen: 14 }), F('B')], visits: { 't-A#0': { status: 'gepland', datum: '2027-06-05' } }, strictSpacing: ['t-A'] }),
    check: all(count(2, 'A2 heeft 2 bezoeken, B past bij een ervan'),
      r => of(r, 't-A').some(x => x.es === '2027-06-05' && x.lf === '2027-06-05') ? [] : [{ regel: 8, msg: 'geen veldbezoek vast op 2027-06-05: ' + of(r, 't-A').map(x => x.es + '…' + x.lf).join(', ') }])
  },
  {
    type: 'plan', regel: 8, naam: 'Deadline vóór het venster → probleemmelding, niets ingepland',
    verwacht: 'probleemmelding voor Testsoort A; geen veldbezoek voor A',
    scenario: scen({ fns: [F('A')], deadline: '2027-04-01' }),
    check: r => [].concat(r.problems.some(p => p.includes('Testsoort A')) ? [] : ['geen probleemmelding: ' + JSON.stringify(r.problems)], of(r, 't-A').length ? [`${of(r, 't-A').length} veldbezoek(en) toch ingepland`] : [])
  },
  {
    type: 'plan', regel: 8, naam: 'Deadline te vroeg voor alle bezoeken (3× 14 d, alleen 1–20 mei) → probleemmelding',
    verwacht: 'probleemmelding; geen veldbezoek na de deadline 2027-05-20',
    scenario: scen({ today: '2027-04-01', fns: [F('A', { van: '01-05', bezoeken: 3, tussen: 14 })], deadline: '2027-05-20' }),
    check: r => r.problems.some(p => p.includes('Testsoort A')) ? [] : ['geen probleemmelding: ' + JSON.stringify(r.problems)]
  },
  {
    type: 'plan', regel: 8, naam: 'Haalbare deadline midden in het venster → alles vóór de deadline',
    verwacht: '1 veldbezoek met uiterste datum ≤ 2027-06-20',
    scenario: scen({ fns: [F('A'), F('B')], deadline: '2027-06-20' }),
    check: count(1, 'combineerbaar, past vóór de deadline')
  },
  {
    type: 'plan', regel: 8, naam: '"Plannen vanaf" 15-06: geen bezoeken eerder',
    verwacht: '2 veldbezoeken, allebei op of na 2027-06-15',
    scenario: scen({ fns: [F('A', { bezoeken: 2, tussen: 7 })], planVanaf: '2027-06-15' }),
    check: all(count(2, '2 bezoeken'), r => within(r, 't-A', '2027-06-15', '2027-06-30', 8))
  },
];
