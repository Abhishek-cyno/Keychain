-- Eqova keychains — Postgres schema.
--
-- Run this once, whole, in the Supabase SQL editor. It is idempotent: running
-- it again is safe and changes nothing.
--
-- WHY THIS EXISTS
-- The Google Sheet is a fine record book and a terrible read path. Apps Script
-- answers /exec with a 302 to a single-use googleusercontent.com URL, so every
-- tap costs two connections plus a container cold start — measured at 1.25-2.5s
-- — and the redirect cannot be cached because replaying it 404s. A tap should
-- feel instant, so reads come from here instead. The Sheet stays, and stays in
-- sync, but it is no longer in front of anybody's phone.
--
-- SHAPE OF THE API
-- Everything is a function. No table is reachable from the browser: RLS is on
-- with no policies, which denies everything, and the anon role is granted
-- EXECUTE on functions only. Those functions are SECURITY DEFINER, so they see
-- the table while the caller never can. That is deliberate — it means a column
-- added later (an internal flag, a cost, a supplier note) is private by default
-- rather than public by accident.

create extension if not exists pgcrypto;

/* ================================= TABLE ================================== */

create table if not exists public.keychains (
  -- The number printed on the physical keychain. Sequential, and NOT a way to
  -- reach a profile: it is shown on the claim screen so somebody can check it
  -- against the object in their hand.
  id            integer     primary key,

  -- What is actually in the URL. Unguessable, 10 chars from an alphabet with no
  -- 0/o/1/l/i, because support staff read these off a screen and retype them.
  slug          text        not null unique,

  status        text        not null default 'AVAILABLE'
                            check (status in ('AVAILABLE','ASSIGNED','ACTIVE','BLOCKED')),

  -- The card itself, in display order. NOT NULL with an empty default so that
  -- every value is a string and the sync hash below can never be null.
  title         text        not null default '',
  name          text        not null default '',
  designation   text        not null default '',
  organization  text        not null default '',
  email         text        not null default '',
  mobile        text        not null default '',
  phone         text        not null default '',
  website       text        not null default '',
  address       text        not null default '',
  remarks       text        not null default '',

  -- Staff-only. Never leaves the database through a public function.
  notes         text        not null default '',

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.keychains is
  'One row per physical keychain. Read path for tap.eqova.in; mirrored to the Google Sheet by apps-script/Sync.gs.';

/* ------------------------------- sync hash -------------------------------- */
-- The loop-breaker for two-way sync.
--
-- Without this, mirroring a change to the Sheet makes the Sheet look edited,
-- which mirrors it back, which makes the row look edited again, forever. With
-- it, each side asks "is the other side's content already identical to mine?"
-- and stops. Apps Script computes the same digest over the same fields in the
-- same order, so the two agree on what "identical" means.
--
-- Generated, not trigger-maintained: it then cannot drift from the row it
-- describes, however the row was written.
alter table public.keychains
  drop column if exists card_hash;

alter table public.keychains
  add column card_hash text
  generated always as (
    md5(
      slug         || e'\x1f' || status       || e'\x1f' ||
      title        || e'\x1f' || name         || e'\x1f' ||
      designation  || e'\x1f' || organization || e'\x1f' ||
      email        || e'\x1f' || mobile       || e'\x1f' ||
      phone        || e'\x1f' || website      || e'\x1f' ||
      address      || e'\x1f' || remarks      || e'\x1f' ||
      notes
    )
  ) stored;

-- 0x1F is the ASCII unit separator: it cannot occur in a pasted phone number or
-- address, so "ab"+"c" and "a"+"bc" can never hash alike.

create index if not exists keychains_slug_idx    on public.keychains (slug);
create index if not exists keychains_status_idx  on public.keychains (status);
create index if not exists keychains_updated_idx on public.keychains (updated_at);

/* ------------------------------ normalisation ----------------------------- */
-- Both sides must agree on whitespace or every row looks permanently changed.
-- Trimming here rather than in each caller means it holds for the app, the
-- sheet sync, and anything typed by hand in the SQL editor.

create or replace function public.keychains_normalise()
returns trigger
language plpgsql
as $$
begin
  new.slug         := btrim(coalesce(new.slug, ''));
  new.status       := upper(btrim(coalesce(new.status, 'AVAILABLE')));
  new.title        := btrim(coalesce(new.title, ''));
  new.name         := btrim(coalesce(new.name, ''));
  new.designation  := btrim(coalesce(new.designation, ''));
  new.organization := btrim(coalesce(new.organization, ''));
  new.email        := btrim(coalesce(new.email, ''));
  new.mobile       := btrim(coalesce(new.mobile, ''));
  new.phone        := btrim(coalesce(new.phone, ''));
  new.website      := btrim(coalesce(new.website, ''));
  new.address      := btrim(coalesce(new.address, ''));
  new.remarks      := btrim(coalesce(new.remarks, ''));
  new.notes        := btrim(coalesce(new.notes, ''));
  return new;
end;
$$;

drop trigger if exists keychains_normalise_trg on public.keychains;
create trigger keychains_normalise_trg
  before insert or update on public.keychains
  for each row execute function public.keychains_normalise();

/* =============================== LOCKED DOWN ============================== */
-- RLS on with zero policies denies every row to anon and authenticated. The
-- SECURITY DEFINER functions below bypass it as the table owner. Revoking table
-- privileges as well means a future policy added by accident still grants
-- nothing.

alter table public.keychains enable row level security;

revoke all on public.keychains from anon, authenticated;

/* ------------------------------ staff password ---------------------------- */

create table if not exists public.app_config (
  key   text primary key,
  value text not null
);

alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

/* ================================ HELPERS ================================= */

-- The public shape of a card. Kept in one place so get_card and claim_card can
-- never disagree about what a tap is allowed to see — notes in particular.
create or replace function public.card_json(r public.keychains)
returns json
language sql
stable
as $$
  select json_build_object(
    'slug',      r.slug,
    'number',    r.id,
    'status',    r.status,
    'assigned',  (r.name <> '' and r.status not in ('AVAILABLE','BLOCKED')),
    'claimable', (r.status = 'AVAILABLE' and r.name = '')
  )::jsonb
  || case
       when r.name <> '' and r.status not in ('AVAILABLE','BLOCKED')
       then json_build_object(
              'title',        r.title,
              'name',         r.name,
              'designation',  r.designation,
              'organization', r.organization,
              'email',        r.email,
              'mobile',       r.mobile,
              'phone',        r.phone,
              'website',      r.website,
              'address',      r.address,
              'remarks',      r.remarks
            )::jsonb
       else '{}'::jsonb
     end;
$$;

-- Takes only the ten card fields, ignoring anything else in the payload, and
-- caps each one. Without the caps, whoever holds a slug could push megabytes
-- into the row — and from there into the Sheet.
create or replace function public.card_fields(p jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'title',        left(btrim(coalesce(p->>'title',        '')),   24),
    'name',         left(btrim(coalesce(p->>'name',         '')),  120),
    'designation',  left(btrim(coalesce(p->>'designation',  '')),  120),
    'organization', left(btrim(coalesce(p->>'organization', '')),  160),
    'email',        left(btrim(coalesce(p->>'email',        '')),  160),
    'mobile',       left(btrim(coalesce(p->>'mobile',       '')),   40),
    'phone',        left(btrim(coalesce(p->>'phone',        '')),   40),
    'website',      left(btrim(coalesce(p->>'website',      '')),  300),
    'address',      left(btrim(coalesce(p->>'address',      '')),  400),
    'remarks',      left(btrim(coalesce(p->>'remarks',      '')), 1000)
  );
$$;

create or replace function public.require_password(p_password text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  stored text;
begin
  select value into stored from public.app_config where key = 'admin_password';

  if stored is null then
    raise exception 'NOT_CONFIGURED|No staff password is set.';
  end if;

  -- bcrypt, and the cost is load-bearing. Apps Script accidentally rate-limited
  -- guessing by being slow; a 50ms Postgres reply would not. Cost 12 puts a
  -- single attempt at ~250ms, which no real person notices and which makes
  -- offline-speed guessing against this endpoint impractical.
  if stored <> crypt(coalesce(p_password, ''), stored) then
    raise exception 'BAD_PASSWORD|Wrong password.';
  end if;
end;
$$;

-- Set or change the staff password. Run from the SQL editor, never from the app:
--   select public.set_admin_password('the new password');
create or replace function public.set_admin_password(p_password text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if length(coalesce(p_password, '')) < 8 then
    raise exception 'TOO_SHORT|Use at least 8 characters.';
  end if;

  insert into public.app_config (key, value)
  values ('admin_password', crypt(p_password, gen_salt('bf', 12)))
  on conflict (key) do update set value = excluded.value;

  return 'ok';
end;
$$;

revoke all on function public.set_admin_password(text) from public, anon, authenticated;

/* ============================== PUBLIC READ =============================== */

-- The hot path: one round trip, one index lookup, no redirect.
-- STABLE so PostgREST will serve it over GET, which keeps it a CORS simple
-- request and lets the browser and any CDN in front of it do their job.
create or replace function public.get_card(p_slug text)
returns json
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  r public.keychains;
begin
  select * into r from public.keychains where slug = btrim(lower(p_slug));

  if not found then
    raise exception 'NOT_FOUND|No keychain with that code';
  end if;

  return public.card_json(r);
end;
$$;

/* ================================= CLAIM ================================== */

-- Self-service. Holding the keychain is the authority; there is no password.
--
-- The guard lives in the WHERE clause, so first-tap-wins is a property of the
-- statement rather than of a lock somebody has to remember to take. Two
-- simultaneous claims: one UPDATE matches, the other finds zero rows and is
-- told the keychain is taken.
create or replace function public.claim_card(p_slug text, p_card jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  f jsonb := public.card_fields(p_card);
  r public.keychains;
  existing public.keychains;
begin
  if f->>'name' = '' then
    raise exception 'NAME_REQUIRED|Please enter your name.';
  end if;

  update public.keychains set
    title = f->>'title',              name         = f->>'name',
    designation = f->>'designation',  organization = f->>'organization',
    email = f->>'email',              mobile       = f->>'mobile',
    phone = f->>'phone',              website      = f->>'website',
    address = f->>'address',          remarks      = f->>'remarks',
    status = 'ACTIVE',
    updated_at = now()
  where slug = btrim(lower(p_slug))
    and status = 'AVAILABLE'
    and name = ''
  returning * into r;

  if found then
    return public.card_json(r);
  end if;

  -- Nothing matched. Say why, rather than a generic failure — the three cases
  -- need three different things from the person holding the keychain.
  select * into existing from public.keychains where slug = btrim(lower(p_slug));

  if not found then
    raise exception 'NOT_FOUND|No keychain with that code';
  elsif existing.status = 'BLOCKED' then
    raise exception 'BLOCKED|This keychain is not available.';
  else
    raise exception 'ALREADY_CLAIMED|This keychain has already been set up. Ask the Eqova team if you need it changed.';
  end if;
end;
$$;

/* ================================= ADMIN ================================== */

-- Matches what the dashboard shows today: no email, phone, address, remarks or
-- notes. The dashboard is not behind a login, so it must not become a directory
-- of everybody's contact details.
create or replace function public.admin_list(
  p_q text default '', p_status text default '',
  p_limit integer default 50, p_offset integer default 0
)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  with filtered as (
    select * from public.keychains
     where (coalesce(btrim(p_status), '') = '' or status = upper(btrim(p_status)))
       and (coalesce(btrim(p_q), '') = '' or
            (name || ' ' || organization || ' ' || designation || ' ' || slug || ' ' || id::text)
              ilike '%' || btrim(p_q) || '%')
  )
  select json_build_object(
    'total', (select count(*) from filtered),
    'items', coalesce((
      select json_agg(json_build_object(
        'id', id, 'slug', slug, 'status', status, 'name', name,
        'assigned', (name <> ''),
        'title', title, 'designation', designation, 'organization', organization,
        'updatedAt', updated_at
      ) order by id)
      from (select * from filtered order by id
             limit least(coalesce(p_limit, 50), 500)
            offset greatest(coalesce(p_offset, 0), 0)) page
    ), '[]'::json)
  );
$$;

create or replace function public.admin_stats()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select json_build_object(
    -- Keys match what AdminDashboard reads (stats.AVAILABLE, stats.total).
    -- The Apps Script fallback returns this exact shape, so the dashboard
    -- cannot tell which backend answered.
    'total',     count(*),
    'AVAILABLE', count(*) filter (where status = 'AVAILABLE'),
    'ASSIGNED',  count(*) filter (where status = 'ASSIGNED'),
    'ACTIVE',    count(*) filter (where status = 'ACTIVE'),
    'BLOCKED',   count(*) filter (where status = 'BLOCKED')
  ) from public.keychains;
$$;

create or replace function public.verify_password(p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  perform public.require_password(p_password);
  return json_build_object('ok', true);
end;
$$;

-- The full record, contact details included. Password required.
create or replace function public.admin_get(p_id integer, p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare r public.keychains;
begin
  perform public.require_password(p_password);
  select * into r from public.keychains where id = p_id;
  if not found then raise exception 'NOT_FOUND|No keychain %', p_id; end if;

  return json_build_object(
    'id', r.id, 'slug', r.slug, 'status', r.status,
    'assigned', (r.name <> ''),
    'title', r.title, 'name', r.name, 'designation', r.designation,
    'organization', r.organization, 'email', r.email, 'mobile', r.mobile,
    'phone', r.phone, 'website', r.website, 'address', r.address,
    'remarks', r.remarks, 'notes', r.notes,
    'createdAt', r.created_at, 'updatedAt', r.updated_at
  );
end;
$$;

create or replace function public.admin_update(p_id integer, p_card jsonb, p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  f jsonb;
  r public.keychains;
begin
  perform public.require_password(p_password);
  f := public.card_fields(p_card);

  update public.keychains set
    title = f->>'title',              name         = f->>'name',
    designation = f->>'designation',  organization = f->>'organization',
    email = f->>'email',              mobile       = f->>'mobile',
    phone = f->>'phone',              website      = f->>'website',
    address = f->>'address',          remarks      = f->>'remarks',
    notes  = left(btrim(coalesce(p_card->>'notes', notes)), 1000),
    -- A staff edit that fills in a name activates the card; clearing the name
    -- must not leave it ACTIVE and blank.
    status = case
               when f->>'name' <> '' and status = 'AVAILABLE' then 'ACTIVE'
               when f->>'name' =  '' and status = 'ACTIVE'    then 'AVAILABLE'
               else status
             end,
    updated_at = now()
  where id = p_id
  returning * into r;

  if not found then raise exception 'NOT_FOUND|No keychain %', p_id; end if;
  return json_build_object('ok', true, 'id', r.id, 'status', r.status);
end;
$$;

create or replace function public.admin_set_status(p_id integer, p_status text, p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare r public.keychains;
begin
  perform public.require_password(p_password);

  update public.keychains
     set status = upper(btrim(p_status)), updated_at = now()
   where id = p_id
  returning * into r;

  if not found then raise exception 'NOT_FOUND|No keychain %', p_id; end if;
  return json_build_object('ok', true, 'id', r.id, 'status', r.status);
end;
$$;

-- Clear a card and issue a new slug. The printed code stops working, which is
-- the point: it is what you do when a keychain is lost.
create or replace function public.admin_release(p_id integer, p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  r public.keychains;
  candidate text;
  alphabet  text := '23456789abcdefghjkmnpqrstuvwxyz';
  i integer;
  tries integer := 0;
begin
  perform public.require_password(p_password);

  loop
    tries := tries + 1;
    if tries > 50 then raise exception 'SLUG_EXHAUSTED|Could not mint a unique code.'; end if;

    candidate := '';
    for i in 1..10 loop
      -- gen_random_bytes, not random(): random() is a seeded PRNG, and a
      -- predictable slug is a URL somebody else can guess their way into.
      candidate := candidate || substr(alphabet, 1 + (get_byte(gen_random_bytes(1), 0) % length(alphabet)), 1);
    end loop;

    exit when not exists (select 1 from public.keychains where slug = candidate)
          and candidate not in ('admin','assets','api','static');
  end loop;

  update public.keychains set
    slug = candidate, status = 'AVAILABLE',
    title = '', name = '', designation = '', organization = '',
    email = '', mobile = '', phone = '', website = '', address = '', remarks = '',
    updated_at = now()
  where id = p_id
  returning * into r;

  if not found then raise exception 'NOT_FOUND|No keychain %', p_id; end if;
  return json_build_object('ok', true, 'id', r.id, 'slug', r.slug);
end;
$$;

/* ================================== SYNC ================================== */
-- Called only by Apps Script with the service_role key. See apps-script/Sync.gs
-- for how the two halves avoid echoing each other.

-- Rows the Sheet has not caught up with. The caller passes back the hashes it
-- already has; anything matching is skipped, which is what stops a mirrored
-- write from looking like a fresh change on the next pass.
create or replace function public.sync_pull(p_known jsonb default '{}'::jsonb)
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(json_agg(json_build_object(
    'id', id, 'slug', slug, 'status', status,
    'title', title, 'name', name, 'designation', designation,
    'organization', organization, 'email', email, 'mobile', mobile,
    'phone', phone, 'website', website, 'address', address,
    'remarks', remarks, 'notes', notes,
    'createdAt', created_at, 'updatedAt', updated_at, 'hash', card_hash
  ) order by id), '[]'::json)
  from public.keychains
  where card_hash is distinct from (p_known->>(id::text));
$$;

-- Apply edits made in the Sheet.
--
-- The guard is `card_hash = p_base_hash`: the Sheet says "I am changing the row
-- that looked like this". If the row has moved on since — somebody tapped their
-- keychain in the last minute — the update does not apply and the row is
-- reported back as a conflict rather than silently overwriting a real claim.
create or replace function public.sync_push(p_rows jsonb)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  row_in    jsonb;
  updated   integer := 0;
  inserted  integer := 0;
  conflicts jsonb   := '[]'::jsonb;
  hit       boolean;
begin
  for row_in in select * from jsonb_array_elements(p_rows) loop

    update public.keychains set
      slug         = coalesce(nullif(btrim(row_in->>'slug'), ''), slug),
      status       = coalesce(nullif(upper(btrim(row_in->>'status')), ''), status),
      title        = coalesce(row_in->>'title', title),
      name         = coalesce(row_in->>'name', name),
      designation  = coalesce(row_in->>'designation', designation),
      organization = coalesce(row_in->>'organization', organization),
      email        = coalesce(row_in->>'email', email),
      mobile       = coalesce(row_in->>'mobile', mobile),
      phone        = coalesce(row_in->>'phone', phone),
      website      = coalesce(row_in->>'website', website),
      address      = coalesce(row_in->>'address', address),
      remarks      = coalesce(row_in->>'remarks', remarks),
      notes        = coalesce(row_in->>'notes', notes),
      -- The first import carries the sheet's own timestamps so the record of
      -- when each doctor actually claimed their keychain survives. A routine
      -- sync never sends them (the sheet's UpdatedAt is not maintained by hand,
      -- which is exactly why this design compares hashes instead), so it falls
      -- through to now() and means what it says.
      created_at   = coalesce(nullif(btrim(coalesce(row_in->>'createdAt','')),'')::timestamptz, created_at),
      updated_at   = coalesce(nullif(btrim(coalesce(row_in->>'updatedAt','')),'')::timestamptz, now())
    where id = (row_in->>'id')::integer
      and (row_in->>'baseHash' is null or card_hash = row_in->>'baseHash');

    hit := found;

    if hit then
      updated := updated + 1;
    elsif exists (select 1 from public.keychains where id = (row_in->>'id')::integer) then
      conflicts := conflicts || jsonb_build_object(
        'id', (row_in->>'id')::integer,
        'reason', 'changed in the database since the sheet was read'
      );
    else
      -- A row the Sheet has and the database does not: the first import, or a
      -- batch seeded straight into the Sheet.
      insert into public.keychains (
        id, slug, status, title, name, designation, organization,
        email, mobile, phone, website, address, remarks, notes,
        created_at, updated_at
      ) values (
        (row_in->>'id')::integer,
        btrim(row_in->>'slug'),
        coalesce(nullif(upper(btrim(row_in->>'status')), ''), 'AVAILABLE'),
        coalesce(row_in->>'title', ''),        coalesce(row_in->>'name', ''),
        coalesce(row_in->>'designation', ''),  coalesce(row_in->>'organization', ''),
        coalesce(row_in->>'email', ''),        coalesce(row_in->>'mobile', ''),
        coalesce(row_in->>'phone', ''),        coalesce(row_in->>'website', ''),
        coalesce(row_in->>'address', ''),      coalesce(row_in->>'remarks', ''),
        coalesce(row_in->>'notes', ''),
        coalesce(nullif(btrim(coalesce(row_in->>'createdAt','')),'')::timestamptz, now()),
        coalesce(nullif(btrim(coalesce(row_in->>'updatedAt','')),'')::timestamptz, now())
      )
      on conflict (id) do nothing;
      inserted := inserted + 1;
    end if;
  end loop;

  return json_build_object(
    'updated', updated, 'inserted', inserted, 'conflicts', conflicts
  );
end;
$$;

-- Every row's hash, for the reconciliation pass. Cheap: one column, no joins.
create or replace function public.sync_hashes()
returns json
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(json_object_agg(id::text, card_hash), '{}'::json) from public.keychains;
$$;

/* ============================== PERMISSIONS =============================== */
-- Default-deny, then grant exactly one function.
--
-- The app reads a tapped keychain from here and does nothing else. Claims and
-- staff edits go through Apps Script into the Google Sheet, which is the record
-- for 500 keychains already in circulation; this database is a mirror of it.
--
-- So the browser key needs get_card and nothing more. Leaving claim_card or the
-- admin_* functions reachable would mean somebody with an unclaimed code could
-- change what a tap shows until the next sync reverted it — a real window, for
-- no benefit, since nothing in the app calls them.
--
-- They are kept defined rather than dropped: they are tested, and if writes
-- ever move here the grant is the only thing that has to change.

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

grant execute on function public.get_card(text) to anon, authenticated;

-- The sync runs as service_role, from Apps Script. These must be granted
-- explicitly: the revoke above takes EXECUTE away from PUBLIC, and PUBLIC is
-- where service_role would otherwise have inherited it.
grant execute on function public.sync_push(jsonb)  to service_role;
grant execute on function public.sync_hashes()     to service_role;
grant execute on function public.sync_pull(jsonb)  to service_role;

-- Everything else — claim_card, admin_*, set_admin_password, and the helpers —
-- is reachable only by the owner, from the SQL editor.
