// supabase/functions/initialize-payment/index.ts
//
// Called from the client when a student picks a payment option in the
// paywall modal. Starts a Paystack transaction server-side so the amount
// can never be tampered with from the browser, then returns the
// authorization_url for the client to redirect to.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PAYSTACK_SECRET_KEY = Deno.env.get("PAYSTACK_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// Prices live here, not on the client — never trust an amount sent by the browser.
const PRICES: Record<string, number> = {
  instrument: 800000,   // ₦8,000 in kobo
  semester: 1500000,    // ₦15,000 in kobo
};

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 });
    }

    const { kind, instrument_id } = await req.json();
    // kind: 'instrument' | 'semester'

    if (!PRICES[kind]) {
      return new Response(JSON.stringify({ error: "Invalid payment kind" }), { status: 400 });
    }

    if (kind === "instrument") {
      if (!instrument_id) {
        return new Response(JSON.stringify({ error: "instrument_id required" }), { status: 400 });
      }
      // confirm the instrument actually belongs to this user before charging them
      const { data: instrument } = await supabase
        .from("instruments")
        .select("id, owner_id, unlocked")
        .eq("id", instrument_id)
        .single();
      if (!instrument || instrument.owner_id !== user.id) {
        return new Response(JSON.stringify({ error: "Instrument not found" }), { status: 404 });
      }
      if (instrument.unlocked) {
        return new Response(JSON.stringify({ error: "Already unlocked" }), { status: 400 });
      }
    }

    const amount = PRICES[kind];
    const reference = `${kind}_${user.id}_${Date.now()}`;

    const paystackRes = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: user.email,
        amount,
        reference,
        metadata: {
          user_id: user.id,
          kind,                                   // 'instrument' | 'semester'
          instrument_id: kind === "instrument" ? instrument_id : null,
        },
      }),
    });

    const paystackData = await paystackRes.json();
    if (!paystackData.status) {
      return new Response(JSON.stringify({ error: paystackData.message ?? "Paystack initialization failed" }), { status: 502 });
    }

    return new Response(JSON.stringify({
      authorization_url: paystackData.data.authorization_url,
      reference,
    }), { headers: { "Content-Type": "application/json" } });

  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500 });
  }
});
