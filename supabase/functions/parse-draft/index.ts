// supabase/functions/parse-draft/index.ts
//
// Takes an uploaded .docx/.pdf already sitting in the 'drafts' storage
// bucket, extracts its text, and asks Claude to turn it into structured
// questions. Every parsed question is inserted with needs_review = true —
// the student confirms each one in the Builder before it counts as real.
//
// NOTE ON LIBRARY COMPATIBILITY: docx/pdf text extraction inside a Deno
// edge runtime is the one part of this function I could not actually
// execute and verify end-to-end (no network access to npm registries or
// the Supabase Edge runtime from where this was written). mammoth and
// unpdf are the right tools for the job and are Deno-npm-compatible in
// principle, but test this function against a real uploaded file before
// trusting it in production — if either import fails to resolve at
// deploy time, that's the first thing to debug.

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

const PARSE_SYSTEM_PROMPT = `You extract questionnaire items from a research draft's raw text.

Respond with ONLY valid JSON, no markdown fences, no prose, in this exact shape:

{
  "constructs": [{ "name": "string" }],
  "questions": [
    {
      "text": "string, the question exactly as written, cleaned of numbering",
      "type": "likert" | "mcq" | "open" | "demographic",
      "construct_name": "string matching a name in constructs, or null",
      "scale_min": number or null,
      "scale_max": number or null
    }
  ]
}

Rules:
- Only include scale_min/scale_max for "likert" items. Infer the scale from
  the draft (e.g. "1=Strongly Disagree...5=Strongly Agree" means 1 to 5).
  Default to 1-5 if a Likert item's scale isn't explicit.
- Group related items into constructs based on the draft's own section
  headers or subscale labels where present. If the draft has no explicit
  sections, infer 2-4 sensible thematic groupings from the content itself.
  Demographic and open-text items get construct_name: null.
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

    // service-role client for storage download + writes below
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
      // .docx (and .doc, best-effort)
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
        max_tokens: 4000,
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
    const rawText = aiData.content?.[0]?.text ?? "";
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/```json|```/g, "").trim());
    } catch {
      console.error("Could not parse model output:", rawText);
      return new Response(JSON.stringify({ error: "Model returned unexpected format" }), { status: 502, headers: CORS_HEADERS });
    }

    // Upsert constructs by name (avoid duplicating on re-upload)
    const { data: existingConstructs } = await admin.from("constructs").select("*").eq("instrument_id", instrument_id);
    const nameToId = new Map((existingConstructs ?? []).map((c) => [c.name, c.id]));

    const constructColors = ["#3E6B8C", "#B8722A", "#4B6B54", "#6B4160"];
    let colorIdx = nameToId.size;
    const newConstructs = (parsed.constructs ?? []).filter((c) => !nameToId.has(c.name));
    if (newConstructs.length) {
      const { data: inserted } = await admin
        .from("constructs")
        .insert(newConstructs.map((c) => ({ instrument_id, name: c.name, color: constructColors[colorIdx++ % constructColors.length] })))
        .select();
      (inserted ?? []).forEach((c) => nameToId.set(c.name, c.id));
    }

    const { data: existingQuestions } = await admin.from("questions").select("id").eq("instrument_id", instrument_id);
    let orderIndex = existingQuestions?.length ?? 0;

    const questionRows = (parsed.questions ?? []).map((q) => ({
      instrument_id,
      construct_id: q.construct_name ? nameToId.get(q.construct_name) ?? null : null,
      order_index: orderIndex++,
      text: q.text,
      type: q.type,
      scale_min: q.type === "likert" ? (q.scale_min ?? 1) : null,
      scale_max: q.type === "likert" ? (q.scale_max ?? 5) : null,
      weight: 1,
      reverse_coded: false,
      needs_review: true,
    }));

    if (questionRows.length) {
      await admin.from("questions").insert(questionRows);
    }

    await admin.from("instruments").update({ draft_file_path: file_path }).eq("id", instrument_id);

    return new Response(JSON.stringify({
      questionCount: questionRows.length,
      constructCount: newConstructs.length,
    }), { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500, headers: CORS_HEADERS });
  }
});
