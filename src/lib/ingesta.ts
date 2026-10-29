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

  if (existente) {
    await db.from("actividades").insert({
      lead_id: existente.id,
      tipo: "sistema",
      texto: `Volvió a escribir / registrarse desde ${datos.origen}${datos.campana ? ` (${datos.campana})` : ""}.`,
    });
    return { id: existente.id, nuevo: false };
  }

  const { data, error } = await db
    .from("leads")
    .insert({
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
    })
    .select("id")
    .single();
  if (error) throw error;

  await db.from("actividades").insert({
    lead_id: data.id,
    tipo: "sistema",
    texto: `Lead creado automáticamente desde ${datos.origen}${datos.campana ? ` (${datos.campana})` : ""}.`,
  });
  return { id: data.id, nuevo: true };
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
