import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizarTelefono, telefonoWhatsApp } from "@/lib/formato";

export const runtime = "nodejs";
export const maxDuration = 60;

const POR_LOTE = 200;
const MAXIMO = 1000;

/**
 * Remarketing: manda una plantilla aprobada de WhatsApp a muchos leads.
 * Cada envío queda en campana_envios y en el chat del lead; Zapier
 * ("crm-plantillas-whatsapp") hace el envío y avisa el resultado.
 */
export async function POST(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });

  const hook = process.env.ZAPIER_WA_PLANTILLAS_URL;
  if (!hook) return NextResponse.json({ error: "Falta configurar ZAPIER_WA_PLANTILLAS_URL en Vercel." }, { status: 500 });

  const body = (await req.json().catch(() => ({}))) as { plantillaId?: string; leadIds?: string[]; nombre?: string; filtros?: unknown };
  const leadIds = [...new Set(body.leadIds ?? [])];
  if (!body.plantillaId || leadIds.length === 0) return NextResponse.json({ error: "Elige una plantilla y al menos un lead." }, { status: 400 });
  if (leadIds.length > MAXIMO) return NextResponse.json({ error: `Máximo ${MAXIMO} leads por envío.` }, { status: 400 });

  const db = supabaseAdmin();
  const { data: plantilla } = await db.from("plantillas").select("*").eq("id", body.plantillaId).single();
  if (!plantilla) return NextResponse.json({ error: "No encontré esa plantilla." }, { status: 404 });

  // Imagen del encabezado: enlace temporal de 7 días (Zapier la descarga al enviar)
  let imagenUrl = "";
  if (plantilla.imagen_path) {
    const { data: firmada } = await db.storage.from("archivos").createSignedUrl(plantilla.imagen_path, 7 * 24 * 3600);
    imagenUrl = firmada?.signedUrl ?? "";
  }

  // Leads con teléfono, sin repetir número
  const leads: { id: string; nombre: string; telefono: string | null }[] = [];
  for (let i = 0; i < leadIds.length; i += 200) {
    const { data } = await db.from("leads").select("id, nombre, telefono").in("id", leadIds.slice(i, i + 200));
    leads.push(...(data ?? []));
  }
  const vistos = new Set<string>();
  const destinatarios = leads.flatMap((l) => {
    const corto = normalizarTelefono(l.telefono);
    const wa = telefonoWhatsApp(l.telefono);
    if (!corto || !wa || vistos.has(corto)) return [];
    vistos.add(corto);
    return [{ lead: l, corto, wa }];
  });
  if (destinatarios.length === 0) return NextResponse.json({ error: "Ninguno de esos leads tiene teléfono." }, { status: 400 });

  const etiqueta = plantilla.titulo || plantilla.nombre;
  const { data: campana, error: errCamp } = await db.from("campanas_wa").insert({
    nombre: body.nombre?.trim() || `${etiqueta} · ${new Date().toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}`,
    plantilla_id: plantilla.id, filtros: body.filtros ?? null, total: destinatarios.length, creado_por: auth.user.id,
  }).select("id").single();
  if (errCamp || !campana) return NextResponse.json({ error: errCamp?.message ?? "No se pudo crear el envío" }, { status: 500 });

  const { data: envios, error: errEnv } = await db.from("campana_envios")
    .insert(destinatarios.map((d) => ({ campana_id: campana.id, lead_id: d.lead.id, telefono: d.wa })))
    .select("id, lead_id, telefono");
  if (errEnv || !envios) return NextResponse.json({ error: errEnv?.message ?? "No se pudieron registrar los envíos" }, { status: 500 });

  // Que cada envío quede en el chat del lead (se crea la conversación si no existía)
  const claves = destinatarios.map((d) => `wa:${d.corto}`);
  await db.from("conversaciones").upsert(
    destinatarios.map((d) => ({ zernio_conversation_id: `wa:${d.corto}`, plataforma: "whatsapp", contacto_id: d.corto, contacto_nombre: d.lead.nombre, lead_id: d.lead.id })),
    { onConflict: "zernio_conversation_id", ignoreDuplicates: true },
  );
  const convPorClave = new Map<string, string>();
  for (let i = 0; i < claves.length; i += 200) {
    const { data } = await db.from("conversaciones").select("id, zernio_conversation_id").in("zernio_conversation_id", claves.slice(i, i + 200));
    (data ?? []).forEach((c) => convPorClave.set(c.zernio_conversation_id, c.id));
  }
  const ahora = new Date().toISOString();
  const textoChat = `📣 Plantilla enviada: ${etiqueta}${plantilla.texto ? `\n\n${plantilla.texto}` : ""}`;
  const cortoPorLead = new Map(destinatarios.map((d) => [d.lead.id, d.corto]));
  const filas = envios.flatMap((e) => {
    const conv = convPorClave.get(`wa:${cortoPorLead.get(e.lead_id)}`);
    return conv ? [{
      conversacion_id: conv, zernio_message_id: `camp:${e.id}`, direccion: "saliente", texto: textoChat,
      estado: "enviado", autor: "humano", enviado_por: auth.user!.id, created_at: ahora,
    }] : [];
  });
  if (filas.length) await db.from("mensajes").insert(filas);
  const convIds = [...new Set(filas.map((f) => f.conversacion_id))];
  for (let i = 0; i < convIds.length; i += 200) {
    await db.from("conversaciones").update({ ultimo_mensaje: `📣 ${etiqueta}`, ultimo_mensaje_at: ahora }).in("id", convIds.slice(i, i + 200));
  }
  await db.from("actividades").insert(destinatarios.map((d) => ({
    lead_id: d.lead.id, tipo: "whatsapp", texto: `Remarketing: plantilla "${etiqueta}" enviada`, creado_por: auth.user!.id,
  })));

  // A Zapier en lotes
  let fallas = 0;
  for (let i = 0; i < envios.length; i += POR_LOTE) {
    const lote = envios.slice(i, i + POR_LOTE);
    try {
      const r = await fetch(hook, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          campana_id: campana.id,
          plantilla: `${plantilla.nombre}|${plantilla.idioma}`,
          imagen_url: imagenUrl,
          envios_json: JSON.stringify(lote.map((e) => ({ envio_id: e.id, telefono: e.telefono }))),
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
    } catch {
      fallas += lote.length;
      const ids = lote.map((e) => e.id);
      await db.from("campana_envios").update({ estado: "error", detalle: "Zapier no recibió el envío" }).in("id", ids);
      await db.from("mensajes").update({ estado: "error" }).in("zernio_message_id", ids.map((id) => `camp:${id}`));
    }
  }
  if (fallas) await db.from("campanas_wa").update({ errores: fallas }).eq("id", campana.id);

  return NextResponse.json({
    ok: fallas < envios.length, campanaId: campana.id, total: envios.length,
    sinTelefono: leadIds.length - destinatarios.length, fallas,
  }, { status: fallas === envios.length ? 502 : 200 });
}
