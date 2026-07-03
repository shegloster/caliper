# Caliper: Deployment Runbook

Everything code-side is already written in this project. What's left is
account setup and configuration, done through each service's dashboard.
Steps below, in order. Each is marked who does it.

---

## 1. Supabase project (YOU DO THIS)

1. Go to supabase.com → New project. Pick a region (EU West is usually
   fastest from Nigeria; check latency once it's up).
2. Once created, open the SQL Editor and run the entire contents of
   `supabase/schema.sql`. This creates every table, the auto-profile
   trigger, the response-cap trigger, RLS policies, and the access-code
   redemption function.
3. Go to Project Settings → API. Copy:
   - **Project URL**
   - **anon public key**
   - **service_role key** (keep this one secret, used only in Edge
     Functions, never in the frontend)

---

## 2. Google sign-in (YOU DO THIS)

1. **Google Cloud Console** → APIs & Services → Credentials → Create
   OAuth 2.0 Client ID (Web application).
2. Authorized redirect URI:
   `https://<your-project-ref>.supabase.co/auth/v1/callback`
3. **Supabase Dashboard** → Authentication → Providers → Google → paste
   in the Client ID and Client Secret from step 1, enable it.

No code changes needed. `Login.jsx` already calls
`supabase.auth.signInWithOAuth({ provider: 'google' })`.

---

## 3. Resend (transactional email) (YOU DO THIS)

1. Sign up at resend.com, add your domain.
2. Add the DKIM/SPF/DMARC TXT records Resend gives you, through
   Whogohost's DNS panel for your domain.
3. Once verified, generate an API key.
4. **Supabase Dashboard** → Authentication → Settings → SMTP Settings →
   enable custom SMTP:
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: your Resend API key
   - Sender: `noreply@yourdomain.com`

This fixes signup confirmation and password reset emails immediately.

---

## 4. Deploy the Edge Functions (YOU RUN THESE COMMANDS)

Requires the Supabase CLI (`npm install -g supabase`).

```bash
supabase login
supabase link --project-ref <your-project-ref>

supabase secrets set RESEND_API_KEY=re_xxxxx
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
# Paystack secrets can wait until full rollout:
# supabase secrets set PAYSTACK_SECRET_KEY=sk_xxxxx

supabase functions deploy send-email
supabase functions deploy parse-draft
# Hold off deploying these two until you're ready for real payments:
# supabase functions deploy initialize-payment
# supabase functions deploy paystack-webhook
```

---

## 5. Configure the frontend (YOU DO THIS)

1. Copy `.env.example` to `.env` and fill in your Supabase URL and anon
   key from step 1.
2. Locally, confirm it runs:
   ```bash
   npm install
   npm run dev
   ```

---

## 6. Deploy to Netlify (YOU DO THIS)

1. Push this project to a GitHub repo.
2. Netlify → Add new site → Import from Git → select the repo.
   `netlify.toml` already sets the build command and publish directory.
3. In Netlify → Site settings → Environment variables, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as
   your `.env`).
4. Deploy. Netlify gives you a `*.netlify.app` URL immediately.
5. Once you've picked a domain, add it under Domain settings, then point
   it at Netlify through Whogohost's DNS panel (same pattern as
   `ooladehinde.com`).

---

## 7. Issue your first access code (YOU DO THIS)

In the Supabase SQL Editor:

```sql
insert into access_codes (code, kind, max_redemptions, note)
values ('INSTR-7F2K9', 'instrument', 1, 'first test student');
```

Hand that code to a real student and watch the whole loop work.

---

## What's still mocked / not yet built

- **Paystack**: functions are written (`initialize-payment`,
  `paystack-webhook`) but intentionally left undeployed. Access codes
  cover unlocking for now.
- **Draft-parsing library reliability**: `parse-draft` uses `mammoth`
  (docx) and `unpdf` (pdf) inside the Deno edge runtime. These weren't
  executed against a real file before deployment (no way to test the
  actual Supabase edge runtime from where this was built). Test with a
  real .docx and .pdf upload first, and check the function logs in the
  Supabase dashboard if either format fails to extract text.
- **Anthropic API key**: needs an active key with billing enabled on
  your Anthropic account, set as the `ANTHROPIC_API_KEY` secret above.

## What this project already does end-to-end

Register or sign in with Google → create an instrument, either blank or
by uploading a .docx/.pdf draft → an unlocked instrument gets its draft
auto-parsed into questions and constructs, flagged "needs review" until
confirmed → add/edit/delete questions manually too → publish → share the
public `/form/:id` link → a respondent submits → you see it in Responses
→ redeem an access code to unlock scoring, stats, and CSV export.
