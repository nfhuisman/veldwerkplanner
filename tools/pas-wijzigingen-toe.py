#!/usr/bin/env python3
"""Past een wijzigingslijst (JSON) toe op de protocolbibliotheek in een Veldwerkplanner-HTML-bestand.

Gebruik:  python3 tools/pas-wijzigingen-toe.py <index.html of adminversie.html> <wijzigingen.json> [--droog]

- perFunctie: per functie-id de velden in 'wijzig' overschrijven. Speciaal veld 'deelbezoekTijdstip':
  {oude tekst: nieuwe tekst} voor het tijdstip van deelbezoeken. 'voorwaardenToevoegen' wordt achter de
  voorwaarden gezet.
- perFormulering: elke functie waarvan 'tijdstip' precies 'tijdstipIs' is, krijgt 'wordt'.
- Bij elke tijdstipwijziging (behalve van het kale 'overdag') komt de oorspronkelijke tekst in de voorwaarden:
  "Oorspronkelijke tijdsaanduiding protocol: '…'." Zo gaat geen informatie uit het protocol verloren.
- Het script stopt met een foutmelding als een functie-id niet bestaat of de bibliotheek niet terug te schrijven is
  in exact dezelfde opmaak. Met --droog wordt alleen gemeld wat er zou veranderen.
"""
import json, re, sys

RE_LIB = re.compile(r'(<script type="application/json" id="default-lib">)([\s\S]*?)(</script>)')


def dump(lib):
    return json.dumps(lib, ensure_ascii=False, separators=(',', ':'))


def bewaar_origineel(f, oud):
    if oud and oud != 'overdag':
        zin = f"Oorspronkelijke tijdsaanduiding protocol: '{oud}'."
        if zin not in (f.get('voorwaarden') or ''):
            f['voorwaarden'] = ((f.get('voorwaarden') or '').rstrip() + ' ' + zin).strip()


def main():
    pad, wpad = sys.argv[1], sys.argv[2]
    droog = '--droog' in sys.argv
    html = open(pad, encoding='utf-8').read()
    m = RE_LIB.search(html)
    if not m:
        sys.exit('Bibliotheek (script id="default-lib") niet gevonden.')
    lib = json.loads(m.group(2))
    if dump(lib) != m.group(2):
        sys.exit('Let op: de bibliotheek is niet in dezelfde opmaak terug te schrijven; script gestopt zonder wijzigingen.')
    w = json.load(open(wpad, encoding='utf-8'))
    perid = {f['id']: f for s in lib['soorten'] for f in s['functies']}
    log = []

    for item in w.get('perFunctie', []):
        f = perid.get(item['id'])
        if not f:
            sys.exit(f"Functie-id niet gevonden: {item['id']}")
        for k, v in item['wijzig'].items():
            if k == 'deelbezoekTijdstip':
                for d in f.get('deelbezoeken', []):
                    if d.get('tijdstip') in v:
                        log.append(f"{f['id']} deelbezoek {d['van']}-{d['tot']}: tijdstip -> {v[d['tijdstip']]}")
                        d['tijdstip'] = v[d['tijdstip']]
                continue
            oud = f.get(k)
            if k == 'tijdstip' and oud != v:
                bewaar_origineel(f, oud)
            if oud != v:
                log.append(f"{f['id']}: {k} gewijzigd")
            f[k] = v
        if item.get('voorwaardenToevoegen') and item['voorwaardenToevoegen'] not in (f.get('voorwaarden') or ''):
            f['voorwaarden'] = ((f.get('voorwaarden') or '').rstrip() + ' ' + item['voorwaardenToevoegen']).strip()
            log.append(f"{f['id']}: voorwaarden aangevuld")

    for item in w.get('perFormulering', []):
        n = 0
        for f in perid.values():
            if f.get('tijdstip') == item['tijdstipIs']:
                bewaar_origineel(f, f['tijdstip'])
                f['tijdstip'] = item['wordt']
                n += 1
        log.append(f"'{item['tijdstipIs']}' -> '{item['wordt']}': {n} functies")

    print('\n'.join(log))
    if droog:
        print('\n(droog: niets weggeschreven)')
        return
    nieuw = html[:m.start(2)] + dump(lib) + html[m.end(2):]
    open(pad, 'w', encoding='utf-8').write(nieuw)
    print(f'\nWeggeschreven naar {pad}')


if __name__ == '__main__':
    main()
