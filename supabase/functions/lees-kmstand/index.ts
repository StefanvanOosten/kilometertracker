// Supabase Edge Function: leest de kilometerstand van een foto van het dashboard met Claude.
// Alleen ingelogde gebruikers kunnen hem aanroepen (Supabase controleert het JWT).
// Benodigd geheim: ANTHROPIC_API_KEY (Supabase > Edge Functions > Secrets).
import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";

const client = new Anthropic();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SCHEMA = {
  type: "object",
  properties: {
    leesbaar: { type: "boolean", description: "true als de totale kilometerstand duidelijk te lezen is" },
    stand: { type: ["integer", "null"], description: "De totale kilometerstand (odometer) in hele kilometers" },
    dagteller: { type: ["number", "null"], description: "De dagteller (trip) als die ook zichtbaar is" },
  },
  required: ["leesbaar", "stand", "dagteller"],
  additionalProperties: false,
};

const antwoord = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return antwoord({ fout: "Alleen POST" }, 405);

  let invoer: { afbeelding?: string; mediaType?: string; vorigeStand?: number | null };
  try {
    invoer = await req.json();
  } catch {
    return antwoord({ fout: "Ongeldige invoer" }, 400);
  }
  const { afbeelding, mediaType = "image/jpeg", vorigeStand } = invoer;
  if (!afbeelding || afbeelding.length > 8_000_000) return antwoord({ fout: "Geen of te grote foto" }, 400);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) return antwoord({ fout: "Onbekend beeldformaat" }, 400);

  const hint = Number.isInteger(vorigeStand)
    ? `De vorige bekende kilometerstand was ${vorigeStand}; de nieuwe stand is meestal iets hoger.`
    : "";

  try {
    const response = await client.beta.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: afbeelding } },
          {
            type: "text",
            text: "Dit is een foto van het dashboard van een auto. Lees de totale kilometerstand (odometer) af, " +
              "niet de dagteller (trip) en niet de snelheid of actieradius. Geef alleen hele kilometers. " +
              `${hint} Zet leesbaar op false als je de stand niet met zekerheid kunt lezen.`,
          },
        ],
      }],
    } as never);

    if (response.stop_reason === "refusal") return antwoord({ fout: "Foto niet verwerkt" }, 422);
    const tekst = response.content.find((b: { type: string }) => b.type === "text") as { text: string } | undefined;
    if (!tekst) return antwoord({ fout: "Geen antwoord" }, 502);
    return antwoord(JSON.parse(tekst.text));
  } catch (fout) {
    console.error(fout);
    return antwoord({ fout: "Uitlezen mislukt" }, 502);
  }
});
