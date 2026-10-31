import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizarTelefono, telefonoWhatsApp } from "@/lib/formato";
import { whatsappPorZernio } from "@/lib/whatsapp";
import { cuentaWhatsApp, enviarPlantillaWhatsApp } from "@/lib/zernio";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const porZernio = whatsappPorZernio();
  const hook = process.env.ZAPIER_WA_PLANTILLAS_URL;
  if (!porZernio && !hook) return NextResponse.json({ error: "Falta configurar ZAPIER_WA_PLANTILLAS_URL en Vercel." }, { status: 500 });

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

  if (porZernio) {
    const r = await enviarPorZernio({ db, envios, destinatarios, plantilla, imagenUrl, etiqueta, campanaId: campana.id, usuarioId: auth.user.id });
    return NextResponse.json({ ok: r.fallas < envios.length, campanaId: campana.id, total: envios.length, sinTelefono: leadIds.length - destinatarios.length, fallas: r.fallas },
      { status: r.fallas === envios.length ? 502 : 200 });
  }

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

/** WhatsApp por Zernio: cada plantilla se manda directo y el chat queda enlazado a su conversación en Zernio. */
async function enviarPorZernio(p: {
  db: ReturnType<typeof supabaseAdmin>;
  envios: { id: string; lead_id: string; telefono: string }[];
  destinatarios: { lead: { id: string; nombre: string }; corto: string; wa: string }[];
  plantilla: any; imagenUrl: string; etiqueta: string; campanaId: string; usuarioId: string;
}) {
  const { db, plantilla, etiqueta } = p;
  const accountId = await cuentaWhatsApp();
  const porLead = new Map(p.destinatarios.map((d) => [d.lead.id, d]));
  const textoChat = `📣 Plantilla enviada: ${etiqueta}${plantilla.texto ? `\n\n${plantilla.texto}` : ""}`;
  const inicio = Date.now();
  let fallas = 0;

  for (const e of p.envios) {
    const d = porLead.get(e.lead_id)!;
    // Tiempo límite de la función: lo que no alcance se marca para reintentar
    if (!accountId || Date.now() - inicio > 270000) {
      fallas++;
      await db.from("campana_envios").update({ estado: "error", detalle: accountId ? "Se acabó el tiempo; vuelve a enviar a los pendientes" : "No hay cuenta de WhatsApp conectada en Zernio" }).eq("id", e.id);
      continue;
    }
    // Chat que ya tengamos de ese número (por Zernio o el viejo de Zapier)
    const { data: convs } = await db.from("conversaciones").select("id, zernio_conversation_id")
      .or(`zernio_conversation_id.eq.wa:${d.corto},contacto_id.eq.${d.corto},lead_id.eq.${d.lead.id}`).limit(5);
    const actual = (convs ?? []).find((c) => !String(c.zernio_conversation_id).startsWith("wa:")) ?? (convs ?? [])[0] ?? null;
    const idZernio = actual && !String(actual.zernio_conversation_id).startsWith("wa:") ? actual.zernio_conversation_id : null;
    try {
      const r = await enviarPlantillaWhatsApp({
        accountId, telefono: d.wa, plantilla: plantilla.nombre, idioma: plantilla.idioma,
        imagenUrl: p.imagenUrl || null, conversationId: idZernio, idempotencia: `camp:${e.id}`,
      });
      const convZernio = r.conversationId ?? idZernio;
      let convId = actual?.id ?? null;
      if (convZernio) {
        const { data: ya } = await db.from("conversaciones").select("id").eq("zernio_conversation_id", convZernio).maybeSingle();
        if (ya) convId = ya.id;
        else if (convId) await db.from("conversaciones").update({ zernio_conversation_id: convZernio, zernio_account_id: accountId, plataforma: "whatsapp" }).eq("id", convId);
        else {
          const { data: nueva } = await db.from("conversaciones").insert({
            zernio_conversation_id: convZernio, zernio_account_id: accountId, plataforma: "whatsapp",
            contacto_id: d.corto, contacto_nombre: d.lead.nombre, lead_id: d.lead.id,
          }).select("id").single();
          convId = nueva?.id ?? null;
        }
      }
      if (convId) {
        const ahora = new Date().toISOString();
        await db.from("mensajes").upsert({
          conversacion_id: convId, zernio_message_id: r.messageId ?? `camp:${e.id}`, direccion: "saliente", texto: textoChat,
          estado: "enviado", autor: "humano", enviado_por: p.usuarioId, created_at: ahora,
        }, { onConflict: "zernio_message_id" });
        await db.from("conversaciones").update({ ultimo_mensaje: `📣 ${etiqueta}`, ultimo_mensaje_at: ahora, lead_id: d.lead.id }).eq("id", convId);
      }
      await db.from("campana_envios").update({ estado: "enviado" }).eq("id", e.id);
    } catch (err: any) {
      fallas++;
      await db.from("campana_envios").update({ estado: "error", detalle: String(err?.message ?? "Zernio no pudo enviar").slice(0, 300) }).eq("id", e.id);
    }
  }

  await db.from("actividades").insert(p.destinatarios.map((d) => ({
    lead_id: d.lead.id, tipo: "whatsapp", texto: `Plantilla "${etiqueta}" enviada por WhatsApp`, creado_por: p.usuarioId,
  })));
  await db.from("campanas_wa").update({ enviados: p.envios.length - fallas, errores: fallas }).eq("id", p.campanaId);
  return { fallas };
}
