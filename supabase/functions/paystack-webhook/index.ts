// supabase/functions/paystack-webhook/index.ts
//
// Paystack calls this URL after every transaction event. We verify the
// signature so we know the request genuinely came from Paystack, then
// unlock the instrument or activate the subscription using the service
// role key (this function runs server-side only, key is never exposed
// to the client).
//
// Set this URL in the Paystack dashboard:
// Settings -> API Keys & Webhooks -> Webhook URL
// https://<project-ref>.supabase.co/functions/v1/paystack-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(PAYSTACK_SECRET_KEY),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"]
  );
  const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(sigBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === signature;
}

Deno.serve(async (req) => {
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature");

  const valid = await verifySignature(rawBody, signature);
  if (!valid) {
    return new Response("Invalid signature", { status: 401 });
  }

  const event = JSON.parse(rawBody);

  if (event.event !== "charge.success") {
    // Ignore every other event type (refunds, disputes, etc. can be added later)
    return new Response("ok", { status: 200 });
  }

  const { reference, amount, metadata } = event.data;
  const { user_id, kind, instrument_id } = metadata;

  // Record the payment, idempotently — Paystack can retry the same webhook
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("provider_reference", reference)
    .maybeSingle();

  if (existing) {
    return new Response("already processed", { status: 200 });
  }

  await supabase.from("payments").insert({
    user_id,
    instrument_id: kind === "instrument" ? instrument_id : null,
    amount: amount / 100,
    provider: "paystack",
    provider_reference: reference,
    status: "success",
  });

  if (kind === "instrument") {
    await supabase
      .from("instruments")
      .update({ unlocked: true, unlock_source: "per_instrument" })
      .eq("id", instrument_id);
  }

  if (kind === "semester") {
    const periodEnd = new Date();
    periodEnd.setDate(periodEnd.getDate() + 120);

    await supabase.from("subscriptions").insert({
      user_id,
      plan: "semester",
      status: "active",
      current_period_end: periodEnd.toISOString(),
    });

    await supabase
      .from("profiles")
      .update({ plan_tier: "subscription", subscription_expires_at: periodEnd.toISOString() })
      .eq("id", user_id);
  }

  return new Response("ok", { status: 200 });
});
