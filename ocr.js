// Leest de kilometerstand van een foto. Eerst via de Supabase-functie `lees-kmstand`
// (Claude, zeer nauwkeurig). Is die niet ingericht of niet bereikbaar, dan valt de app
// terug op tekstherkenning in de telefoon zelf (Tesseract), die minder betrouwbaar is.
import { client } from './data.js';
import { kiesStand } from './logic.js';

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const MAX_ZIJDE = 1600;

/** Verkleint de foto, zodat het versturen snel gaat. Geeft een JPEG als base64 terug. */
async function verklein(bestand) {
  const beeld = await createImageBitmap(bestand);
  const schaal = Math.min(1, MAX_ZIJDE / Math.max(beeld.width, beeld.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(beeld.width * schaal);
  canvas.height = Math.round(beeld.height * schaal);
  canvas.getContext('2d').drawImage(beeld, 0, 0, canvas.width, canvas.height);
  beeld.close?.();
  const url = canvas.toDataURL('image/jpeg', 0.85);
  return { url, base64: url.split(',')[1], canvas };
}

async function viaClaude(base64, vorigeStand) {
  const c = await client();
  const { data, error } = await c.functions.invoke('lees-kmstand', {
    body: { afbeelding: base64, mediaType: 'image/jpeg', vorigeStand },
  });
  if (error) throw error;
  if (!data || data.fout) throw new Error(data?.fout ?? 'Geen antwoord');
  return data;
}

let tesseractBelofte;
function laadTesseract() {
  tesseractBelofte ??= new Promise((resolve, reject) => {
    if (window.Tesseract) { resolve(window.Tesseract); return; }
    const script = document.createElement('script');
    script.src = TESSERACT;
    script.onload = () => resolve(window.Tesseract);
    script.onerror = () => { tesseractBelofte = null; reject(new Error('Tekstherkenning niet geladen')); };
    document.head.append(script);
  });
  return tesseractBelofte;
}

async function viaTesseract(canvas, vorigeStand) {
  const Tesseract = await laadTesseract();
  const worker = await Tesseract.createWorker('eng');
  try {
    await worker.setParameters({ tessedit_char_whitelist: '0123456789 ' });
    const { data } = await worker.recognize(canvas);
    const getallen = (data.text.match(/\d[\d ]{2,}\d/g) ?? [])
      .map((t) => Number(t.replace(/\s/g, '')))
      .filter((g) => g < 2_000_000);
    return { stand: kiesStand(getallen, vorigeStand), zeker: false, bron: 'telefoon' };
  } finally {
    await worker.terminate();
  }
}

/**
 * Geeft { stand, zeker, bron, voorbeeld } terug. `stand` is null als er niets
 * bruikbaars op de foto stond. `voorbeeld` is een kleine versie van de foto.
 */
export async function leesKilometerstand(bestand, vorigeStand) {
  const { url, base64, canvas } = await verklein(bestand);
  try {
    const uitkomst = await viaClaude(base64, vorigeStand);
    const stand = Number.isInteger(uitkomst.stand) ? uitkomst.stand : null;
    return { stand, zeker: Boolean(uitkomst.leesbaar && stand !== null), bron: 'claude', voorbeeld: url };
  } catch {
    const uitkomst = await viaTesseract(canvas, vorigeStand);
    return { ...uitkomst, voorbeeld: url };
  }
}
