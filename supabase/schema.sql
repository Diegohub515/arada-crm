-- =====================================================================
-- Arada CRM · Esquema de base de datos para Supabase
-- Cómo usarlo: Supabase → SQL Editor → New query → pega todo → Run.
-- Se puede correr más de una vez sin romper nada.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------- Perfiles del equipo ----------
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text,
  email text,
  rol text not null default 'asesor' check (rol in ('admin','marketing','asesor')),
  created_at timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando invitas a alguien
create or replace function public.crear_perfil()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- ---------- Brokers ----------
create table if not exists public.brokers (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  inmobiliaria text,
  telefono text,
  email text,
  comision_pct numeric(5,2) default 3,
  activo boolean not null default true,
  notas text,
  created_at timestamptz not null default now()
);

-- ---------- Leads ----------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nombre text not null default 'Sin nombre',
  telefono text,
  email text,
  origen text not null default 'manual'
    check (origen in ('meta_formulario','whatsapp','instagram','facebook','google_ads','landing','broker','referido','manual','otro')),
  desarrollo text default 'VRO',
  etapa text not null default 'nuevo'
    check (etapa in ('nuevo','contactado','cita','apartado','cerrado','perdido')),
  asesor_id uuid references public.perfiles(id) on delete set null,
  broker_id uuid references public.brokers(id) on delete set null,
  tipologia text,
  presupuesto numeric(14,2),
  valor_operacion numeric(14,2),
  campana text,
  proximo_seguimiento date,
  motivo_perdida text,
  notas text,
  external_id text unique,          -- id del lead en Meta/Google/Zernio, evita duplicados
  datos_originales jsonb
);
create index if not exists leads_telefono_idx on public.leads (telefono);
create index if not exists leads_etapa_idx on public.leads (etapa);
create index if not exists leads_created_idx on public.leads (created_at desc);

create table if not exists public.actividades (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('nota','llamada','whatsapp','cita','cambio_etapa','sistema')),
  texto text not null,
  creado_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists actividades_lead_idx on public.actividades (lead_id, created_at desc);

-- ---------- Bandeja de mensajes (Zernio) ----------
create table if not exists public.conversaciones (
  id uuid primary key default gen_random_uuid(),
  zernio_conversation_id text unique not null,
  zernio_account_id text,
  plataforma text,                 -- whatsapp, instagram, facebook, etc.
  contacto_nombre text,
  contacto_id text,                -- teléfono o usuario de la red
  lead_id uuid references public.leads(id) on delete set null,
  ultimo_mensaje text,
  ultimo_mensaje_at timestamptz,
  no_leidos int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists conversaciones_ultimo_idx on public.conversaciones (ultimo_mensaje_at desc);

create table if not exists public.mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references public.conversaciones(id) on delete cascade,
  zernio_message_id text,
  direccion text not null check (direccion in ('entrante','saliente')),
  texto text,
  adjuntos jsonb,
  estado text default 'recibido',
  enviado_por uuid references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists mensajes_conv_idx on public.mensajes (conversacion_id, created_at);
drop index if exists public.mensajes_zernio_idx;
create unique index if not exists mensajes_zernio_uidx on public.mensajes (zernio_message_id);

-- Evita procesar dos veces el mismo webhook (Zernio reintenta)
create table if not exists public.webhook_eventos (
  id text primary key,
  fuente text not null,
  tipo text,
  recibido_at timestamptz not null default now()
);

-- ---------- Proveedores, compras y facturas ----------
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rfc text,
  categoria text,
  contacto text,
  telefono text,
  email text,
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.ordenes_compra (
  id uuid primary key default gen_random_uuid(),
  folio text,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  concepto text not null,
  categoria text,
  desarrollo text,
  monto numeric(14,2) not null default 0,
  estado text not null default 'borrador' check (estado in ('borrador','aprobada','pagada','cancelada')),
  fecha date not null default current_date,
  archivo_path text,
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.facturas (
  id uuid primary key default gen_random_uuid(),
  folio text,
  uuid_fiscal text,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  orden_id uuid references public.ordenes_compra(id) on delete set null,
  concepto text,
  categoria text,
  desarrollo text,
  subtotal numeric(14,2) default 0,
  iva numeric(14,2) default 0,
  total numeric(14,2) not null default 0,
  fecha_emision date default current_date,
  fecha_vencimiento date,
  estado text not null default 'pendiente' check (estado in ('pendiente','pagada','cancelada')),
  archivo_path text,
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.documentos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  categoria text,
  desarrollo text,
  archivo_path text,
  notas text,
  created_at timestamptz not null default now()
);

-- ---------- updated_at automático ----------
create or replace function public.tocar_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists leads_updated on public.leads;
create trigger leads_updated before update on public.leads
  for each row execute function public.tocar_updated_at();

-- ---------- Seguridad: solo usuarios de tu equipo con sesión ----------
do $$
declare t text;
begin
  foreach t in array array['perfiles','brokers','leads','actividades','conversaciones','mensajes',
                           'proveedores','ordenes_compra','facturas','documentos','webhook_eventos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists equipo_todo on public.%I', t);
    if t <> 'webhook_eventos' then
      execute format('create policy equipo_todo on public.%I for all to authenticated using (true) with check (true)', t);
    end if;
  end loop;
end $$;

-- ---------- Archivos (facturas, órdenes, documentos) ----------
insert into storage.buckets (id, name, public)
values ('archivos', 'archivos', false)
on conflict (id) do nothing;

drop policy if exists archivos_equipo on storage.objects;
create policy archivos_equipo on storage.objects for all to authenticated
  using (bucket_id = 'archivos') with check (bucket_id = 'archivos');

-- ---------- Tiempo real para la bandeja y el pipeline ----------
do $$
begin
  begin alter publication supabase_realtime add table public.mensajes; exception when others then null; end;
  begin alter publication supabase_realtime add table public.conversaciones; exception when others then null; end;
  begin alter publication supabase_realtime add table public.leads; exception when others then null; end;
end $$;

-- =====================================================================
-- Agente de IA (contesta solo los chats). Seguro correrlo otra vez.
-- =====================================================================
alter table public.conversaciones add column if not exists agente_activo boolean not null default true;
alter table public.conversaciones add column if not exists agente_motivo text;
alter table public.mensajes add column if not exists autor text not null default 'cliente'
  check (autor in ('cliente','humano','agente'));
update public.mensajes set autor = 'humano' where direccion = 'saliente' and autor = 'cliente';

create table if not exists public.agente_config (
  id int primary key default 1 check (id = 1),
  activo boolean not null default false,          -- interruptor general (arranca apagado)
  nombre text not null default 'Sofía',
  instrucciones text not null default
'Somos Vivia Roma, departamentos en preventa al sur de Monterrey, cerca del Tec de Monterrey y Valle Oriente.
Esquema de pago: 15% de enganche, 15% en mensualidades y 70% a la escrituración.
Tenemos showroom (no hay departamento muestra).
Objetivo: calificar al cliente y agendar visita al showroom.
No des precios exactos: di que un asesor los comparte en la visita o por llamada.',
  horario_showroom text default 'Lunes a sábado de 10:00 a 18:00',
  updated_at timestamptz not null default now()
);
insert into public.agente_config (id) values (1) on conflict (id) do nothing;

alter table public.agente_config enable row level security;
drop policy if exists equipo_todo on public.agente_config;
create policy equipo_todo on public.agente_config for all to authenticated using (true) with check (true);

-- =====================================================================
-- Comercialización: inventario, cotizaciones, separaciones y ventas.
-- Seguro correrlo otra vez.
-- =====================================================================
create table if not exists public.unidades (
  id uuid primary key default gen_random_uuid(),
  desarrollo text not null default 'VRO',
  torre text not null default 'A',
  nivel int not null,
  numero text not null,
  tipologia text,
  recamaras int,
  banos numeric(3,1),
  m2_interior numeric(8,2),
  m2_terraza numeric(8,2),
  cajones int default 1,
  vista text,
  precio_lista numeric(14,2) not null default 0,
  estado text not null default 'disponible' check (estado in ('disponible','separada','vendida','bloqueada')),
  notas text,
  created_at timestamptz not null default now(),
  unique (desarrollo, torre, numero)
);

create table if not exists public.cotizaciones (
  id uuid primary key default gen_random_uuid(),
  folio text,
  unidad_id uuid not null references public.unidades(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  asesor_id uuid references public.perfiles(id) on delete set null,
  precio_lista numeric(14,2) not null,
  descuento_pct numeric(5,2) not null default 0,
  precio_final numeric(14,2) not null,
  enganche_pct numeric(5,2) not null default 15,
  mensualidades_pct numeric(5,2) not null default 15,
  num_mensualidades int not null default 12,
  escrituracion_pct numeric(5,2) not null default 70,
  vigencia date,
  estado text not null default 'vigente' check (estado in ('vigente','aceptada','vencida','cancelada')),
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.separaciones (
  id uuid primary key default gen_random_uuid(),
  unidad_id uuid not null references public.unidades(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  cotizacion_id uuid references public.cotizaciones(id) on delete set null,
  monto numeric(14,2) not null default 0,
  fecha date not null default current_date,
  vence date,
  metodo_pago text,
  estado text not null default 'activa' check (estado in ('activa','convertida','cancelada','vencida')),
  archivo_path text,
  notas text,
  created_at timestamptz not null default now()
);

create table if not exists public.ventas (
  id uuid primary key default gen_random_uuid(),
  unidad_id uuid not null references public.unidades(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  separacion_id uuid references public.separaciones(id) on delete set null,
  cotizacion_id uuid references public.cotizaciones(id) on delete set null,
  broker_id uuid references public.brokers(id) on delete set null,
  precio_final numeric(14,2) not null,
  fecha_contrato date not null default current_date,
  comision_broker_pct numeric(5,2),
  estado text not null default 'firmada' check (estado in ('firmada','escriturada','cancelada')),
  archivo_path text,
  notas text,
  created_at timestamptz not null default now()
);

create index if not exists cotizaciones_unidad_idx on public.cotizaciones (unidad_id);
create index if not exists separaciones_unidad_idx on public.separaciones (unidad_id);
create index if not exists ventas_unidad_idx on public.ventas (unidad_id);

-- Folio automático de cotización: COT-0001
create sequence if not exists public.cotizaciones_folio_seq;
create or replace function public.folio_cotizacion()
returns trigger language plpgsql as $$
begin
  if new.folio is null then new.folio := 'COT-' || lpad(nextval('public.cotizaciones_folio_seq')::text, 4, '0'); end if;
  return new;
end $$;
drop trigger if exists cotizacion_folio on public.cotizaciones;
create trigger cotizacion_folio before insert on public.cotizaciones for each row execute function public.folio_cotizacion();

-- El estado del departamento se calcula solo a partir de separaciones y ventas
create or replace function public.recalcular_unidad(p_unidad uuid)
returns void language plpgsql security definer set search_path = public as $$
declare actual text;
begin
  select estado into actual from unidades where id = p_unidad;
  if actual is null then return; end if;
  if exists (select 1 from ventas where unidad_id = p_unidad and estado <> 'cancelada') then
    update unidades set estado = 'vendida' where id = p_unidad;
  elsif exists (select 1 from separaciones where unidad_id = p_unidad and estado = 'activa') then
    update unidades set estado = 'separada' where id = p_unidad;
  elsif actual in ('separada','vendida') then
    update unidades set estado = 'disponible' where id = p_unidad;
  end if;
end $$;

create or replace function public.al_cambiar_separacion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform recalcular_unidad(old.unidad_id); return old; end if;
  perform recalcular_unidad(new.unidad_id);
  if tg_op = 'UPDATE' and old.unidad_id <> new.unidad_id then perform recalcular_unidad(old.unidad_id); end if;
  if new.estado = 'activa' and new.lead_id is not null then
    update leads set etapa = 'apartado' where id = new.lead_id and etapa not in ('apartado','cerrado');
    if tg_op = 'INSERT' then
      insert into actividades (lead_id, tipo, texto) values (new.lead_id, 'sistema', 'Separó un departamento por $' || to_char(new.monto, 'FM999,999,999') || '.');
    end if;
  end if;
  if new.cotizacion_id is not null and new.estado = 'activa' then
    update cotizaciones set estado = 'aceptada' where id = new.cotizacion_id;
  end if;
  return new;
end $$;
drop trigger if exists separacion_cambio on public.separaciones;
create trigger separacion_cambio after insert or update or delete on public.separaciones
  for each row execute function public.al_cambiar_separacion();

create or replace function public.al_cambiar_venta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform recalcular_unidad(old.unidad_id); return old; end if;
  if new.separacion_id is not null and new.estado <> 'cancelada' then
    update separaciones set estado = 'convertida' where id = new.separacion_id and estado = 'activa';
  end if;
  perform recalcular_unidad(new.unidad_id);
  if tg_op = 'UPDATE' and old.unidad_id <> new.unidad_id then perform recalcular_unidad(old.unidad_id); end if;
  if new.estado <> 'cancelada' and new.lead_id is not null then
    update leads set etapa = 'cerrado', valor_operacion = new.precio_final,
      broker_id = coalesce(new.broker_id, broker_id) where id = new.lead_id;
    if tg_op = 'INSERT' then
      insert into actividades (lead_id, tipo, texto) values (new.lead_id, 'sistema', 'Venta firmada por $' || to_char(new.precio_final, 'FM999,999,999') || '.');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists venta_cambio on public.ventas;
create trigger venta_cambio after insert or update or delete on public.ventas
  for each row execute function public.al_cambiar_venta();

do $$
declare t text;
begin
  foreach t in array array['unidades','cotizaciones','separaciones','ventas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists equipo_todo on public.%I', t);
    execute format('create policy equipo_todo on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
  begin alter publication supabase_realtime add table public.unidades; exception when others then null; end;
end $$;
