// supabase/functions/send-email/index.ts
//
// General-purpose transactional email sender, used for anything outside
// Supabase's built-in auth emails — access code delivery, unlock
// confirmations, response-cap warnings, etc.
//
// Call it from other Edge Functions (server-to-server, using the service
// role) or from the client with the user's session — either way, callers
// pass a `template` name, not raw HTML, so copy stays centralized here.

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_ADDRESS = "Caliper <noreply@usecaliper.com>";

type Template = "access_code" | "instrument_unlocked" | "response_cap_reached";

function renderTemplate(template: Template, data: Record<string, string>) {
  switch (template) {
    case "access_code":
      return {
        subject: "Your Caliper access code",
        html: `
          <p>Hi ${data.name},</p>
          <p>Here's your access code:</p>
          <p style="font-family: monospace; font-size: 20px; letter-spacing: 2px;">${data.code}</p>
          <p>Enter it in Caliper under "Unlock" to activate ${data.kind === "semester" ? "your semester pass" : "this instrument"}.</p>
        `,
      };
    case "instrument_unlocked":
      return {
        subject: `"${data.instrumentTitle}" is unlocked`,
        html: `
          <p>Hi ${data.name},</p>
          <p>"${data.instrumentTitle}" now has unlimited responses, full scoring, and export enabled.</p>
        `,
      };
    case "response_cap_reached":
      return {
        subject: `"${data.instrumentTitle}" has reached its free response limit`,
        html: `
          <p>Hi ${data.name},</p>
          <p>"${data.instrumentTitle}" has collected ${data.count} responses and hit the free limit.
          Unlock it in Caliper to keep collecting.</p>
        `,
      };
  }
}

Deno.serve(async (req) => {
  try {
    const { to, template, data } = await req.json();

    if (!to || !template) {
      return new Response(JSON.stringify({ error: "to and template are required" }), { status: 400 });
    }

    const { subject, html } = renderTemplate(template, data ?? {});

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("Resend error:", err);
      return new Response(JSON.stringify({ error: "Send failed" }), { status: 502 });
    }

    return new Response(JSON.stringify({ status: "sent" }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Unexpected error" }), { status: 500 });
  }
});
