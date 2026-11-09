# KilometerTracker

Webapp voor één auto die door meerdere mensen wordt gebruikt. Iedereen legt zijn ritten vast; bij een tankbeurt rekent de app uit wat iedereen moet betalen op basis van de gereden kilometers. Installeerbaar op Android.

## Hoe de verdeling werkt

- Een tankbeurt betaalt de kilometers sinds de vorige tankbeurt.
- Prijs per km = bedrag ÷ alle kilometers in die periode.
- Geef je bij het tanken de kilometerstand op en wijkt die af van de geregistreerde ritten, dan worden de niet-geregistreerde kilometers naar verhouding verdeeld over de bestuurders van die periode.
- Loopt een rit over een tankbeurt heen, dan telt elk deel in zijn eigen periode.
- Onder *Verrekenen* staat wie wie moet betalen, met zo min mogelijk overboekingen.

## Eenmalig inrichten

1. **Database**: open Supabase → SQL Editor, plak `supabase/schema.sql` en klik op Run.
2. **Bevestigingsmail**: zet onder Authentication → URL Configuration het adres van de app bij *Redirect URLs* (`https://stefanvanoosten.github.io/kilometertracker/`).
3. **Foto van de kilometerstand** (optioneel, maar veel nauwkeuriger):
   - Supabase → Edge Functions → *Deploy a new function* → *Via Editor*, naam `lees-kmstand`, plak `supabase/functions/lees-kmstand/index.ts`.
   - Edge Functions → Secrets: `ANTHROPIC_API_KEY` met je sleutel van console.anthropic.com.
   - Zonder deze functie leest de telefoon zelf de foto (Tesseract); dat werkt, maar minder betrouwbaar.

## Starten en testen

```bash
npm start
```

Open http://localhost:8124.

```bash
npm test
```

## Opbouw

| Bestand | Inhoud |
|---|---|
| `app.js` | Schermen en bediening |
| `logic.js` | Verdeling, saldi en overboekingen, zonder scherm of opslag |
| `data.js` | Supabase: inloggen, auto's, ritten, tankbeurten, betalingen |
| `ocr.js` | Kilometerstand van een foto lezen |
| `config.js` | Adres en publieke sleutel van Supabase |
| `supabase/schema.sql` | Tabellen (`km_…`), beveiliging en functies |
| `supabase/functions/lees-kmstand` | Edge Function die de foto door Claude laat lezen |
| `sw.js` | Offline openen; nieuwe versies komen vanzelf door |
| `tools/make-icons.mjs` | Tekent de app-iconen (`npm run icons`) |

Bedragen staan overal als hele centen opgeslagen.
