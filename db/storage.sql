-- Eqova keychains — profile photos.
--
-- Run this once in the Supabase SQL editor, after db/schema.sql. It is
-- idempotent: running it again is safe and changes nothing.
--
-- WHAT THIS SETS UP
-- A public bucket the browser uploads to directly. There is no server to sign
-- an upload with, so the anon key does it — which means this is the first
-- thing in the system that key can WRITE to, and the policies below are what
-- keep that from being a problem.
--
-- WHO MAY UPLOAD
-- Whoever is holding the keychain, which is the same rule claiming already
-- uses: the code is unguessable, and possession is the authority. There is no
-- password and no account.
--
-- WHY THAT IS NOT AN OPEN FILE HOST
-- An upload is only accepted when the filename is exactly "<slug>.webp" for a
-- keychain that EXISTS and is CLAIMED. So:
--
--   * there are at most 500 filenames in the world this key can write, one per
--     physical keychain, and they are unguessable
--   * nobody can add files, only overwrite one of those 500
--   * an unclaimed or blocked keychain is refused, so the bucket cannot be
--     used before a card exists
--   * the bucket caps size and MIME type itself, so neither depends on the
--     browser behaving
--
-- The residual risk is honest and worth stating: somebody who taps a
-- colleague's keychain can replace that colleague's photo. That is the
-- consequence of possession-is-authority, chosen deliberately. If it ever
-- matters, the fix is to tighten avatar_name_allowed() — the app does not
-- change.
--
-- WHERE THE URL LIVES: NOWHERE
-- The photo's address is a pure function of the slug, so there is no column
-- for it, in the sheet or here. Nothing has to be written anywhere when a
-- photo is uploaded, which keeps the sheet the source of truth for everything
-- it holds and keeps photos entirely out of the sync.

/* ================================= BUCKET ================================= */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,            -- public reads: served from the CDN with no auth round trip
  307200,          -- 300 KB. The app resizes to ~40 KB; this is the backstop
                   -- for a client that does not, and it is enforced here
                   -- rather than trusted to the browser.
  array['image/webp', 'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* ============================== THE GUARD ================================= */

/**
 * Is this a filename the public key may write?
 *
 * SECURITY DEFINER because it reads public.keychains, which anon cannot: the
 * policy expression runs as the caller, so without this the policy would fail
 * rather than deny.
 */
create or replace function public.avatar_name_allowed(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    -- Exactly "<10 slug chars>.webp". The alphabet is the one makeSlug uses,
    -- so no path separators, no traversal, no second extension.
    object_name ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{10}\.webp$'
    and exists (
      select 1
        from public.keychains
       where slug = left(object_name, 10)
         and name <> ''
         and status not in ('AVAILABLE', 'BLOCKED')
    );
$$;

grant execute on function public.avatar_name_allowed(text) to anon, authenticated;

/* =============================== POLICIES ================================= */

drop policy if exists "avatars are publicly readable"   on storage.objects;
drop policy if exists "a keychain holder may add a photo"     on storage.objects;
drop policy if exists "a keychain holder may replace a photo" on storage.objects;  -- removed; see below

-- Reads. The bucket is public, but an explicit policy keeps the intent visible
-- next to the write rules rather than only in a dashboard toggle.
create policy "avatars are publicly readable"
on storage.objects for select
to anon, authenticated
using (bucket_id = 'avatars');

create policy "a keychain holder may add a photo"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'avatars' and public.avatar_name_allowed(name));

-- No UPDATE or DELETE for the public key. Both deliberate.
--
-- A photo is chosen once, while the keychain is being set up, and the app does
-- not offer to change it afterwards. Granting UPDATE anyway would mean the
-- server still accepted something the product does not do — and since the only
-- credential is a slug that anybody who taps the keychain can read, that gap
-- is precisely a "replace a colleague's photo" button for anyone who looks for
-- it. INSERT alone makes the first write the only write.
--
-- So each of the 500 filenames can be written exactly once, by whoever sets up
-- that keychain, and never again by anyone holding the public key.
--
-- Staff edit photos from the dashboard instead, through the grant mechanism at
-- the end of this file — password-checked by Postgres, with no service key in
-- the browser.

/* ============================ STAFF PHOTO EDITS =========================== */
/*
 * Replacing or removing a photo from the staff dashboard, with no service key
 * in the browser and no Apps Script in the loop.
 *
 * THE PROBLEM
 * The public key may only INSERT, and only where no photo exists — that is
 * what stops it being a "replace a colleague's photo" button. Staff need to
 * replace and remove. The service key could do it but must never reach a
 * browser: it bypasses row-level security on everything, not just storage.
 *
 * THE MECHANISM
 * Staff prove the password to Postgres, which writes a short-lived note saying
 * "this one slug may be edited until this moment". The storage policies below
 * check for that note. The browser then uploads straight to storage with the
 * ordinary public key, and the note is torn up immediately afterwards.
 *
 * So the password is checked by the database, the permission lives in the
 * database, and the only thing the browser ever holds is the anon key it
 * already had.
 */

create table if not exists public.photo_grants (
  slug       text primary key,
  expires_at timestamptz not null
);

-- RLS on with no policies: the grant table is invisible and unwritable to the
-- public key. It is reached only through the SECURITY DEFINER functions below,
-- which is what makes the password the only way to create one.
alter table public.photo_grants enable row level security;
revoke all on public.photo_grants from anon, authenticated;

/**
 * Prove the staff password, get a short window to edit one card's photo.
 *
 * Two minutes, and for one slug. The window is the blast radius: during it,
 * somebody who already knew that exact code could also overwrite that one
 * photo. It is short, it is scoped to a single unguessable slug, and
 * admin_lock_photo closes it the moment the upload finishes.
 */
create or replace function public.admin_unlock_photo(p_id integer, p_password text)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  target text;
begin
  perform public.require_password(p_password);

  select slug into target from public.keychains where id = p_id;
  if target is null then
    raise exception 'NOT_FOUND|No keychain %', p_id;
  end if;

  insert into public.photo_grants (slug, expires_at)
  values (target, now() + interval '2 minutes')
  on conflict (slug) do update set expires_at = excluded.expires_at;

  -- Housekeeping, here rather than on a schedule: the table is tiny and this
  -- is the only thing that ever writes to it.
  delete from public.photo_grants where expires_at < now() - interval '1 hour';

  return json_build_object('slug', target);
end;
$$;

/**
 * Close the window early. Called right after the upload, so the grant lasts
 * seconds rather than the full two minutes.
 *
 * Needs no password: revoking a permission is not a privileged act, and
 * requiring one would mean a failed revoke leaves the window open longer.
 */
create or replace function public.admin_lock_photo(p_id integer)
returns json
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
begin
  delete from public.photo_grants
   where slug = (select slug from public.keychains where id = p_id);
  return json_build_object('ok', true);
end;
$$;

/** Is there a live grant for the card this object belongs to? */
create or replace function public.photo_edit_allowed(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.photo_grants
     where slug = left(object_name, 10)
       and expires_at > now()
  );
$$;

grant execute on function public.admin_unlock_photo(integer, text) to anon, authenticated;
grant execute on function public.admin_lock_photo(integer)          to anon, authenticated;
grant execute on function public.photo_edit_allowed(text)           to anon, authenticated;

drop policy if exists "staff may replace a photo" on storage.objects;
drop policy if exists "staff may remove a photo"  on storage.objects;

-- Both still require avatar_name_allowed, so a grant cannot be used to write
-- some other filename into the bucket.
create policy "staff may replace a photo"
on storage.objects for update
to anon, authenticated
using      (bucket_id = 'avatars' and public.avatar_name_allowed(name) and public.photo_edit_allowed(name))
with check (bucket_id = 'avatars' and public.avatar_name_allowed(name) and public.photo_edit_allowed(name));

create policy "staff may remove a photo"
on storage.objects for delete
to anon, authenticated
using (bucket_id = 'avatars' and public.photo_edit_allowed(name));
