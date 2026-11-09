// Alles wat met Supabase praat: inloggen, auto's en de gegevens per auto.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const BIBLIOTHEEK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const FOUTEN = {
  'Invalid login credentials': 'E-mailadres of wachtwoord klopt niet',
  'Email not confirmed': 'Bevestig eerst je e-mailadres via de mail die je hebt gekregen',
  'User already registered': 'Dit e-mailadres heeft al een account. Log in met je bestaande wachtwoord.',
  'rate limit': 'Er zijn te veel mails verstuurd. Probeer het over een uur opnieuw.',
  'not authorized': 'Supabase mag naar dit e-mailadres (nog) geen mail sturen',
  'Signups not allowed for this instance': 'Nieuwe accounts zijn uitgeschakeld',
  'Onbekende code': 'Deze deelcode bestaat niet',
};

let clientBelofte;

export function client() {
  clientBelofte ??= import(BIBLIOTHEEK)
    .then(({ createClient }) => createClient(SUPABASE_URL, SUPABASE_KEY))
    .catch((fout) => {
      clientBelofte = null;
      throw fout;
    });
  return clientBelofte;
}

export function foutTekst(fout) {
  const bericht = fout?.message ?? '';
  const bekend = Object.keys(FOUTEN).find((k) => bericht.includes(k));
  if (bekend) return FOUTEN[bekend];
  if (bericht.includes('Password should be')) return 'Kies een wachtwoord van minstens 6 tekens';
  if (bericht.includes('Persoon hoort niet')) return 'Deze persoon hoort niet bij deze auto';
  if (bericht.includes('eind_km')) return 'De eindstand moet hoger zijn dan de beginstand';
  return 'Dat lukte niet. Controleer je internet en probeer het opnieuw.';
}

const check = ({ data, error }) => {
  if (error) throw error;
  return data;
};

export async function huidigAccount() {
  try {
    const { data } = await (await client()).auth.getSession();
    return data.session?.user ?? null;
  } catch {
    return null;
  }
}

export async function inloggen(email, wachtwoord) {
  return check(await (await client()).auth.signInWithPassword({ email, password: wachtwoord })).user;
}

/** Geeft de gebruiker terug, of null als die eerst zijn e-mail moet bevestigen. */
export async function registreren(email, wachtwoord) {
  const data = check(await (await client()).auth.signUp({
    email, password: wachtwoord, options: { emailRedirectTo: location.origin + location.pathname },
  }));
  // Supabase meldt een bestaand adres niet als fout, maar geeft een gebruiker zonder identiteiten terug.
  if (!data.session && data.user && (data.user.identities ?? []).length === 0) {
    throw new Error('User already registered');
  }
  return data.session ? data.user : null;
}

export async function uitloggen() {
  await (await client()).auth.signOut({ scope: 'local' });
}

export async function mijnAutos() {
  const c = await client();
  return check(await c.from('km_autos').select('id,naam,kenteken,deelcode').order('naam'));
}

export async function maakAuto(naam, kenteken, mijnNaam, kleur) {
  return check(await (await client()).rpc('km_maak_auto', {
    p_naam: naam, p_kenteken: kenteken, p_mijn_naam: mijnNaam, p_kleur: kleur,
  }));
}

export async function vrijePersonen(code) {
  return check(await (await client()).rpc('km_vrije_personen', { p_code: code }));
}

export async function wordLid(code, naam, persoonId, kleur) {
  return check(await (await client()).rpc('km_word_lid', {
    p_code: code, p_naam: naam, p_persoon: persoonId ?? null, p_kleur: kleur,
  }));
}

export async function verlaatAuto(autoId) {
  check(await (await client()).rpc('km_verlaat_auto', { p_auto: autoId }));
}

/** Alle gegevens van één auto in één keer. */
export async function laadAuto(autoId) {
  const c = await client();
  const [auto, personen, ritten, tankbeurten, betalingen] = await Promise.all([
    c.from('km_autos').select('*').eq('id', autoId).single(),
    c.from('km_personen').select('*').eq('auto_id', autoId).order('aangemaakt_op'),
    c.from('km_ritten').select('*').eq('auto_id', autoId).order('begin_km', { ascending: false }),
    c.from('km_tankbeurten').select('*').eq('auto_id', autoId).order('datum', { ascending: false }),
    c.from('km_betalingen').select('*').eq('auto_id', autoId).order('datum', { ascending: false }),
  ]).then((r) => r.map(check));
  return { auto, personen, ritten, tankbeurten, betalingen };
}

const TABELLEN = { rit: 'km_ritten', tank: 'km_tankbeurten', betaling: 'km_betalingen', persoon: 'km_personen', auto: 'km_autos' };

export async function bewaar(soort, rij) {
  const c = await client();
  const { id, ...velden } = rij;
  const vraag = id ? c.from(TABELLEN[soort]).update(velden).eq('id', id) : c.from(TABELLEN[soort]).insert(velden);
  check(await vraag);
}

export async function bewaarVeel(soort, rijen) {
  if (rijen.length) check(await (await client()).from(TABELLEN[soort]).insert(rijen));
}

export async function verwijder(soort, id) {
  check(await (await client()).from(TABELLEN[soort]).delete().eq('id', id));
}

/** Laat `bijWijziging` lopen als iemand anders iets voor deze auto aanpast. */
export async function volgWijzigingen(autoId, bijWijziging) {
  const c = await client();
  const kanaal = c.channel(`km-${autoId}`);
  ['km_ritten', 'km_tankbeurten', 'km_betalingen', 'km_personen'].forEach((table) => {
    kanaal.on('postgres_changes', { event: '*', schema: 'public', table, filter: `auto_id=eq.${autoId}` }, bijWijziging);
  });
  kanaal.subscribe();
  return () => c.removeChannel(kanaal);
}
