// Berekeningen zonder scherm of opslag, zodat ze los te testen zijn.
// Bedragen zijn hele centen, kilometers hele kilometers.

const overlap = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/** Verdeelt `totaal` centen naar verhouding van `gewichten`; de som klopt altijd precies. */
export function verdeelCenten(totaal, gewichten) {
  const som = gewichten.reduce((s, g) => s + g, 0);
  if (!gewichten.length) return [];
  const basis = som > 0 ? gewichten : gewichten.map(() => 1);
  const noemer = som > 0 ? som : gewichten.length;
  const ruw = basis.map((g) => (totaal * g) / noemer);
  const delen = ruw.map(Math.floor);
  let rest = totaal - delen.reduce((s, d) => s + d, 0);
  ruw
    .map((r, i) => ({ i, over: r - Math.floor(r) }))
    .sort((a, b) => b.over - a.over || a.i - b.i)
    .forEach(({ i }) => {
      if (rest > 0) { delen[i] += 1; rest -= 1; }
    });
  return delen;
}

const opDatum = (a, b) => (a.datum < b.datum ? -1 : a.datum > b.datum ? 1 : 0);

function sorteerTankbeurten(tankbeurten) {
  return [...tankbeurten].sort((a, b) => opDatum(a, b)
    || (a.km_stand ?? Infinity) - (b.km_stand ?? Infinity)
    || String(a.aangemaakt_op ?? '').localeCompare(String(b.aangemaakt_op ?? '')));
}

/** Kilometers per persoon binnen het stuk [van, tot] van de kilometerteller. */
function kmPerPersoon(ritten, van, tot) {
  const per = new Map();
  ritten.forEach((r) => {
    const km = overlap(r.begin_km, r.eind_km, van, tot);
    if (km > 0) per.set(r.persoon_id, (per.get(r.persoon_id) ?? 0) + km);
  });
  return per;
}

/**
 * Deelt de ritten op in periodes tussen tankbeurten. Een tankbeurt betaalt de
 * kilometers sinds de vorige tankbeurt. Kilometers die niemand heeft vastgelegd
 * (het verschil met de opgegeven kilometerstand) worden naar verhouding over de
 * bestuurders van die periode verdeeld. Een rit die over een tankbeurt heen loopt,
 * telt in beide periodes mee voor het deel dat erin valt.
 */
export function berekenPeriodes(ritten, tankbeurten, personen = []) {
  const gesorteerd = sorteerTankbeurten(tankbeurten);
  const minBegin = ritten.length ? Math.min(...ritten.map((r) => r.begin_km)) : null;
  const periodes = [];
  let vorige = null;

  for (const t of gesorteerd) {
    const waarschuwingen = [];
    const ondergrens = vorige ?? -Infinity;
    const eindenTotDatum = ritten.filter((r) => r.datum <= t.datum && r.eind_km > ondergrens).map((r) => r.eind_km);
    let eind = t.km_stand ?? (eindenTotDatum.length ? Math.max(...eindenTotDatum) : vorige ?? minBegin ?? 0);
    if (vorige !== null && eind < vorige) {
      waarschuwingen.push(`De kilometerstand is lager dan bij de vorige tankbeurt (${vorige}).`);
      eind = vorige;
    }
    let begin = vorige;
    if (begin === null) {
      const begins = ritten.filter((r) => r.begin_km < eind).map((r) => r.begin_km);
      begin = begins.length ? Math.min(...begins) : eind;
    }

    const per = kmPerPersoon(ritten, begin, eind);
    const geregistreerd = [...per.values()].reduce((s, k) => s + k, 0);
    const totaal = eind - begin;
    const gat = totaal - geregistreerd;
    if (gat < 0) waarschuwingen.push(`Er zijn ${-gat} km dubbel geregistreerd in deze periode.`);

    let ids = [...per.keys()];
    let gewichten = ids.map((id) => per.get(id));
    if (!ids.length) {
      ids = personen.filter((p) => p.actief !== false).map((p) => p.id);
      gewichten = ids.map(() => 1);
      if (ids.length) waarschuwingen.push('Geen ritten in deze periode: het bedrag is gelijk verdeeld.');
    }
    const aandelen = verdeelCenten(t.bedrag_cent, gewichten);
    const verdeling = ids.map((id, i) => {
      const km = per.get(id) ?? 0;
      const extra = gat > 0 && geregistreerd > 0 ? (gat * km) / geregistreerd : 0;
      return { persoon_id: id, km, extraKm: extra, bedrag_cent: aandelen[i] };
    }).sort((a, b) => b.bedrag_cent - a.bedrag_cent);

    const kmVoorPrijs = Math.max(totaal, geregistreerd);
    periodes.push({
      tankbeurt: t,
      beginKm: begin,
      eindKm: eind,
      geregistreerdKm: geregistreerd,
      totaalKm: totaal,
      ongeregistreerdKm: Math.max(0, gat),
      prijsPerKmCent: kmVoorPrijs > 0 ? t.bedrag_cent / kmVoorPrijs : null,
      verdeling,
      waarschuwingen,
    });
    vorige = eind;
  }

  // Lopende periode: wat er sinds de laatste tankbeurt is gereden.
  const openBegin = vorige ?? minBegin;
  const openEinden = ritten.map((r) => r.eind_km);
  const openEind = openEinden.length ? Math.max(...openEinden, openBegin ?? 0) : openBegin;
  const openPer = openBegin === null ? new Map() : kmPerPersoon(ritten, openBegin, openEind);
  const laatstePrijs = [...periodes].reverse().find((p) => p.prijsPerKmCent)?.prijsPerKmCent ?? null;
  const openKm = [...openPer.values()].reduce((s, k) => s + k, 0);
  const lopend = {
    beginKm: openBegin,
    eindKm: openEind,
    geregistreerdKm: openKm,
    ongeregistreerdKm: openBegin === null ? 0 : Math.max(0, openEind - openBegin - openKm),
    prijsPerKmCent: laatstePrijs,
    verdeling: [...openPer.entries()]
      .map(([persoon_id, km]) => ({
        persoon_id, km, schattingCent: laatstePrijs ? Math.round(km * laatstePrijs) : null,
      }))
      .sort((a, b) => b.km - a.km),
  };

  return { periodes, lopend };
}

/** Hoogste bekende kilometerstand uit ritten en tankbeurten. */
export function laatsteStand(ritten, tankbeurten) {
  const standen = [...ritten.map((r) => r.eind_km), ...tankbeurten.map((t) => t.km_stand).filter((k) => k != null)];
  return standen.length ? Math.max(...standen) : null;
}

/**
 * Saldo per persoon: positief = krijgt geld terug, negatief = moet nog betalen.
 * Betaald voor tanken telt mee, het eigen aandeel gaat eraf, onderlinge betalingen verschuiven het saldo.
 */
export function saldi(personen, periodes, betalingen) {
  const saldo = new Map(personen.map((p) => [p.id, 0]));
  const plus = (id, c) => saldo.set(id, (saldo.get(id) ?? 0) + c);
  periodes.forEach((p) => {
    plus(p.tankbeurt.betaald_door, p.tankbeurt.bedrag_cent);
    p.verdeling.forEach((v) => plus(v.persoon_id, -v.bedrag_cent));
  });
  betalingen.forEach((b) => {
    plus(b.van_persoon, b.bedrag_cent);
    plus(b.naar_persoon, -b.bedrag_cent);
  });
  return saldo;
}

/** Zo min mogelijk overboekingen om alle saldi op nul te krijgen. */
export function overboekingen(saldo) {
  const schuld = [...saldo].filter(([, c]) => c < 0).map(([id, c]) => ({ id, c: -c })).sort((a, b) => b.c - a.c);
  const tegoed = [...saldo].filter(([, c]) => c > 0).map(([id, c]) => ({ id, c })).sort((a, b) => b.c - a.c);
  const lijst = [];
  let i = 0;
  let j = 0;
  while (i < schuld.length && j < tegoed.length) {
    const bedrag = Math.min(schuld[i].c, tegoed[j].c);
    if (bedrag > 0) lijst.push({ van: schuld[i].id, naar: tegoed[j].id, bedrag_cent: bedrag });
    schuld[i].c -= bedrag;
    tegoed[j].c -= bedrag;
    if (schuld[i].c === 0) i += 1;
    if (tegoed[j].c === 0) j += 1;
  }
  return lijst;
}

/**
 * Kiest uit gelezen getallen de meest waarschijnlijke kilometerstand:
 * het kleinste getal dat niet onder de vorige stand ligt, anders het grootste.
 */
export function kiesStand(getallen, vorigeStand) {
  const kandidaten = [...new Set(getallen.filter((g) => Number.isInteger(g) && g >= 10))];
  if (!kandidaten.length) return null;
  if (vorigeStand != null) {
    const passend = kandidaten.filter((g) => g >= vorigeStand && g - vorigeStand < 5000).sort((a, b) => a - b);
    if (passend.length) return passend[0];
  }
  return Math.max(...kandidaten);
}

export const euro = (cent, opties = {}) => new Intl.NumberFormat('nl-NL', {
  style: 'currency', currency: 'EUR', ...opties,
}).format((cent ?? 0) / 100);

export const km = (waarde) => `${new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 0 }).format(waarde ?? 0)} km`;

/** "12,50" of "12.50" of "€ 12,50" naar centen; null als het geen bedrag is. */
export function leesBedrag(tekst) {
  const schoon = String(tekst ?? '').replace(/[€\s]/g, '');
  if (!schoon) return null;
  const genormaliseerd = schoon.includes(',') ? schoon.replace(/\./g, '').replace(',', '.') : schoon;
  const getal = Number(genormaliseerd);
  return Number.isFinite(getal) && getal > 0 ? Math.round(getal * 100) : null;
}
