-- =========================================================
-- CALIPER — Supabase schema
-- Auth: Supabase Auth (email/password + Google OAuth)
-- =========================================================

-- ---------------------------------------------------------
-- 1. PROFILES
-- One row per auth.users entry. Created automatically on signup
-- (email or Google) via the trigger at the bottom of this file.
-- ---------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  institution text,
  avatar_url text,
  plan_tier text not null default 'free',           -- 'free' | 'subscription'
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 2. INSTRUMENTS  (a questionnaire)
-- ---------------------------------------------------------
create table instruments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  title text not null default 'Untitled instrument',
  status text not null default 'Draft',              -- 'Draft' | 'Live'
  unlocked boolean not null default false,
  unlock_source text,                                 -- 'per_instrument' | 'subscription' | null
  draft_file_path text,                                -- storage path to the uploaded .docx/.pdf, if any
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 3. CONSTRUCTS  (scoring subscales, e.g. "Health Literacy")
-- ---------------------------------------------------------
create table constructs (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  name text not null,
  color text
);

-- ---------------------------------------------------------
-- 4. QUESTIONS
-- ---------------------------------------------------------
create table questions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  construct_id uuid references constructs(id) on delete set null,
  order_index int not null default 0,
  text text not null,
  type text not null,                                  -- 'likert' | 'mcq' | 'open' | 'demographic'
  options jsonb,                                        -- for 'mcq'
  scale_min int,
  scale_max int,
  weight numeric not null default 1,
  reverse_coded boolean not null default false,
  needs_review boolean not null default false           -- true for AI-parsed items awaiting confirmation
);

-- ---------------------------------------------------------
-- 5. RESPONDENTS + RESPONSES
-- Respondents fill the public form anonymously (no auth.users row).
-- ---------------------------------------------------------
create table respondents (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references instruments(id) on delete cascade,
  submitted_at timestamptz not null default now()
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  respondent_id uuid not null references respondents(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  raw_value jsonb not null
);

-- ---------------------------------------------------------
-- 6. BILLING
-- ---------------------------------------------------------
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  plan text not null,                                   -- 'semester' | 'monthly'
  status text not null default 'active',                -- 'active' | 'expired' | 'cancelled'
  started_at timestamptz not null default now(),
  current_period_end timestamptz not null
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  instrument_id uuid references instruments(id) on delete set null,  -- null for subscription payments
  subscription_id uuid references subscriptions(id) on delete set null,
  amount numeric not null,
  provider text not null,                               -- 'paystack' | 'flutterwave'
  provider_reference text,
  status text not null default 'pending',               -- 'pending' | 'success' | 'failed'
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------
-- 7. AUTO-CREATE A PROFILE ON SIGNUP (email or Google)
-- Google OAuth populates raw_user_meta_data with 'full_name' / 'name' and 'avatar_url'.
-- ---------------------------------------------------------
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------
-- 8. RESPONSE CAP — enforced at the database, not just the client
-- Free instruments (not unlocked, owner not subscribed) stop
-- accepting responses at 30. Bypassed for unlocked instruments
-- or owners with an active subscription.
-- ---------------------------------------------------------
create or replace function enforce_response_cap()
returns trigger as $$
declare
  v_instrument instruments%rowtype;
  v_owner profiles%rowtype;
  v_count int;
begin
  select * into v_instrument from instruments where id = new.instrument_id;
  select * into v_owner from profiles where id = v_instrument.owner_id;

  if v_instrument.unlocked
     or (v_owner.plan_tier = 'subscription' and v_owner.subscription_expires_at > now())
  then
    return new;
  end if;

  select count(*) into v_count from respondents where instrument_id = new.instrument_id;
  if v_count >= 30 then
    raise exception 'Free response limit reached for this instrument';
  end if;

  return new;
end;
$$ language plpgsql security definer;

create trigger check_response_cap
  before insert on respondents
  for each row execute function enforce_response_cap();

-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================
alter table profiles enable row level security;
alter table instruments enable row level security;
alter table constructs enable row level security;
alter table questions enable row level security;
alter table respondents enable row level security;
alter table responses enable row level security;
alter table subscriptions enable row level security;
alter table payments enable row level security;

-- PROFILES: a user can read and update only their own profile
create policy "profiles_select_own" on profiles for select using (auth.uid() = id);
create policy "profiles_update_own" on profiles for update using (auth.uid() = id);

-- INSTRUMENTS: owners have full control over their own instruments
create policy "instruments_owner_all" on instruments
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- INSTRUMENTS: anyone (including anonymous respondents) can read
-- an instrument's public fields if it's Live, so the form can render
create policy "instruments_public_read_live" on instruments
  for select using (status = 'Live');

-- CONSTRUCTS / QUESTIONS: owners manage their own; anyone can read
-- constructs/questions belonging to a Live instrument (to render the form)
create policy "constructs_owner_all" on constructs
  for all using (auth.uid() = (select owner_id from instruments where id = instrument_id))
  with check (auth.uid() = (select owner_id from instruments where id = instrument_id));

create policy "constructs_public_read_live" on constructs
  for select using ((select status from instruments where id = instrument_id) = 'Live');

create policy "questions_owner_all" on questions
  for all using (auth.uid() = (select owner_id from instruments where id = instrument_id))
  with check (auth.uid() = (select owner_id from instruments where id = instrument_id));

create policy "questions_public_read_live" on questions
  for select using ((select status from instruments where id = instrument_id) = 'Live');

-- RESPONDENTS: anyone can submit (insert) to a Live instrument.
-- Only the instrument owner can read the list of respondents.
create policy "respondents_public_insert_live" on respondents
  for insert with check ((select status from instruments where id = instrument_id) = 'Live');

create policy "respondents_owner_select" on respondents
  for select using (auth.uid() = (select owner_id from instruments where id = instrument_id));

-- RESPONSES: anyone can submit answers tied to a respondent they just created.
-- Only the instrument owner can read response data.
create policy "responses_public_insert" on responses
  for insert with check (
    (select status from instruments i join questions q on q.instrument_id = i.id where q.id = question_id) = 'Live'
  );

create policy "responses_owner_select" on responses
  for select using (
    auth.uid() = (
      select i.owner_id from instruments i
      join questions q on q.instrument_id = i.id
      where q.id = question_id
    )
  );

-- SUBSCRIPTIONS / PAYMENTS: users see only their own billing records.
-- Inserts/updates happen via a service-role Edge Function after
-- verifying the Paystack/Flutterwave webhook, never directly from the client.
create policy "subscriptions_owner_select" on subscriptions for select using (auth.uid() = user_id);
create policy "payments_owner_select" on payments for select using (auth.uid() = user_id);

-- =========================================================
-- ACCESS CODES — manual unlock path for pre-launch phase.
-- Replaces the Paystack flow for now; same end state (instruments.unlocked
-- or profiles.plan_tier = 'subscription'). Swap back to the webhook-driven
-- flow at full rollout without touching this table structure.
-- =========================================================
create table access_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  kind text not null,                                 -- 'instrument' | 'semester'
  instrument_id uuid references instruments(id),       -- set only if this code is pre-bound to one instrument
  max_redemptions int not null default 1,
  redemption_count int not null default 0,
  expires_at timestamptz,
  note text,                                            -- e.g. "issued to Chidinma, WhatsApp request 2 Jul"
  created_at timestamptz not null default now()
);

create table access_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references access_codes(id),
  user_id uuid not null references profiles(id),
  instrument_id uuid references instruments(id),
  redeemed_at timestamptz not null default now()
);

alter table access_codes enable row level security;
alter table access_code_redemptions enable row level security;

-- Students never read the codes table directly (they'd see every code that
-- exists) — redemption happens only through the function below.
create policy "access_codes_no_direct_access" on access_codes for select using (false);

create policy "redemptions_owner_select" on access_code_redemptions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------
-- redeem_access_code — the only way a code gets used.
-- Call from the client as:
--   supabase.rpc('redeem_access_code', { p_code: 'INSTR-7F2K9', p_instrument_id: '...' })
-- p_instrument_id is required for 'instrument' codes not already bound to one.
-- ---------------------------------------------------------
create or replace function redeem_access_code(p_code text, p_instrument_id uuid default null)
returns text as $$
declare
  v_code access_codes%rowtype;
  v_target_instrument uuid;
  v_period_end timestamptz;
begin
  select * into v_code from access_codes where upper(code) = upper(p_code) for update;

  if not found then
    return 'invalid_code';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    return 'expired_code';
  end if;
  if v_code.redemption_count >= v_code.max_redemptions then
    return 'code_already_used';
  end if;

  if v_code.kind = 'instrument' then
    v_target_instrument := coalesce(v_code.instrument_id, p_instrument_id);
    if v_target_instrument is null then
      return 'instrument_required';
    end if;
    if auth.uid() <> (select owner_id from instruments where id = v_target_instrument) then
      return 'not_owner';
    end if;

    update instruments set unlocked = true, unlock_source = 'per_instrument'
      where id = v_target_instrument;

    insert into access_code_redemptions (code_id, user_id, instrument_id)
      values (v_code.id, auth.uid(), v_target_instrument);

  elsif v_code.kind = 'semester' then
    v_period_end := now() + interval '120 days';

    update profiles set plan_tier = 'subscription', subscription_expires_at = v_period_end
      where id = auth.uid();

    insert into subscriptions (user_id, plan, status, current_period_end)
      values (auth.uid(), 'semester', 'active', v_period_end);

    insert into access_code_redemptions (code_id, user_id)
      values (v_code.id, auth.uid());
  else
    return 'unknown_code_kind';
  end if;

  update access_codes set redemption_count = redemption_count + 1 where id = v_code.id;
  return 'success';
end;
$$ language plpgsql security definer;

-- ---------------------------------------------------------
-- Issuing a code — run this yourself in the Supabase SQL editor,
-- signed in with the project (not a student). No admin UI needed yet.
-- Example: a single-use instrument-unlock code
--
--   insert into access_codes (code, kind, max_redemptions, note)
--   values ('INSTR-7F2K9', 'instrument', 1, 'Chidinma, WhatsApp request 2 Jul');
--
-- Example: a semester-pass code good for 5 students
--
--   insert into access_codes (code, kind, max_redemptions, note)
--   values ('SEM-EARLY01', 'semester', 5, 'Early access cohort');
-- ---------------------------------------------------------

-- =========================================================
-- STORAGE — bucket for uploaded draft questionnaires (.docx/.pdf)
-- Path convention: {user_id}/{instrument_id}_{timestamp}_{filename}
-- so a user can only touch objects under their own folder.
-- =========================================================
insert into storage.buckets (id, name, public)
values ('drafts', 'drafts', false)
on conflict (id) do nothing;

create policy "drafts_insert_own" on storage.objects
  for insert with check (bucket_id = 'drafts' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "drafts_select_own" on storage.objects
  for select using (bucket_id = 'drafts' and (storage.foldername(name))[1] = auth.uid()::text);

-- =========================================================
-- MIGRATION: standard questionnaire structure
-- Run this once in the SQL editor on your existing project.
-- Adds: instrument front/back matter, question sections and
-- labeled scale presets, construct IV/DV role.
-- =========================================================
alter table instruments add column if not exists introduction text;
alter table instruments add column if not exists consent_text text;
alter table instruments add column if not exists closing_note text;

alter table questions add column if not exists section text;
alter table questions add column if not exists scale_type text; -- preset key, or 'custom'
alter table questions add column if not exists scale_labels jsonb; -- array of point labels, e.g. ["Strongly Disagree", ..., "Strongly Agree"]

alter table constructs add column if not exists role text; -- 'independent' | 'dependent' | null
