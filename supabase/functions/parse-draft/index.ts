// supabase/functions/parse-draft/index.ts
//
// Takes an uploaded .docx/.pdf already sitting in the 'drafts' storage
// bucket, extracts its text, and asks Claude to turn it into structured
// questions, sections, constructs (with IV/DV role where inferable), and
// front/back matter (introduction, consent, closing note). Every parsed
// question is inserted with needs_review = true, the student confirms
// each one in the Builder before it counts as real.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import mammoth from "npm:mammoth@1.7.2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.11.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Mirrors src/lib/scalePresets.js on the frontend. Kept in sync manually
// since Edge Functions can't import from the Vite src tree.
const SCALE_PRESETS: Record<string, { min: number; max: number; labels: string[] | null }> = {
  agreement5: { min: 1, max: 5, labels: ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"] },
  agreement7: { min: 1, max: 7, labels: ["Strongly Disagree", "Disagree", "Somewhat Disagree", "Neutral", "Somewhat Agree", "Agree", "Strongly Agree"] },
  frequency5: { min: 1, max: 5, labels: ["Never", "Rarely", "Sometimes", "Often", "Always"] },
  satisfaction5: { min: 1, max: 5, labels: ["Very Dissatisfied", "Dissatisfied", "Neutral", "Satisfied", "Very Satisfied"] },
  likelihood5: { min: 1, max: 5, labels: ["Very Unlikely", "Unlikely", "Neutral", "Likely", "Very Likely"] },
  quality5: { min: 1, max: 5, labels: ["Very Poor", "Poor", "Fair", "Good", "Excellent"] },
  custom: { min: 1, max: 5, labels: null },
};

const PARSE_SYSTEM_PROMPT = `You extract the full structure of a research questionnaire draft from its raw text.

Respond with ONLY valid JSON, no markdown fences, no prose, no preamble, no
explanation before or after. Your entire response must be parseable by
JSON.parse() with nothing else in it, in this exact shape:

{
  "introduction": "string or null, the study purpose / instructions to respondents if present in the draft",
  "consent_text": "string or null, an informed consent statement if the draft contains or implies one",
  "closing_note": "string or null, a thank-you / closing statement if present",
  "constructs": [{ "name": "string", "role": "independent" | "dependent" | null }],
  "questions": [
    {
      "text": "string, the question exactly as written, cleaned of numbering",
      "section": "string or null, the section heading this item falls under (e.g. Demographics, Section A)",
      "type": "likert" | "mcq" | "open" | "demographic",
      "construct_name": "string matching a name in constructs, or null",
      "scale_type": "agreement5" | "agreement7" | "frequency5" | "satisfaction5" | "likelihood5" | "quality5" | "custom" | null,
      "scale_min": number or null,
      "scale_max": number or null
    }
  ]
}

Rules:
- Default attitude/opinion statements to type "likert" even if the source
  document doesn't show explicit numbers next to them, that is the normal
  way such items are written in a paper draft, respondents will answer on
  a scale rather than type free text. Only use "open" for items that
  clearly expect a written answer (e.g. "Please describe...", "Comments:").
  Use "demographic" for items like age, gender, occupation.
- For every "likert" item, choose the closest matching scale_type from the
  list above based on what the item is actually asking (agreement,
  frequency, satisfaction, likelihood, quality). If the draft shows an
  explicit scale that doesn't match any preset (e.g. a 10-point scale),
  use "custom" and set scale_min/scale_max to match it. If a preset is
  used, still set scale_min/scale_max to that preset's own range.
  Default to "agreement5" (1 to 5) when genuinely unsure.
- Group related items into constructs based on the draft's own section
  headers or subscale labels where present. If the draft has no explicit
  sections, infer 2-4 sensible thematic groupings from the content itself.
  Demographic and open-text items get construct_name: null.
- Set a construct's "role" to "independent" or "dependent" only when the
  draft's own wording makes this reasonably clear (e.g. explicit labeling,
  or a clear predictor-vs-outcome framing in section headers). Otherwise
  use null and let the researcher assign it manually.
- Set each question's "section" to the nearest preceding section heading
  in the source document, if any. Use null if the draft has no sections.
- Do not guess which items are reverse-coded. Leave that for the researcher.
- Preserve the original order of items.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const authedClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await authedClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: CORS_HEADERS });
    }

    const { instrument_id, file_path } = await req.json();
    if (!instrument_id || !file_path) {
      return new Response(JSON.stringify({ error: "instrument_id and file_path are required" }), { status: 400, headers: CORS_HEADERS });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: instrument } = await admin.from("instruments").select("*").eq("id", instrument_id).single();
    if (!instrument || instrument.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Instrument not found" }), { status: 404, headers: CORS_HEADERS });
    }

    const { data: fileBlob, error: downloadError } = await admin.storage.from("drafts").download(file_path);
    if (downloadError || !fileBlob) {
      return new Response(JSON.stringify({ error: "Could not read uploaded file" }), { status: 500, headers: CORS_HEADERS });
    }

    const buffer = new Uint8Array(await fileBlob.arrayBuffer());
    let draftText = "";

    if (file_path.toLowerCase().endsWith(".pdf")) {
      const pdf = await getDocumentProxy(buffer);
      const { text } = await extractText(pdf, { mergePages: true });
      draftText = text;
    } else {
      const result = await mammoth.extractRawText({ buffer });
      draftText = result.value;
    }

    if (!draftText || draftText.trim().length < 20) {
      return new Response(JSON.stringify({ error: "Couldn't extract readable text from this file" }), { status: 422, headers: CORS_HEADERS });
    }

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 8000,
        system: PARSE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: draftText.slice(0, 40000) }],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("Anthropic API error:", errText);
      return new Response(JSON.stringify({ error: "Parsing failed" }), { status: 502, headers: CORS_HEADERS });
    }

    const aiData = await aiRes.json();
    console.log("Anthropic response stop_reason:", aiData.stop_reason, "| content blocks:", (aiData.content ?? []).map((b: any) => b.type).join(","), "| model:", aiData.model);
    const textBlock = (aiData.content ?? []).find((b: any) => b.type === "text");
    const rawText = textBlock?.text ?? "";

    if (!rawText.trim()) {
      console.error("Empty response from Anthropic. Full response was:", JSON.stringify(aiData));
      return new Response(JSON.stringify({ error: "Model returned an empty response. Check function logs for the full API response." }), { status: 502, headers: CORS_HEADERS });
    }

    let parsed;
    try {
      const start = rawText.indexOf("{");
      const end = rawText.lastIndexOf("}");
      if (start === -1 || end === -1 || end < start) throw new Error("no JSON object found");
      const jsonSlice = rawText.slice(start, end + 1);
      parsed = JSON.parse(jsonSlice);
    } catch (parseErr) {
      console.error("Could not parse model output. Raw response was:", rawText);
      return new Response(JSON.stringify({ error: "Model returned unexpected format" }), { status: 502, headers: CORS_HEADERS });
    }

    const { data: existingConstructs } = await admin.from("constructs").select("*").eq("instrument_id", instrument_id);
    const nameToId = new Map((existingConstructs ?? []).map((c) => [c.name, c.id]));

    const constructColors = ["#3E6B8C", "#B8722A", "#4B6B54", "#6B4160"];
    let colorIdx = nameToId.size;
    const newConstructs = (parsed.constructs ?? []).filter((c: any) => !nameToId.has(c.name));
    if (newConstructs.length) {
      const { data: inserted } = await admin
        .from("constructs")
        .insert(newConstructs.map((c: any) => ({
          instrument_id,
          name: c.name,
          color: constructColors[colorIdx++ % constructColors.length],
          role: c.role === "independent" || c.role === "dependent" ? c.role : null,
        })))
        .select();
      (inserted ?? []).forEach((c) => nameToId.set(c.name, c.id));
    }

    const { data: existingQuestions } = await admin.from("questions").select("id").eq("instrument_id", instrument_id);
    let orderIndex = existingQuestions?.length ?? 0;

    const questionRows = (parsed.questions ?? []).map((q: any) => {
      const isLikert = q.type === "likert";
      const presetKey = isLikert && SCALE_PRESETS[q.scale_type] ? q.scale_type : "agreement5";
      const preset = SCALE_PRESETS[presetKey];
      const useCustomRange = presetKey === "custom" && q.scale_min != null && q.scale_max != null;
      return {
        instrument_id,
        construct_id: q.construct_name ? nameToId.get(q.construct_name) ?? null : null,
        order_index: orderIndex++,
        text: q.text,
        section: q.section || null,
        type: q.type,
        scale_type: isLikert ? presetKey : null,
        scale_min: isLikert ? (useCustomRange ? q.scale_min : preset.min) : null,
        scale_max: isLikert ? (useCustomRange ? q.scale_max : preset.max) : null,
        scale_labels: isLikert ? preset.labels : null,
        weight: 1,
        reverse_coded: false,
        needs_review: true,
      };
    });

    if (questionRows.length) {
      await admin.from("questions").insert(questionRows);
    }

    const instrumentUpdate: Record<string, unknown> = { draft_file_path: file_path };
    if (!instrument.introduction && parsed.introduction) instrumentUpdate.introduction = parsed.introduction;
    if (!instrument.consent_text && parsed.consent_text) instrumentUpdate.consent_text = parsed.consent_text;
    if (!instrument.closing_note && parsed.closing_note) instrumentUpdate.closing_note = parsed.closing_note;
    await admin.from("instruments").update(instrumentUpdate).eq("id", instrument_id);

    return new Response(JSON.stringify({
      questionCount: questionRows.length,
      constructCount: newConstructs.length,
    }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500, headers: CORS_HEADERS });
  }
});
