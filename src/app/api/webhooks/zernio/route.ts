import { NextResponse, after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { firmaValida, leerEventoLead, leerEventoMensaje } from "@/lib/zernio";
import { buscarCampo, guardarLead, origenDePlataforma } from "@/lib/ingesta";
import { revisarRespuestaExterna } from "@/lib/agente";
import { botVivia } from "@/lib/bot/vivia";
import { normalizarTelefono } from "@/lib/formato";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // el bot corre después de contestarle a Zernio (espera + IA + pausa entre partes)

/**
 * Recibe los eventos de Zernio:
 *  - message.received / message.sent → bandeja de mensajes
 *  - lead.received → nuevo lead de formulario de Meta
 * Configúralo en Zernio → Webhooks con la URL https://TU-DOMINIO/api/webhooks/zernio
 */
export async function POST(req: Request) {
  const crudo = await req.text();
  const firma = req.headers.get("x-zernio-signature") ?? req.headers.get("x-late-signature");
  if (!firmaValida(crudo, firma)) {
    return NextResponse.json({ error: "Firma inválida" }, { status: 401 });
  }

  let p: any;
  try { p = JSON.parse(crudo); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const db = supabaseAdmin();
  const eventoId = String(req.headers.get("x-zernio-event-id") ?? p?.id ?? "");
  const tipo = String(p?.event ?? "");

  // Zernio reintenta: si ya lo procesamos, contestamos OK sin repetir.
  if (eventoId) {
    const { error } = await db.from("webhook_eventos").insert({ id: `zernio:${eventoId}`, fuente: "zernio", tipo });
    if (error?.code === "23505") return NextResponse.json({ ok: true, duplicado: true });
  }

  try {
    if (tipo === "message.received" || tipo === "message.sent") {
      await procesarMensaje(db, p, tipo === "message.received" ? "entrante" : "saliente");
    } else if (tipo === "lead.received") {
      await procesarLead(db, p);
    }
    // webhook.test y demás eventos: se aceptan sin hacer nada.
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Liberamos el evento para que el reintento de Zernio lo vuelva a intentar.
    if (eventoId) await db.from("webhook_eventos").delete().eq("id", `zernio:${eventoId}`);
    console.error("Webhook Zernio:", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}

async function procesarMensaje(db: ReturnType<typeof supabaseAdmin>, p: any, direccion: "entrante" | "saliente") {
  const m = leerEventoMensaje(p);
  if (!m.conversationId) throw new Error("El evento no trae conversation.id");

  // 1. Conversación (crear o actualizar)
  const { data: existente } = await db
    .from("conversaciones")
    .select("id, lead_id, no_leidos, contacto_nombre")
    .eq("zernio_conversation_id", m.conversationId)
    .maybeSingle();

  let conversacionId = existente?.id as string | undefined;
  let leadId = (existente?.lead_id as string | null) ?? null;
  let contactoNombre = (existente?.contacto_nombre as string | null) ?? null;
  const esWhatsApp = (m.plataforma ?? "").includes("whatsapp");
  const telefono = esWhatsApp ? normalizarTelefono(m.remitenteId) : null;

  // WhatsApp que antes entraba por Zapier ("wa:8112345678"): se pasa a Zernio sin perder el historial
  if (!conversacionId && telefono) {
    const { data: vieja } = await db.from("conversaciones").select("id, lead_id, contacto_nombre")
      .eq("zernio_conversation_id", `wa:${telefono}`).maybeSingle();
    if (vieja) {
      await db.from("conversaciones").update({
        zernio_conversation_id: m.conversationId, zernio_account_id: m.accountId, plataforma: "whatsapp", contacto_id: telefono,
      }).eq("id", vieja.id);
      conversacionId = vieja.id;
      leadId = vieja.lead_id ?? null;
      contactoNombre = vieja.contacto_nombre ?? null;
    }
  }

  if (!conversacionId) {
    const { data, error } = await db
      .from("conversaciones")
      .insert({
        zernio_conversation_id: m.conversationId,
        zernio_account_id: m.accountId,
        plataforma: m.plataforma,
        contacto_nombre: m.remitenteNombre,
        contacto_id: telefono ?? m.remitenteId,
      })
      .select("id")
      .single();
    if (error) throw error;
    conversacionId = data.id;
  }

  // 2. Lead: la primera vez que nos escribe alguien, lo damos de alta
  if (!leadId && direccion === "entrante") {
    const esTelefono = m.remitenteId && /^\+?\d[\d\s-]{7,}$/.test(m.remitenteId);
    const r = await guardarLead(db, {
      nombre: m.remitenteNombre,
      telefono: telefono ?? (esTelefono ? m.remitenteId : null),
      origen: origenDePlataforma(m.plataforma),
      notas: m.texto ? `Primer mensaje: ${m.texto}` : null,
      externalId: `zernio-conv:${m.conversationId}`,
      originales: p,
    });
    leadId = r.id;
  }

  // 3. Mensaje
  const { data: fila, error: errMsg } = await db.from("mensajes").insert({
    conversacion_id: conversacionId,
    zernio_message_id: m.messageId,
    direccion,
    texto: m.texto,
    adjuntos: m.adjuntos,
    estado: direccion === "entrante" ? "recibido" : "enviado",
    autor: direccion === "entrante" ? "cliente" : "humano",
    created_at: m.fecha,
  }).select("id").single();
  // 23505 = ya lo teníamos (p. ej. lo enviamos desde el CRM y Zernio confirma con message.sent)
  if (errMsg && errMsg.code !== "23505") throw errMsg;

  // 4. Agente de IA: contesta después de responderle OK a Zernio (Zernio solo espera 5 s).
  if (fila && direccion === "entrante") {
    // El mismo bot de Vivia Roma contesta WhatsApp, Instagram y Messenger
    after(() => botVivia(db, conversacionId!, fila.id).catch((e) => console.error("Bot Vivia:", e)));
  }
  // Alguien contestó desde el celular (WhatsApp Business) o desde Zernio: el bot se hace a un lado en ese chat.
  if (fila && direccion === "saliente" && m.enviadoPor !== "api") {
    if (m.origen === "whatsapp_business_app") {
      await db.from("conversaciones").update({ agente_activo: false, agente_motivo: "Un asesor contestó desde el celular" }).eq("id", conversacionId);
    } else {
      after(() => revisarRespuestaExterna(db, fila.id, conversacionId!, m.texto).catch(() => {}));
    }
  }

  await db
    .from("conversaciones")
    .update({
      lead_id: leadId,
      zernio_account_id: m.accountId ?? undefined,
      plataforma: m.plataforma ?? undefined,
      contacto_nombre: contactoNombre ?? m.remitenteNombre ?? undefined,
      ultimo_mensaje: m.texto,
      ultimo_mensaje_at: m.fecha,
      no_leidos: direccion === "entrante" ? (existente?.no_leidos ?? 0) + 1 : 0,
    })
    .eq("id", conversacionId);
}

async function procesarLead(db: ReturnType<typeof supabaseAdmin>, p: any) {
  const l = leerEventoLead(p);
  const c = l.campos;
  const nombre =
    buscarCampo(c, "full_name", "nombre_completo", "nombre", "name") ??
    [buscarCampo(c, "first_name"), buscarCampo(c, "last_name")].filter(Boolean).join(" ");
  await guardarLead(db, {
    nombre,
    telefono: buscarCampo(c, "phone_number", "telefono", "phone", "celular", "whatsapp"),
    email: buscarCampo(c, "email", "correo"),
    origen: "meta_formulario",
    campana: l.formId ? `Formulario ${l.formId}` : null,
    tipologia: buscarCampo(c, "tipologia", "recamaras", "departamento"),
    notas: Object.entries(c).map(([k, v]) => `${k}: ${v}`).join("\n") || null,
    externalId: l.externalId ? `meta:${l.externalId}` : null,
    originales: p,
  });
}
