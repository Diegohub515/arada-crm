import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarTelefono } from "./formato";

/**
 * Crea o actualiza un lead a partir de cualquier fuente (Meta, Google, Zapier, landing, Zernio).
 * Busca primero por external_id y luego por teléfono para no duplicar personas.
 */
export async function guardarLead(
  db: SupabaseClient,
  datos: {
    nombre?: string | null;
    telefono?: string | null;
    email?: string | null;
    origen: string;
    desarrollo?: string | null;
    campana?: string | null;
    tipologia?: string | null;
    presupuesto?: number | null;
    notas?: string | null;
    externalId?: string | null;
    originales?: unknown;
    /** Otros campos de la ficha (anuncio, conjunto_anuncios, como_se_entero, etc.) */
    extra?: Record<string, unknown>;
    /** true = no asignar por guardia (p. ej. chats viejos importados) */
    sinAsignar?: boolean;
  }
): Promise<{ id: string; nuevo: boolean }> {
  const telefono = normalizarTelefono(datos.telefono);

  let existente: { id: string } | null = null;
  if (datos.externalId) {
    const { data } = await db.from("leads").select("id").eq("external_id", datos.externalId).maybeSingle();
    existente = data;
  }
  if (!existente && telefono) {
    const { data } = await db
      .from("leads").select("id").eq("telefono", telefono)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    existente = data;
  }
  if (!existente && datos.email) {
    const { data } = await db
      .from("leads").select("id").ilike("email", datos.email.trim())
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    existente = data;
  }

  const extra = Object.fromEntries(Object.entries(datos.extra ?? {}).filter(([, v]) => v != null && v !== ""));

  if (existente) {
    // Completa solo los campos que estaban vacíos (no pisa lo que ya capturó el equipo)
    if (Object.keys(extra).length) {
      const { data: actual } = await db.from("leads").select("*").eq("id", existente.id).single();
      const vacios = Object.fromEntries(Object.entries(extra).filter(([k]) => actual && (actual as any)[k] == null));
      if (Object.keys(vacios).length) await db.from("leads").update(vacios).eq("id", existente.id);
    }
    await db.from("actividades").insert({
      lead_id: existente.id,
      tipo: "sistema",
      texto: `Volvió a escribir / registrarse desde ${datos.origen}${datos.campana ? ` (${datos.campana})` : ""}.`,
    });
    return { id: existente.id, nuevo: false };
  }

  // Asesor de guardia en este momento (si hay calendario de guardias)
  const asignado = datos.sinAsignar ? null : await asesorDeGuardia(db, datos.desarrollo || null).catch(() => null);

  const { data, error } = await db
    .from("leads")
    .insert({
      asesor_id: asignado?.id ?? null,
      nombre: datos.nombre?.trim() || "Sin nombre",
      telefono,
      email: datos.email?.trim() || null,
      origen: datos.origen,
      desarrollo: datos.desarrollo || "VRO",
      campana: datos.campana || null,
      tipologia: datos.tipologia || null,
      presupuesto: datos.presupuesto ?? null,
      notas: datos.notas || null,
      external_id: datos.externalId || null,
      datos_originales: datos.originales ?? null,
      ...extra,
    })
    .select("id")
    .single();
  if (error) throw error;

  await db.from("actividades").insert({
    lead_id: data.id,
    tipo: "sistema",
    texto: `Lead creado automáticamente desde ${datos.origen}${datos.campana ? ` (${datos.campana})` : ""}.${asignado ? ` Asignado a ${asignado.nombre} (guardia).` : ""}`,
  });
  return { id: data.id, nuevo: true };
}

/** Fecha (AAAA-MM-DD) y hora (HH:MM) actuales en Monterrey. */
export function ahoraMonterrey() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Monterrey", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { fecha: `${partes.year}-${partes.month}-${partes.day}`, hora: `${partes.hour}:${partes.minute}` };
}

/**
 * Asesor que está de guardia ahora. Si hay varios al mismo tiempo, se reparte:
 * le toca al que lleva menos leads asignados hoy.
 */
export async function asesorDeGuardia(db: SupabaseClient, desarrollo: string | null): Promise<{ id: string; nombre: string } | null> {
  const { fecha, hora } = ahoraMonterrey();
  const { data: turnos } = await db.from("guardias")
    .select("asesor_id, desarrollo, perfiles!inner(nombre, email, activo)")
    .eq("fecha", fecha).lte("hora_inicio", `${hora}:00`).gt("hora_fin", `${hora}:00`);
  const candidatos = (turnos ?? []).filter((t: any) => t.perfiles?.activo !== false && (!t.desarrollo || !desarrollo || t.desarrollo === desarrollo));
  if (!candidatos.length) return null;
  const ids: string[] = Array.from(new Set<string>(candidatos.map((t: any) => String(t.asesor_id))));
  const { data: hoy } = await db.from("leads").select("asesor_id").in("asesor_id", ids).gte("created_at", `${fecha}T00:00:00-06:00`);
  const cuenta = new Map(ids.map((id) => [id, 0]));
  (hoy ?? []).forEach((l: any) => cuenta.set(l.asesor_id, (cuenta.get(l.asesor_id) ?? 0) + 1));
  const elegido = ids.sort((a, b) => (cuenta.get(a)! - cuenta.get(b)!))[0];
  const t: any = candidatos.find((x: any) => x.asesor_id === elegido);
  return { id: elegido, nombre: t?.perfiles?.nombre || t?.perfiles?.email || "asesor" };
}

/** Busca un valor en un mapa de respuestas usando varios nombres posibles (es/en). */
export function buscarCampo(mapa: Record<string, unknown>, ...claves: string[]): string | null {
  const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
  const entradas = Object.entries(mapa).map(([k, v]) => [normal(k), v] as const);
  for (const c of claves) {
    const objetivo = normal(c);
    const hit = entradas.find(([k]) => k === objetivo) ?? entradas.find(([k]) => k.includes(objetivo));
    if (hit && hit[1] != null && String(hit[1]).trim()) return String(hit[1]).trim();
  }
  return null;
}

/** Origen del lead según la plataforma de mensajería. */
export function origenDePlataforma(p: string | null): string {
  if (!p) return "otro";
  if (p.includes("whatsapp")) return "whatsapp";
  if (p.includes("instagram")) return "instagram";
  if (p.includes("facebook") || p.includes("messenger")) return "facebook";
  return "otro";
}
