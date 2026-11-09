-- KilometerTracker: plak dit in Supabase onder SQL Editor en klik op Run.
-- Alle tabellen beginnen met km_, zodat ze los staan van andere apps in hetzelfde project.
-- Je ziet alleen de gegevens van een auto waarvan je lid bent. Lid word je door
-- zelf een auto aan te maken of met de deelcode van een andere gebruiker.

create table public.km_autos (
  id uuid primary key default gen_random_uuid(),
  naam text not null check (length(trim(naam)) > 0),
  kenteken text,
  deelcode text not null unique,
  aangemaakt_op timestamptz not null default now()
);

create table public.km_personen (
  id uuid primary key default gen_random_uuid(),
  auto_id uuid not null references public.km_autos (id) on delete cascade,
  naam text not null check (length(trim(naam)) > 0),
  kleur text not null default '#22d3ee',
  user_id uuid references auth.users (id) on delete set null,
  actief boolean not null default true,
  aangemaakt_op timestamptz not null default now(),
  unique (auto_id, user_id)
);

create table public.km_ritten (
  id uuid primary key default gen_random_uuid(),
  auto_id uuid not null references public.km_autos (id) on delete cascade,
  datum date not null default current_date,
  begin_km integer not null check (begin_km >= 0),
  eind_km integer not null,
  persoon_id uuid not null references public.km_personen (id),
  reden text,
  opdrachtgever text,
  aangemaakt_door uuid default auth.uid() references auth.users (id) on delete set null,
  aangemaakt_op timestamptz not null default now(),
  check (eind_km > begin_km)
);

create table public.km_tankbeurten (
  id uuid primary key default gen_random_uuid(),
  auto_id uuid not null references public.km_autos (id) on delete cascade,
  datum date not null default current_date,
  km_stand integer check (km_stand >= 0),
  bedrag_cent integer not null check (bedrag_cent > 0),
  liters numeric(7, 2) check (liters > 0),
  betaald_door uuid not null references public.km_personen (id),
  notitie text,
  aangemaakt_door uuid default auth.uid() references auth.users (id) on delete set null,
  aangemaakt_op timestamptz not null default now()
);

-- Onderlinge betalingen: van_persoon heeft bedrag_cent aan naar_persoon betaald.
create table public.km_betalingen (
  id uuid primary key default gen_random_uuid(),
  auto_id uuid not null references public.km_autos (id) on delete cascade,
  datum date not null default current_date,
  van_persoon uuid not null references public.km_personen (id),
  naar_persoon uuid not null references public.km_personen (id),
  bedrag_cent integer not null check (bedrag_cent > 0),
  aangemaakt_door uuid default auth.uid() references auth.users (id) on delete set null,
  aangemaakt_op timestamptz not null default now(),
  check (van_persoon <> naar_persoon)
);

create index km_personen_user on public.km_personen (user_id);
create index km_ritten_auto on public.km_ritten (auto_id, begin_km);
create index km_tankbeurten_auto on public.km_tankbeurten (auto_id, datum);
create index km_betalingen_auto on public.km_betalingen (auto_id, datum);

-- Hulpfunctie voor de beveiligingsregels.
create function public.km_is_lid(p_auto uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.km_personen
    where auto_id = p_auto and user_id = (select auth.uid())
  );
$$;

-- Een persoon hoort bij dezelfde auto als de rit, tankbeurt of betaling.
create function public.km_controleer_persoon() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  kolom text;
  waarde uuid;
begin
  foreach kolom in array tg_argv loop
    waarde := (to_jsonb(new) ->> kolom)::uuid;
    if not exists (select 1 from public.km_personen where id = waarde and auto_id = new.auto_id) then
      raise exception 'Persoon hoort niet bij deze auto';
    end if;
  end loop;
  return new;
end;
$$;

create trigger km_ritten_persoon before insert or update on public.km_ritten
for each row execute function public.km_controleer_persoon('persoon_id');
create trigger km_tankbeurten_persoon before insert or update on public.km_tankbeurten
for each row execute function public.km_controleer_persoon('betaald_door');
create trigger km_betalingen_persoon before insert or update on public.km_betalingen
for each row execute function public.km_controleer_persoon('van_persoon', 'naar_persoon');

alter table public.km_autos enable row level security;
alter table public.km_personen enable row level security;
alter table public.km_ritten enable row level security;
alter table public.km_tankbeurten enable row level security;
alter table public.km_betalingen enable row level security;

create policy "leden zien de auto" on public.km_autos for select to authenticated
using (public.km_is_lid(id));
create policy "leden wijzigen de auto" on public.km_autos for update to authenticated
using (public.km_is_lid(id)) with check (public.km_is_lid(id));

create policy "leden zien personen" on public.km_personen for select to authenticated
using (public.km_is_lid(auto_id));
create policy "leden voegen personen toe" on public.km_personen for insert to authenticated
with check (public.km_is_lid(auto_id) and user_id is null);
create policy "leden wijzigen personen" on public.km_personen for update to authenticated
using (public.km_is_lid(auto_id)) with check (public.km_is_lid(auto_id));

create policy "leden ritten" on public.km_ritten for all to authenticated
using (public.km_is_lid(auto_id)) with check (public.km_is_lid(auto_id));
create policy "leden tankbeurten" on public.km_tankbeurten for all to authenticated
using (public.km_is_lid(auto_id)) with check (public.km_is_lid(auto_id));
create policy "leden betalingen" on public.km_betalingen for all to authenticated
using (public.km_is_lid(auto_id)) with check (public.km_is_lid(auto_id));

revoke all on public.km_autos, public.km_personen, public.km_ritten, public.km_tankbeurten, public.km_betalingen from anon, authenticated;
grant select on public.km_autos, public.km_personen to authenticated;
grant update (naam, kenteken) on public.km_autos to authenticated;
-- Wie een account aan een persoon koppelt, gaat alleen via de functies hieronder.
grant insert (auto_id, naam, kleur) on public.km_personen to authenticated;
grant update (naam, kleur, actief) on public.km_personen to authenticated;
grant select, insert, update, delete on public.km_ritten, public.km_tankbeurten, public.km_betalingen to authenticated;

create function public.km_nieuwe_code() returns text
language sql volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 8);
$$;

-- Maakt een auto aan met de ingelogde gebruiker als eerste bestuurder.
create function public.km_maak_auto(p_naam text, p_kenteken text, p_mijn_naam text, p_kleur text default '#22d3ee')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  nieuw uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  insert into public.km_autos (naam, kenteken, deelcode)
  values (trim(p_naam), nullif(trim(p_kenteken), ''), public.km_nieuwe_code())
  returning id into nieuw;
  insert into public.km_personen (auto_id, naam, kleur, user_id)
  values (nieuw, trim(p_mijn_naam), p_kleur, auth.uid());
  return nieuw;
end;
$$;

-- Namen die nog niet aan een account hangen, zodat je jezelf kunt kiezen bij het deelnemen.
create function public.km_vrije_personen(p_code text)
returns table (id uuid, naam text, auto_naam text)
language sql stable security definer
set search_path = ''
as $$
  select p.id, p.naam, a.naam
  from public.km_autos a
  join public.km_personen p on p.auto_id = a.id
  where a.deelcode = upper(trim(p_code)) and p.user_id is null and p.actief
    and auth.uid() is not null
  order by p.naam;
$$;

-- Wordt lid met een deelcode: koppelt een bestaande persoon of maakt een nieuwe aan.
create function public.km_word_lid(p_code text, p_naam text, p_persoon uuid default null, p_kleur text default '#a78bfa')
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  auto uuid;
begin
  if auth.uid() is null then raise exception 'Niet ingelogd'; end if;
  select id into auto from public.km_autos where deelcode = upper(trim(p_code));
  if auto is null then raise exception 'Onbekende code'; end if;
  if exists (select 1 from public.km_personen where auto_id = auto and user_id = auth.uid()) then
    return auto;
  end if;
  if p_persoon is not null then
    update public.km_personen set user_id = auth.uid(), actief = true
    where id = p_persoon and auto_id = auto and user_id is null;
    if found then return auto; end if;
  end if;
  insert into public.km_personen (auto_id, naam, kleur, user_id)
  values (auto, trim(p_naam), p_kleur, auth.uid());
  return auto;
end;
$$;

-- Ontkoppelt je account van de auto; je ritten blijven staan.
create function public.km_verlaat_auto(p_auto uuid) returns void
language sql security definer
set search_path = ''
as $$
  update public.km_personen set user_id = null where auto_id = p_auto and user_id = auth.uid();
$$;

-- Zodat de app van andere bestuurders direct ververst.
alter publication supabase_realtime add table public.km_ritten, public.km_tankbeurten, public.km_betalingen, public.km_personen;

revoke all on function public.km_is_lid, public.km_nieuwe_code, public.km_maak_auto, public.km_vrije_personen,
  public.km_word_lid, public.km_verlaat_auto from public, anon;
grant execute on function public.km_is_lid, public.km_maak_auto, public.km_vrije_personen,
  public.km_word_lid, public.km_verlaat_auto to authenticated;
