// Schermen en bediening van KilometerTracker.
import * as db from './data.js';
import {
  berekenPeriodes, laatsteStand, saldi, overboekingen, euro, km, leesBedrag,
} from './logic.js';
import { leesKilometerstand } from './ocr.js';

const KLEUREN = ['#22d3ee', '#a78bfa', '#f472b6', '#fb923c', '#34d399', '#facc15', '#60a5fa', '#f87171'];
const SLEUTEL_AUTO = 'km-auto';
const SLEUTEL_THEMA = 'km-thema';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $('#view');
const nav = $('#nav');
const sheet = $('#sheet');
const camera = $('#camera');

const staat = {
  user: null, autos: [], autoId: null, data: null, tab: 'ritten', reken: null, saldo: null, stand: null,
  stopVolgen: null, alleRitten: false,
};

const opslag = {
  lees(k) { try { return localStorage.getItem(k); } catch { return null; } },
  zet(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* niet erg */ } },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const icoon = {
  sluit: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  bezig: '<svg viewBox="0 0 24 24"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
  weg: '<svg viewBox="0 0 24 24"><path d="M5 19 9 5M19 19 15 5M12 6v2M12 11v2M12 16v2"/></svg>',
  pomp: '<svg viewBox="0 0 24 24"><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2.5A1.5 1.5 0 0 1 18 9.5V16a1.5 1.5 0 0 0 3 0V8l-3-3"/></svg>',
  delen: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
  vink: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
};

/* ---------- hulpjes ---------- */

const vandaag = () => new Date().toLocaleDateString('sv-SE');
const datumTekst = (d, opties = { weekday: 'short', day: 'numeric', month: 'short' }) => {
  const dag = new Date(`${d}T12:00`);
  const verschil = Math.round((new Date(`${vandaag()}T12:00`) - dag) / 86400000);
  if (verschil === 0) return 'vandaag';
  if (verschil === 1) return 'gisteren';
  return new Intl.DateTimeFormat('nl-NL', opties).format(dag);
};
const getal = (n) => new Intl.NumberFormat('nl-NL').format(n);
const prijsKm = (cent) => (cent == null ? '–' : euro(cent, { minimumFractionDigits: 3, maximumFractionDigits: 3 }));
const initialen = (naam) => (naam ?? '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const personen = () => staat.data?.personen ?? [];
const actievePersonen = () => personen().filter((p) => p.actief);
const persoon = (id) => personen().find((p) => p.id === id) ?? { naam: 'Onbekend', kleur: '#94a3b8' };
const mij = () => personen().find((p) => p.user_id === staat.user?.id);
const avatar = (p) => `<span class="avatar" style="background:${esc(p.kleur)}">${esc(initialen(p.naam))}</span>`;
const stip = (p) => `<i class="stip" style="background:${esc(p.kleur)}"></i>`;

let toastTimer;
function toast(tekst) {
  const el = $('#toast');
  el.textContent = tekst;
  el.classList.add('zichtbaar');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('zichtbaar'), 2600);
}

async function bezig(knop, werk) {
  knop.disabled = true;
  try {
    return await werk();
  } finally {
    knop.disabled = false;
  }
}

/* ---------- opstarten ---------- */

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  view.innerHTML = '<div class="laden"></div>';
  staat.user = await db.huidigAccount();
  if (!staat.user) toonLogin();
  else await naAanmelden();
}

async function naAanmelden() {
  try {
    staat.autos = await db.mijnAutos();
  } catch (fout) {
    view.innerHTML = `<div class="leeg"><b>Geen verbinding</b>${esc(db.foutTekst(fout))}<p><button class="knop" id="opnieuw">Opnieuw</button></p></div>`;
    $('#opnieuw').onclick = naAanmelden;
    return;
  }
  const code = new URLSearchParams(location.search).get('code');
  const bewaard = opslag.lees(SLEUTEL_AUTO);
  if (!staat.autos.length || code) {
    toonOnboarding(code);
    return;
  }
  await kiesAuto(staat.autos.some((a) => a.id === bewaard) ? bewaard : staat.autos[0].id);
}

async function kiesAuto(id) {
  staat.autoId = id;
  opslag.zet(SLEUTEL_AUTO, id);
  staat.stopVolgen?.();
  await herlaad();
  try {
    staat.stopVolgen = await db.volgWijzigingen(id, () => {
      clearTimeout(kiesAuto.timer);
      kiesAuto.timer = setTimeout(herlaad, 500);
    });
  } catch { /* zonder live verversen werkt de app ook */ }
}

async function herlaad() {
  if (!staat.autoId) return;
  try {
    staat.data = await db.laadAuto(staat.autoId);
  } catch (fout) {
    if (!staat.data) {
      view.innerHTML = `<div class="leeg"><b>Laden lukte niet</b>${esc(db.foutTekst(fout))}<p><button class="knop" id="opnieuw">Opnieuw</button></p></div>`;
      $('#opnieuw').onclick = herlaad;
    }
    return;
  }
  const { ritten, tankbeurten, betalingen } = staat.data;
  staat.reken = berekenPeriodes(ritten, tankbeurten, personen());
  staat.saldo = saldi(personen(), staat.reken.periodes, betalingen);
  staat.stand = laatsteStand(ritten, tankbeurten);
  render();
}

/* ---------- inloggen ---------- */

function toonLogin(melding = '') {
  nav.hidden = true;
  let registreer = false;
  view.innerHTML = `
    <section class="welkom">
      <div>
        <img class="welkom-logo" src="icons/icon-192.png" alt="">
      </div>
      <div>
        <h1>KilometerTracker</h1>
        <p>Samen één auto. Kilometers bijhouden en tankbeurten eerlijk verdelen.</p>
      </div>
      <form class="kaart" id="login">
        <div class="tabs">
          <button type="button" data-modus="in" aria-pressed="true">Inloggen</button>
          <button type="button" data-modus="nieuw" aria-pressed="false">Account maken</button>
        </div>
        <label class="veld"><span>E-mailadres</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="veld"><span>Wachtwoord</span><input name="wachtwoord" type="password" autocomplete="current-password" minlength="6" required></label>
        <p class="fout" id="fout">${esc(melding)}</p>
        <button class="knop breed" id="verstuur">Inloggen</button>
      </form>
    </section>`;
  const form = $('#login');
  $$('.tabs button', form).forEach((b) => {
    b.onclick = () => {
      registreer = b.dataset.modus === 'nieuw';
      $$('.tabs button', form).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#verstuur').textContent = registreer ? 'Account maken' : 'Inloggen';
      form.wachtwoord.autocomplete = registreer ? 'new-password' : 'current-password';
    };
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    bezig($('#verstuur'), async () => {
      $('#fout').textContent = '';
      try {
        const email = form.email.value.trim();
        const user = registreer
          ? await db.registreren(email, form.wachtwoord.value)
          : await db.inloggen(email, form.wachtwoord.value);
        if (!user) {
          $('#fout').textContent = 'Check je mail en bevestig je account. Log daarna hier in.';
          return;
        }
        staat.user = user;
        await naAanmelden();
      } catch (fout) {
        $('#fout').textContent = db.foutTekst(fout);
      }
    });
  };
}

/* ---------- eerste keer: auto aanmaken of deelnemen ---------- */

function kleurKiezer(naam, gekozen) {
  return `<div class="kleuren">${KLEUREN.map((k) => `
    <label><input type="radio" name="${naam}" value="${k}" ${k === gekozen ? 'checked' : ''}><span style="background:${k}"></span></label>`).join('')}</div>`;
}

function toonOnboarding(code = '') {
  nav.hidden = true;
  const terug = staat.autos.length ? '<button class="knop zacht klein" id="terug">Terug</button>' : '';
  view.innerHTML = `
    <section class="welkom">
      <div class="kopregel">
        <div><h1>Welkom!</h1><p>Maak een auto aan of doe mee met de code van een andere bestuurder.</p></div>
        ${terug}
      </div>
      <div class="kaart">
        <div class="tabs">
          <button type="button" data-modus="nieuw" aria-pressed="${!code}">Nieuwe auto</button>
          <button type="button" data-modus="code" aria-pressed="${!!code}">Ik heb een code</button>
        </div>
        <form id="nieuw" ${code ? 'hidden' : ''}>
          <label class="veld"><span>Naam van de auto</span><input name="naam" placeholder="Bijv. de Golf" required></label>
          <label class="veld"><span>Kenteken <em class="optioneel">(optioneel)</em></span><input name="kenteken" placeholder="AB-123-C" autocapitalize="characters"></label>
          <label class="veld"><span>Jouw naam</span><input name="mijn" autocomplete="given-name" required></label>
          <div class="veld"><span>Jouw kleur</span>${kleurKiezer('kleur', KLEUREN[0])}</div>
          <p class="fout"></p>
          <button class="knop breed">Auto aanmaken</button>
        </form>
        <form id="doemee" ${code ? '' : 'hidden'}>
          <label class="veld"><span>Deelcode</span><input name="code" value="${esc(code)}" placeholder="ABCD2345" autocapitalize="characters" required></label>
          <div id="wie"></div>
          <p class="fout"></p>
          <button class="knop breed">Verder</button>
        </form>
      </div>
    </section>`;
  if ($('#terug')) $('#terug').onclick = () => kiesAuto(staat.autoId ?? staat.autos[0].id);
  $$('.tabs button').forEach((b) => {
    b.onclick = () => {
      $$('.tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      $('#nieuw').hidden = b.dataset.modus !== 'nieuw';
      $('#doemee').hidden = b.dataset.modus !== 'code';
    };
  });

  const nieuw = $('#nieuw');
  nieuw.onsubmit = (e) => {
    e.preventDefault();
    bezig($('.knop', nieuw), async () => {
      try {
        const id = await db.maakAuto(nieuw.naam.value.trim(), nieuw.kenteken.value.trim(), nieuw.mijn.value.trim(), nieuw.kleur.value);
        staat.autos = await db.mijnAutos();
        history.replaceState(null, '', location.pathname);
        await kiesAuto(id);
        toast('Auto aangemaakt. Deel de code met je medebestuurders.');
      } catch (fout) {
        $('.fout', nieuw).textContent = db.foutTekst(fout);
      }
    });
  };

  const doemee = $('#doemee');
  let stap = 'code';
  doemee.onsubmit = (e) => {
    e.preventDefault();
    const knop = $('.knop', doemee);
    bezig(knop, async () => {
      $('.fout', doemee).textContent = '';
      const deelcode = doemee.code.value.trim().toUpperCase();
      try {
        if (stap === 'code') {
          const vrij = await db.vrijePersonen(deelcode);
          const keuzes = vrij.map((p) => `<button type="button" class="chip" data-id="${p.id}" aria-pressed="false"><i class="stip" style="background:#94a3b8"></i>${esc(p.naam)}</button>`).join('');
          $('#wie').innerHTML = `
            ${vrij.length ? `<div class="veld"><span>Wie ben jij?</span><div class="chips">${keuzes}<button type="button" class="chip" data-id="" aria-pressed="true"><i class="stip" style="background:var(--accent)"></i>Iemand nieuw</button></div></div>` : ''}
            <label class="veld" id="naamveld"><span>Jouw naam</span><input name="naam" autocomplete="given-name"></label>
            <div class="veld"><span>Jouw kleur</span>${kleurKiezer('kleur', KLEUREN[1])}</div>`;
          $$('#wie .chip').forEach((c) => {
            c.onclick = () => {
              $$('#wie .chip').forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
              $('#naamveld').hidden = Boolean(c.dataset.id);
            };
          });
          stap = 'wie';
          knop.textContent = 'Meedoen';
          return;
        }
        const gekozen = $('#wie .chip[aria-pressed="true"]')?.dataset.id || null;
        const naam = doemee.naam.value.trim();
        if (!gekozen && !naam) { $('.fout', doemee).textContent = 'Vul je naam in'; return; }
        const id = await db.wordLid(deelcode, naam, gekozen, doemee.kleur.value);
        staat.autos = await db.mijnAutos();
        history.replaceState(null, '', location.pathname);
        await kiesAuto(id);
        toast('Je doet mee!');
      } catch (fout) {
        $('.fout', doemee).textContent = db.foutTekst(fout);
      }
    });
  };
}

/* ---------- hoofdschermen ---------- */

function render() {
  nav.hidden = false;
  $$('.nav-knop').forEach((b) => b.classList.toggle('actief', b.dataset.tab === staat.tab));
  $('.fab').classList.toggle('tank', staat.tab === 'tanken');
  $('.fab').setAttribute('aria-label', staat.tab === 'tanken' ? 'Tankbeurt toevoegen' : 'Rit toevoegen');
  ({ ritten: renderRitten, tanken: renderTanken, saldo: renderSaldo, meer: renderMeer })[staat.tab]();
}

function teller(stand) {
  const cijfers = String(stand ?? 0).padStart(6, '0').split('');
  return `<div class="teller" aria-label="${getal(stand ?? 0)} kilometer">${cijfers.map((c) => `<span>${c}</span>`).join('')}<b class="teller-km">km</b></div>`;
}

function verdelingBalk(rijen, waarde) {
  const totaal = rijen.reduce((s, r) => s + waarde(r), 0);
  if (!totaal) return '';
  return `<div class="balk">${rijen.map((r) => `<i style="width:${(waarde(r) / totaal) * 100}%;background:${esc(persoon(r.persoon_id).kleur)}"></i>`).join('')}</div>`;
}

function renderRitten() {
  const { auto, ritten } = staat.data;
  const lopend = staat.reken.lopend;
  const ik = mij();
  const mijnDeel = lopend.verdeling.find((v) => v.persoon_id === ik?.id);
  const sindsTanken = lopend.geregistreerdKm + lopend.ongeregistreerdKm;
  const zichtbaar = staat.alleRitten ? ritten : ritten.slice(0, 40);

  let vorigeDag = null;
  const regels = zichtbaar.map((r) => {
    const p = persoon(r.persoon_id);
    const kop = r.datum !== vorigeDag ? `<div class="dag">${esc(datumTekst(r.datum, { weekday: 'long', day: 'numeric', month: 'long' }))}</div>` : '';
    vorigeDag = r.datum;
    const titel = r.reden || `Rit van ${p.naam}`;
    const sub = [`${getal(r.begin_km)} → ${getal(r.eind_km)}`, r.reden ? p.naam : null, r.opdrachtgever ? `voor ${r.opdrachtgever}` : null].filter(Boolean).join(' · ');
    return `${kop}<button class="rij" data-rit="${r.id}">${avatar(p)}<span class="rij-midden"><b>${esc(titel)}</b><small>${esc(sub)}</small></span><span class="rij-rechts">${getal(r.eind_km - r.begin_km)}<small>km</small></span></button>`;
  }).join('');

  view.innerHTML = `
    <section class="held">
      <div class="held-auto">
        <div><div class="held-label">Kilometerstand</div><strong>${esc(auto.naam)}</strong></div>
        ${auto.kenteken ? `<span class="kenteken">${esc(auto.kenteken)}</span>` : ''}
      </div>
      ${teller(staat.stand)}
      <div class="held-stats">
        <div class="held-stat"><b>${getal(sindsTanken)}</b><small>km sinds tanken</small></div>
        <div class="held-stat"><b>${prijsKm(lopend.prijsPerKmCent)}</b><small>per km</small></div>
        <div class="held-stat"><b>${mijnDeel?.schattingCent != null ? euro(mijnDeel.schattingCent) : '–'}</b><small>jouw deel nu</small></div>
      </div>
      ${verdelingBalk(lopend.verdeling, (v) => v.km)}
      ${lopend.verdeling.length ? `<div class="legenda">${lopend.verdeling.map((v) => `<span>${stip(persoon(v.persoon_id))}${esc(persoon(v.persoon_id).naam)} ${getal(v.km)} km</span>`).join('')}</div>` : ''}
    </section>
    <div class="sectie"><h2>Ritten</h2></div>
    ${ritten.length ? `<div class="lijst">${regels}</div>` : `
      <div class="kaart leeg">${icoon.weg}<b>Nog geen ritten</b>Tik op + om je eerste rit vast te leggen. Met de camera lees je de kilometerstand direct van het dashboard.</div>`}
    ${!staat.alleRitten && ritten.length > 40 ? '<p style="text-align:center"><button class="knop zacht klein" id="meer-ritten">Alle ritten tonen</button></p>' : ''}`;

  $$('[data-rit]').forEach((b) => { b.onclick = () => ritSheet(ritten.find((r) => r.id === b.dataset.rit)); });
  if ($('#meer-ritten')) $('#meer-ritten').onclick = () => { staat.alleRitten = true; renderRitten(); };
}

function periodeKaart(p, klikbaar = true) {
  const t = p.tankbeurt;
  const betaler = persoon(t.betaald_door);
  const pillen = [
    `${getal(p.totaalKm)} km`,
    `${prijsKm(p.prijsPerKmCent)} / km`,
    t.liters ? `${String(t.liters).replace('.', ',')} L · ${euro(t.bedrag_cent / t.liters)}/L` : null,
    t.liters && p.totaalKm ? `1 op ${(p.totaalKm / t.liters).toFixed(1).replace('.', ',')}` : null,
  ].filter(Boolean).map((x) => `<span class="pil">${esc(x)}</span>`);
  if (p.ongeregistreerdKm) pillen.push(`<span class="pil let-op">${getal(p.ongeregistreerdKm)} km niet geregistreerd</span>`);
  const rijen = p.verdeling.map((v) => {
    const pp = persoon(v.persoon_id);
    const extra = v.extraKm >= 0.5 ? ` + ${getal(Math.round(v.extraKm))}` : '';
    return `<div class="verdeling-rij">${stip(pp)}<span>${esc(pp.naam)} <small>${getal(v.km)}${extra} km</small></span><b>${euro(v.bedrag_cent)}</b></div>`;
  }).join('');
  return `
    <${klikbaar ? `button class="kaart" style="display:block;width:100%;text-align:left;border:0" data-tank="${t.id}"` : 'div'}>
      <div class="tank-kop">
        <div><div class="tank-bedrag">${euro(t.bedrag_cent)}</div>
        <div class="tank-meta">${esc(datumTekst(t.datum))} · betaald door ${esc(betaler.naam)}${t.km_stand != null ? ` · stand ${getal(t.km_stand)}` : ''}</div></div>
        ${avatar(betaler)}
      </div>
      <div class="pillen">${pillen.join('')}</div>
      ${verdelingBalk(p.verdeling, (v) => v.bedrag_cent)}
      <div class="verdeling">${rijen}</div>
      ${p.waarschuwingen.map((w) => `<div class="waarschuwing">${esc(w)}</div>`).join('')}
      ${t.notitie ? `<div class="tank-meta" style="margin-top:8px">${esc(t.notitie)}</div>` : ''}
    </${klikbaar ? 'button' : 'div'}>`;
}

function renderTanken() {
  const periodes = [...staat.reken.periodes].reverse();
  const totaal = periodes.reduce((s, p) => s + p.tankbeurt.bedrag_cent, 0);
  view.innerHTML = `
    <div class="kopregel">
      <div><h1>Tanken</h1><div class="sub">${periodes.length ? `${periodes.length} ${periodes.length === 1 ? 'tankbeurt' : 'tankbeurten'} · ${euro(totaal)} totaal` : 'Nog niet getankt'}</div></div>
      <button class="knop klein" id="nieuwe-tank">${icoon.pomp}Tankbeurt</button>
    </div>
    ${periodes.length ? periodes.map((p) => periodeKaart(p)).join('') : `
      <div class="kaart leeg">${icoon.pomp}<b>Nog geen tankbeurten</b>Leg een tankbeurt vast met het bedrag. De app rekent uit wat iedereen moet betalen op basis van de gereden kilometers.</div>`}`;
  $('#nieuwe-tank').onclick = () => tankSheet();
  $$('[data-tank]').forEach((b) => {
    b.onclick = () => tankSheet(staat.data.tankbeurten.find((t) => t.id === b.dataset.tank));
  });
}

function renderSaldo() {
  const lijst = overboekingen(staat.saldo);
  const ik = mij();
  const rijen = actievePersonen().concat(personen().filter((p) => !p.actief && staat.saldo.get(p.id)))
    .map((p) => {
      const s = staat.saldo.get(p.id) ?? 0;
      const tekst = s > 0 ? `krijgt ${euro(s)}` : s < 0 ? `betaalt ${euro(-s)}` : 'staat quitte';
      return `<div class="saldo-rij">${avatar(p)}<span class="rij-midden"><b>${esc(p.naam)}${p.id === ik?.id ? ' (jij)' : ''}</b><small>${tekst}</small></span><span class="rij-rechts ${s > 0 ? 'plus' : s < 0 ? 'min' : ''}">${s ? euro(s, { signDisplay: 'always' }) : '✓'}</span></div>`;
    }).join('');
  const voorstellen = lijst.map((o, i) => `
    <div class="overboeking">${avatar(persoon(o.van))}
      <span class="rij-midden"><b>${esc(persoon(o.van).naam)}</b><small>betaalt aan ${esc(persoon(o.naar).naam)}</small></span>
      <span class="bedrag">${euro(o.bedrag_cent)}</span>
      <button class="knop klein" data-voorstel="${i}">${icoon.vink}Betaald</button>
    </div>`).join('');
  const betalingen = staat.data.betalingen.slice(0, 30).map((b) => `
    <button class="rij" data-betaling="${b.id}">${avatar(persoon(b.van_persoon))}
      <span class="rij-midden"><b>${esc(persoon(b.van_persoon).naam)} → ${esc(persoon(b.naar_persoon).naam)}</b><small>${esc(datumTekst(b.datum))}</small></span>
      <span class="rij-rechts">${euro(b.bedrag_cent)}</span></button>`).join('');

  view.innerHTML = `
    <div class="kopregel"><div><h1>Verrekenen</h1><div class="sub">Wie moet wie nog betalen</div></div></div>
    <div class="kaart">${rijen || '<div class="leeg">Nog geen bestuurders</div>'}</div>
    <div class="sectie"><h2>Zo is iedereen quitte</h2></div>
    <div class="kaart">${voorstellen || `<div class="leeg">${icoon.vink}<b>Alles is verrekend</b>Niemand hoeft iets te betalen.</div>`}</div>
    <div class="sectie"><h2>Betalingen</h2><button class="link" id="nieuwe-betaling">+ Betaling</button></div>
    ${betalingen ? `<div class="lijst">${betalingen}</div>` : '<div class="kaart leeg">Nog geen onderlinge betalingen vastgelegd.</div>'}`;

  $$('[data-voorstel]').forEach((b) => {
    b.onclick = () => bezig(b, async () => {
      const o = lijst[Number(b.dataset.voorstel)];
      try {
        await db.bewaar('betaling', {
          auto_id: staat.autoId, datum: vandaag(), van_persoon: o.van, naar_persoon: o.naar, bedrag_cent: o.bedrag_cent,
        });
        toast(`${persoon(o.van).naam} heeft ${euro(o.bedrag_cent)} betaald`);
        await herlaad();
      } catch (fout) { toast(db.foutTekst(fout)); }
    });
  });
  $('#nieuwe-betaling').onclick = () => betalingSheet();
  $$('[data-betaling]').forEach((b) => {
    b.onclick = () => betalingSheet(staat.data.betalingen.find((x) => x.id === b.dataset.betaling));
  });
}

function renderMeer() {
  const { auto } = staat.data;
  const ik = mij();
  const thema = opslag.lees(SLEUTEL_THEMA) ?? 'auto';
  const rijen = personen().map((p) => {
    const status = p.id === ik?.id ? 'jij' : p.user_id ? 'heeft de app' : 'nog geen account';
    return `<button class="rij" data-persoon="${p.id}" ${p.actief ? '' : 'style="opacity:.55"'}>${avatar(p)}<span class="rij-midden"><b>${esc(p.naam)}</b><small>${status}${p.actief ? '' : ' · niet actief'}</small></span></button>`;
  }).join('');

  view.innerHTML = `
    <div class="kopregel">
      <div><h1>${esc(auto.naam)}</h1><div class="sub">${esc(auto.kenteken ?? 'Geen kenteken')}</div></div>
      <button class="knop zacht klein" id="auto-wijzig">Wijzig</button>
    </div>
    <div class="kaart">
      <h2>Medebestuurders uitnodigen</h2>
      <div class="code">${esc(auto.deelcode)}</div>
      <button class="knop breed" id="delen">${icoon.delen}Deel de code</button>
    </div>
    <div class="sectie"><h2>Bestuurders</h2><button class="link" id="nieuwe-persoon">+ Persoon</button></div>
    <div class="lijst">${rijen}</div>
    <div class="sectie"><h2>Instellingen</h2></div>
    <div class="kaart">
      ${staat.autos.length > 1 ? `<label class="instelling"><span>Auto</span><select id="wissel">${staat.autos.map((a) => `<option value="${a.id}" ${a.id === staat.autoId ? 'selected' : ''}>${esc(a.naam)}</option>`).join('')}</select></label>` : ''}
      <label class="instelling"><span>Weergave</span><select id="thema">
        <option value="auto" ${thema === 'auto' ? 'selected' : ''}>Zoals telefoon</option>
        <option value="light" ${thema === 'light' ? 'selected' : ''}>Licht</option>
        <option value="dark" ${thema === 'dark' ? 'selected' : ''}>Donker</option>
      </select></label>
      <div class="instelling"><span>Andere auto</span><button class="knop zacht klein" id="andere">Toevoegen</button></div>
      <div class="instelling"><span><small style="color:var(--zacht)">${esc(staat.user.email)}</small></span><button class="knop zacht klein" id="uitloggen">Uitloggen</button></div>
      <div class="instelling"><span>Deze auto verlaten</span><button class="knop gevaar klein" id="verlaat">Verlaten</button></div>
    </div>`;

  $('#auto-wijzig').onclick = autoSheet;
  $('#delen').onclick = async () => {
    const url = `${location.origin}${location.pathname}?code=${auto.deelcode}`;
    const tekst = `Rij je mee in ${auto.naam}? Houd je kilometers bij in KilometerTracker. Code: ${auto.deelcode}`;
    try {
      if (navigator.share) await navigator.share({ title: 'KilometerTracker', text: tekst, url });
      else { await navigator.clipboard.writeText(`${tekst}\n${url}`); toast('Gekopieerd'); }
    } catch { /* delen geannuleerd */ }
  };
  $('#nieuwe-persoon').onclick = () => persoonSheet();
  $$('[data-persoon]').forEach((b) => { b.onclick = () => persoonSheet(persoon(b.dataset.persoon)); });
  if ($('#wissel')) $('#wissel').onchange = (e) => kiesAuto(e.target.value);
  $('#thema').onchange = (e) => {
    const w = e.target.value;
    opslag.zet(SLEUTEL_THEMA, w === 'auto' ? null : w);
    if (w === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = w;
  };
  $('#andere').onclick = () => toonOnboarding();
  $('#uitloggen').onclick = async () => {
    staat.stopVolgen?.();
    await db.uitloggen();
    Object.assign(staat, { user: null, autos: [], autoId: null, data: null });
    opslag.zet(SLEUTEL_AUTO, null);
    toonLogin();
  };
  $('#verlaat').onclick = async () => {
    if (!confirm(`Wil je ${auto.naam} verlaten? Je ritten blijven bewaard, maar je ziet de auto niet meer.`)) return;
    try {
      await db.verlaatAuto(auto.id);
      staat.stopVolgen?.();
      staat.autos = await db.mijnAutos();
      opslag.zet(SLEUTEL_AUTO, null);
      if (staat.autos.length) await kiesAuto(staat.autos[0].id);
      else toonOnboarding();
    } catch (fout) { toast(db.foutTekst(fout)); }
  };
}

/* ---------- sheets (formulieren) ---------- */

function openSheet(titel, inhoud, { opslaan = 'Opslaan', verwijderen = false } = {}) {
  sheet.innerHTML = `
    <form method="dialog" novalidate>
      <div class="greep"></div>
      <div class="sheet-kop"><h2>${esc(titel)}</h2><button type="button" class="sluit" data-sluit aria-label="Sluiten">${icoon.sluit}</button></div>
      ${inhoud}
      <p class="fout" data-fout></p>
      <div class="knoppen">
        ${verwijderen ? '<button type="button" class="knop gevaar" data-verwijder>Verwijderen</button>' : ''}
        <button class="knop" data-opslaan>${esc(opslaan)}</button>
      </div>
    </form>`;
  const form = $('form', sheet);
  $('[data-sluit]', form).onclick = () => sheet.close();
  sheet.showModal();
  return form;
}

sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

function persoonChips(naam, gekozen) {
  return `<div class="chips" data-chips="${naam}">${actievePersonen().map((p) => `
    <button type="button" class="chip" data-id="${p.id}" aria-pressed="${p.id === gekozen}">${stip(p)}${esc(p.naam)}</button>`).join('')}</div>`;
}

function koppelChips(form, naam, bijWissel) {
  const chips = $$(`[data-chips="${naam}"] .chip`, form);
  chips.forEach((c) => {
    c.onclick = () => {
      chips.forEach((x) => x.setAttribute('aria-pressed', String(x === c)));
      bijWissel?.();
    };
  });
  return () => chips.find((c) => c.getAttribute('aria-pressed') === 'true')?.dataset.id ?? null;
}

const uniek = (waarden) => [...new Set(waarden.filter(Boolean))].slice(0, 30);
const keuzeLijst = (id, waarden) => `<datalist id="${id}">${uniek(waarden).map((w) => `<option value="${esc(w)}">`).join('')}</datalist>`;

/** Koppelt een camera-knop aan een invoerveld. `vorige` geeft de stand die ervoor hoort. */
function koppelCamera(form, veld, vorige, bijGelezen) {
  const knop = $(`[data-camera="${veld}"]`, form);
  knop.onclick = () => {
    camera.value = '';
    camera.onchange = async () => {
      const bestand = camera.files?.[0];
      if (!bestand) return;
      knop.classList.add('bezig');
      knop.innerHTML = icoon.bezig;
      knop.disabled = true;
      try {
        const uitkomst = await leesKilometerstand(bestand, vorige());
        const vak = $(`[data-foto="${veld}"]`, form);
        if (uitkomst.stand == null) {
          vak.innerHTML = `<img src="${uitkomst.voorbeeld}" alt=""><span>Geen kilometerstand gevonden. Probeer het van dichterbij of vul hem zelf in.</span>`;
        } else {
          form[veld].value = uitkomst.stand;
          form[veld].dispatchEvent(new Event('input', { bubbles: true }));
          vak.innerHTML = `<img src="${uitkomst.voorbeeld}" alt=""><span><b>${getal(uitkomst.stand)} km</b> gelezen${uitkomst.zeker ? '' : ' – controleer even of dit klopt'}</span>`;
          bijGelezen?.(uitkomst);
        }
        vak.hidden = false;
      } catch {
        toast('De foto kon niet worden gelezen');
      } finally {
        knop.classList.remove('bezig');
        knop.innerHTML = icoon.camera;
        knop.disabled = false;
      }
    };
    camera.click();
  };
}

const cameraVeld = (naam, label, waarde, extra = '') => `
  <label class="veld groot"><span>${label}</span>
    <span class="met-camera"><input name="${naam}" type="number" inputmode="numeric" min="0" step="1" value="${waarde ?? ''}" ${extra}>
    <button type="button" class="camera-knop" data-camera="${naam}" aria-label="Foto van de kilometerstand">${icoon.camera}</button></span>
  </label>`;
const fotoVak = (naam) => `<div class="foto-resultaat" data-foto="${naam}" hidden></div>`;

function ritSheet(rit) {
  const { ritten } = staat.data;
  const nieuw = !rit;
  const laatstePersoon = opslag.lees(`km-persoon-${staat.autoId}`);
  const standaard = rit?.persoon_id ?? (actievePersonen().some((p) => p.id === laatstePersoon) ? laatstePersoon : mij()?.id ?? actievePersonen()[0]?.id);
  const begin = rit?.begin_km ?? staat.stand;
  const form = openSheet(nieuw ? 'Nieuwe rit' : 'Rit wijzigen', `
    <div class="veld"><span>Wie reed er?</span>${persoonChips('wie', standaard)}</div>
    <label class="veld"><span>Datum</span><input name="datum" type="date" value="${rit?.datum ?? vandaag()}" max="${vandaag()}" required></label>
    ${cameraVeld('begin', 'Beginstand', begin)}
    ${fotoVak('begin')}
    <div class="twee">
      ${cameraVeld('eind', 'Eindstand', rit?.eind_km, 'autofocus')}
      <label class="veld groot"><span>Kilometers</span><input name="km" type="number" inputmode="numeric" min="1" step="1" value="${rit ? rit.eind_km - rit.begin_km : ''}"></label>
    </div>
    ${fotoVak('eind')}
    <p class="hint" data-hint></p>
    <label class="veld"><span>Reden <em class="optioneel">(optioneel)</em></span><input name="reden" list="redenen" value="${esc(rit?.reden)}" placeholder="Bijv. werk, boodschappen"></label>
    <label class="veld"><span>In opdracht van <em class="optioneel">(optioneel)</em></span><input name="opdrachtgever" list="opdrachtgevers" value="${esc(rit?.opdrachtgever)}"></label>
    ${keuzeLijst('redenen', ritten.map((r) => r.reden))}
    ${keuzeLijst('opdrachtgevers', ritten.map((r) => r.opdrachtgever))}`, { verwijderen: !nieuw });

  const wie = koppelChips(form, 'wie');
  const hint = $('[data-hint]', form);
  const num = (v) => (v === '' ? null : Number(v));
  function toonHint() {
    const b = num(form.begin.value);
    hint.className = 'hint';
    hint.textContent = '';
    if (!nieuw || b == null || staat.stand == null) return;
    if (b > staat.stand) {
      hint.classList.add('let-op');
      hint.textContent = `${getal(b - staat.stand)} km sinds de laatste registratie (${getal(staat.stand)}) zijn niet vastgelegd. Die worden bij het tanken naar verhouding verdeeld.`;
    } else if (b < staat.stand) {
      hint.classList.add('let-op');
      hint.textContent = `Let op: de beginstand ligt onder de laatst bekende stand (${getal(staat.stand)}).`;
    }
  }
  form.begin.addEventListener('input', () => {
    const b = num(form.begin.value);
    const k = num(form.km.value);
    if (b != null && num(form.eind.value) != null) form.km.value = num(form.eind.value) - b;
    else if (b != null && k != null) form.eind.value = b + k;
    toonHint();
  });
  form.eind.addEventListener('input', () => {
    const b = num(form.begin.value);
    const e = num(form.eind.value);
    form.km.value = b != null && e != null ? e - b : '';
  });
  form.km.addEventListener('input', () => {
    const b = num(form.begin.value);
    const k = num(form.km.value);
    form.eind.value = b != null && k != null ? b + k : '';
  });
  toonHint();
  koppelCamera(form, 'begin', () => staat.stand);
  koppelCamera(form, 'eind', () => num(form.begin.value) ?? staat.stand);

  form.onsubmit = (e) => {
    e.preventDefault();
    const fout = $('[data-fout]', form);
    const b = num(form.begin.value);
    const eind = num(form.eind.value);
    const persoonId = wie();
    if (!persoonId) { fout.textContent = 'Kies wie er reed'; return; }
    if (b == null || eind == null) { fout.textContent = 'Vul de beginstand en de eindstand of kilometers in'; return; }
    if (eind <= b) { fout.textContent = 'De eindstand moet hoger zijn dan de beginstand'; return; }
    if (eind - b > 3000 && !confirm(`${getal(eind - b)} km is een lange rit. Klopt dat?`)) return;
    bezig($('[data-opslaan]', form), async () => {
      try {
        await db.bewaar('rit', {
          id: rit?.id,
          auto_id: staat.autoId,
          datum: form.datum.value || vandaag(),
          begin_km: b,
          eind_km: eind,
          persoon_id: persoonId,
          reden: form.reden.value.trim() || null,
          opdrachtgever: form.opdrachtgever.value.trim() || null,
        });
        opslag.zet(`km-persoon-${staat.autoId}`, persoonId);
        sheet.close();
        toast(`Rit opgeslagen · ${km(eind - b)}`);
        await herlaad();
      } catch (err) { fout.textContent = db.foutTekst(err); }
    });
  };
  koppelVerwijder(form, 'rit', rit, 'Rit verwijderd');
}

function koppelVerwijder(form, soort, rij, melding) {
  const knop = $('[data-verwijder]', form);
  if (!knop) return;
  knop.onclick = () => {
    if (!confirm('Weet je het zeker? Dit kan niet ongedaan worden gemaakt.')) return;
    bezig(knop, async () => {
      try {
        await db.verwijder(soort, rij.id);
        sheet.close();
        toast(melding);
        await herlaad();
      } catch (err) { $('[data-fout]', form).textContent = db.foutTekst(err); }
    });
  };
}

function tankSheet(tank) {
  const nieuw = !tank;
  const form = openSheet(nieuw ? 'Tankbeurt' : 'Tankbeurt wijzigen', `
    <div class="twee">
      <label class="veld groot"><span>Bedrag</span><input name="bedrag" inputmode="decimal" placeholder="€ 0,00" value="${tank ? (tank.bedrag_cent / 100).toFixed(2).replace('.', ',') : ''}" autofocus required></label>
      <label class="veld groot"><span>Liters <em class="optioneel">(optioneel)</em></span><input name="liters" inputmode="decimal" value="${tank?.liters ? String(tank.liters).replace('.', ',') : ''}"></label>
    </div>
    ${cameraVeld('stand', 'Kilometerstand <em class="optioneel">(optioneel, voor niet geregistreerde km)</em>', tank?.km_stand)}
    ${fotoVak('stand')}
    <label class="veld"><span>Datum</span><input name="datum" type="date" value="${tank?.datum ?? vandaag()}" max="${vandaag()}" required></label>
    <div class="veld"><span>Betaald door</span>${persoonChips('betaler', tank?.betaald_door ?? mij()?.id)}</div>
    <label class="veld"><span>Notitie <em class="optioneel">(optioneel)</em></span><input name="notitie" value="${esc(tank?.notitie)}"></label>
    <div data-voorbeeld></div>`, { verwijderen: !nieuw });

  const betaler = koppelChips(form, 'betaler', toonVoorbeeld);
  const leesGetal = (v) => { const n = Number(String(v).replace(',', '.')); return v !== '' && Number.isFinite(n) ? n : null; };

  function concept() {
    const bedrag = leesBedrag(form.bedrag.value);
    if (!bedrag) return null;
    return {
      id: tank?.id ?? 'concept',
      datum: form.datum.value || vandaag(),
      km_stand: form.stand.value === '' ? null : Number(form.stand.value),
      bedrag_cent: bedrag,
      liters: leesGetal(form.liters.value),
      betaald_door: betaler() ?? mij()?.id,
      aangemaakt_op: tank?.aangemaakt_op ?? '9999',
      notitie: form.notitie.value.trim() || null,
    };
  }

  function toonVoorbeeld() {
    const vak = $('[data-voorbeeld]', form);
    const c = concept();
    if (!c) { vak.innerHTML = ''; return; }
    const lijst = staat.data.tankbeurten.filter((t) => t.id !== tank?.id).concat(c);
    const p = berekenPeriodes(staat.data.ritten, lijst, personen()).periodes.find((x) => x.tankbeurt.id === c.id);
    vak.innerHTML = `<div class="voorbeeld"><div class="tank-meta">Zo wordt het verdeeld</div>${periodeKaart(p, false).replace('class="kaart"', 'class=""')}</div>`;
  }
  ['bedrag', 'liters', 'stand', 'datum'].forEach((n) => form[n].addEventListener('input', toonVoorbeeld));
  koppelCamera(form, 'stand', () => staat.stand);
  toonVoorbeeld();

  form.onsubmit = (e) => {
    e.preventDefault();
    const fout = $('[data-fout]', form);
    const c = concept();
    if (!c) { fout.textContent = 'Vul het bedrag in'; return; }
    if (!c.betaald_door) { fout.textContent = 'Kies wie er betaalde'; return; }
    bezig($('[data-opslaan]', form), async () => {
      try {
        await db.bewaar('tank', {
          id: tank?.id,
          auto_id: staat.autoId,
          datum: c.datum,
          km_stand: c.km_stand,
          bedrag_cent: c.bedrag_cent,
          liters: c.liters,
          betaald_door: c.betaald_door,
          notitie: c.notitie,
        });
        sheet.close();
        toast(`Tankbeurt van ${euro(c.bedrag_cent)} verdeeld`);
        staat.tab = 'tanken';
        await herlaad();
      } catch (err) { fout.textContent = db.foutTekst(err); }
    });
  };
  koppelVerwijder(form, 'tank', tank, 'Tankbeurt verwijderd');
}

function betalingSheet(betaling) {
  const opties = (gekozen) => personen().map((p) => `<option value="${p.id}" ${p.id === gekozen ? 'selected' : ''}>${esc(p.naam)}</option>`).join('');
  const form = openSheet(betaling ? 'Betaling' : 'Betaling vastleggen', `
    <div class="twee">
      <label class="veld"><span>Van</span><select name="van">${opties(betaling?.van_persoon ?? mij()?.id)}</select></label>
      <label class="veld"><span>Aan</span><select name="naar">${opties(betaling?.naar_persoon ?? personen().find((p) => p.id !== mij()?.id)?.id)}</select></label>
    </div>
    <label class="veld groot"><span>Bedrag</span><input name="bedrag" inputmode="decimal" placeholder="€ 0,00" value="${betaling ? (betaling.bedrag_cent / 100).toFixed(2).replace('.', ',') : ''}"></label>
    <label class="veld"><span>Datum</span><input name="datum" type="date" value="${betaling?.datum ?? vandaag()}"></label>`, { verwijderen: !!betaling });
  form.onsubmit = (e) => {
    e.preventDefault();
    const fout = $('[data-fout]', form);
    const bedrag = leesBedrag(form.bedrag.value);
    if (!bedrag) { fout.textContent = 'Vul het bedrag in'; return; }
    if (form.van.value === form.naar.value) { fout.textContent = 'Kies twee verschillende personen'; return; }
    bezig($('[data-opslaan]', form), async () => {
      try {
        await db.bewaar('betaling', {
          id: betaling?.id, auto_id: staat.autoId, datum: form.datum.value || vandaag(),
          van_persoon: form.van.value, naar_persoon: form.naar.value, bedrag_cent: bedrag,
        });
        sheet.close();
        toast('Betaling opgeslagen');
        await herlaad();
      } catch (err) { fout.textContent = db.foutTekst(err); }
    });
  };
  koppelVerwijder(form, 'betaling', betaling, 'Betaling verwijderd');
}

function persoonSheet(p) {
  const vrijeKleur = KLEUREN.find((k) => !personen().some((x) => x.kleur === k)) ?? KLEUREN[0];
  const form = openSheet(p ? p.naam : 'Persoon toevoegen', `
    <label class="veld"><span>Naam</span><input name="naam" value="${esc(p?.naam)}" required></label>
    <div class="veld"><span>Kleur</span>${kleurKiezer('kleur', p?.kleur ?? vrijeKleur)}</div>
    ${p ? `<label class="instelling"><span>Rijdt nog mee</span><input name="actief" type="checkbox" style="width:24px;min-height:24px" ${p.actief ? 'checked' : ''}></label>` : '<p class="hint">Ook iemand zonder de app kun je toevoegen. Als die later meedoet met de deelcode, kiest hij zijn naam en worden zijn ritten gekoppeld.</p>'}`);
  form.onsubmit = (e) => {
    e.preventDefault();
    const naam = form.naam.value.trim();
    if (!naam) { $('[data-fout]', form).textContent = 'Vul een naam in'; return; }
    bezig($('[data-opslaan]', form), async () => {
      try {
        await db.bewaar('persoon', p
          ? { id: p.id, naam, kleur: form.kleur.value, actief: form.actief.checked }
          : { auto_id: staat.autoId, naam, kleur: form.kleur.value });
        sheet.close();
        await herlaad();
      } catch (err) { $('[data-fout]', form).textContent = db.foutTekst(err); }
    });
  };
}

function autoSheet() {
  const { auto } = staat.data;
  const form = openSheet('Auto', `
    <label class="veld"><span>Naam</span><input name="naam" value="${esc(auto.naam)}" required></label>
    <label class="veld"><span>Kenteken</span><input name="kenteken" value="${esc(auto.kenteken)}" autocapitalize="characters"></label>`);
  form.onsubmit = (e) => {
    e.preventDefault();
    bezig($('[data-opslaan]', form), async () => {
      try {
        await db.bewaar('auto', { id: auto.id, naam: form.naam.value.trim(), kenteken: form.kenteken.value.trim().toUpperCase() || null });
        staat.autos = await db.mijnAutos();
        sheet.close();
        await herlaad();
      } catch (err) { $('[data-fout]', form).textContent = db.foutTekst(err); }
    });
  };
}

/* ---------- navigatie ---------- */

$$('.nav-knop').forEach((b) => {
  b.onclick = () => {
    staat.tab = b.dataset.tab;
    window.scrollTo({ top: 0 });
    render();
  };
});
$('.fab').onclick = () => (staat.tab === 'tanken' ? tankSheet() : ritSheet());

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && staat.data && !sheet.open) herlaad();
});

start();
