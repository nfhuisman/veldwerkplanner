# Testsuite combinatie- en planningslogica

Onafhankelijke, herhaalbare tests voor het veldbezoekplan van de Veldwerkplanner. De verwachte uitkomsten
zijn afgeleid uit de regels van de eigenaar (1–9 hieronder), de protocoldata en de handleiding — niet uit
wat de app op dit moment teruggeeft. Een FAIL betekent dus: de app wijkt af van de regel.

## Uitvoeren

```
node tests/run.mjs              # alle tests
node tests/run.mjs boomkikker   # alleen tests waarvan de naam 'boomkikker' bevat
```

Nodig: Node 18+ en Playwright met Chrome (`/usr/bin/google-chrome`, of zet `CHROME_PATH`). Geen netwerk nodig.
De test opent `index.html` via `file://` in headless Chrome met een vaste datum ("vandaag") per test en
tijdzone Europe/Amsterdam. `index.html` wordt niet gewijzigd. Uitvoer: PASS/FAIL per test, bij FAIL de regel,
de verwachting en wat de app gaf. Exitcode 1 bij een of meer FAILs. Details van de laatste run staan in
`tests/laatste-resultaat.json`.

## Wat wordt getest

| Regel | Onderwerp | Voorbeelden |
|---|---|---|
| 1 | zo min mogelijk veldbezoeken | kleine sets waarvan het minimum met de hand is uitgerekend |
| 2 | alleen paarsgewijs combineerbare functies samen | keten A~B, B~C, A≁C (op tijdstip en op datum) |
| 3 | datum- en tijdstipoverlap, tijdteksten begrijpen | "60 min na zonsondergang", "een half uur", "middernacht", "0:00 - 2:00", "10:00-14:00", ochtendbezoek |
| 4 | minimale tussenperiode (en suboptimale tussenperiode) | vroegste én uiterste data van het plan |
| 5 | vensters over de jaargrens | 01-12 t/m 01-03, das 01-09 t/m 31-05 |
| 6 | deelbezoeken | 1 bezoek in juni, boomkikker zomerbiotoop, deelvenster over de jaargrens |
| 7 | alternatieven (alternatiefGroep) | melding bij beide gekozen, geen melding bij één |
| 8 | statussen, startdatum, deadline | uitgevoerd, vervallen, gepland met datum, deadline te vroeg, "plannen vanaf" |
| 9 | zon-berekening (alleen grove controle, ±15 min) | zonsondergang dec ca. 16:30, eind juni ca. 22:00 |

Weer, seizoensdrukte en exacte zonsondergangstabellen worden bewust niet getest.

Naast de eigen controle van elk plan-geval controleert `run.mjs` bij **elk** plan automatisch:
datums binnen het venster van elke functie, niet vóór vandaag/"plannen vanaf" en niet na de deadline,
het juiste aantal bezoeken per functie (min uitgevoerd/vervallen), de tussenperiode, de deelbezoeken,
geen functie twee keer in één veldbezoek en de opgegeven onverenigbare paren.

## Bestanden

- `run.mjs` — laadt de app, draait de gevallen, algemene controles, rapport.
- `cases.mjs` — de testgevallen (naam in het Nederlands, regelnummer, invoer, verwachting met reden).

## Een geval toevoegen

Voeg in `cases.mjs` een object toe aan de lijst `cases`. Voor een planningsgeval:

```js
{
  type: 'plan', regel: 1, naam: 'Korte Nederlandse naam',
  verwacht: 'wat er moet uitkomen en waarom',
  scenario: scen({
    today: '2027-01-15',                       // 'vandaag' voor de app
    fns: [F('A', { bezoeken: 2, tussen: 20 }),  // synthetische functies (standaard: juni, nacht, 2 uur)
          F('B', { tijdstip: 'overdag' })],
    lib: ['sp-boomkikker--voortplantingsbiotoop'], // echte functies uit de bibliotheek (id)
    // optioneel: deadline, planVanaf, combiAlles, combiSub, maxLen, visits: {'t-A#0': {status:'uitgevoerd', datum:'2027-06-10'}},
    // incompatibel: [['t-A','t-B']], idealOnly: ['t-A'], strictSpacing: ['t-A']
  }),
  check: count(2, 'reden')   // of een eigen functie (res, H) => [foutmeldingen]
}
```

Leid de verwachting altijd af uit de regel of het protocol. Pas een test niet aan omdat de app iets anders
teruggeeft; alleen als de verwachting zelf in strijd blijkt met de regels of de protocoldata.
