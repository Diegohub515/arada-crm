import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enviarMensaje, marcarLeida } from "@/lib/zernio";
import { telefonoWhatsApp } from "@/lib/formato";
import { enlazarConZernio, whatsappPorZernio } from "@/lib/whatsapp";

export const runtime = "nodejs";

/** Contesta un chat desde el CRM. La llave de Zernio nunca sale del servidor. */
export async function POST(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });

  const { conversacionId, texto } = (await req.json().catch(() => ({}))) as { conversacionId?: string; texto?: string };
  if (!conversacionId || !texto?.trim()) {
    return NextResponse.json({ error: "Escribe un mensaje" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: conv } = await db
    .from("conversaciones")
    .select("id, zernio_conversation_id, zernio_account_id, lead_id")
    .eq("id", conversacionId)
    .single();
  if (!conv) return NextResponse.json({ error: "No encontré esa conversación" }, { status: 404 });

  // Chats de WhatsApp guardados como "wa:…" (entraron por Zapier)
  if (String(conv.zernio_conversation_id ?? "").startsWith("wa:")) {
    if (!whatsappPorZernio()) return enviarPorZapier(db, conv, texto.trim(), auth.user.id);
    // WhatsApp ya va por Zernio: se enlaza el chat con su conversación en Zernio
    const enlace = await enlazarConZernio(db, conv).catch(() => null);
    if (!enlace) {
      return NextResponse.json({ error: "Este chat todavía no existe en Zernio. Mándale una plantilla para abrirlo, o espera a que el cliente escriba." }, { status: 400 });
    }
    conv.zernio_conversation_id = enlace.conversationId;
    conv.zernio_account_id = enlace.accountId;
  }

  if (!conv.zernio_account_id) {
    return NextResponse.json({ error: "La conversación no tiene cuenta de Zernio asociada" }, { status: 400 });
  }

  const idempotencia = crypto.randomUUID();
  try {
    const r = await enviarMensaje({
      conversationId: conv.zernio_conversation_id,
      accountId: conv.zernio_account_id,
      texto: texto.trim(),
      idempotencia,
    });
    const ahora = new Date().toISOString();
    await db.from("mensajes").upsert({
      conversacion_id: conv.id,
      zernio_message_id: r.messageId,
      direccion: "saliente",
      texto: texto.trim(),
      estado: r.fallaParcial ? "error" : "enviado",
      autor: "humano",
      enviado_por: auth.user.id,
      created_at: ahora,
    }, { onConflict: "zernio_message_id" });
    // Cuando una persona contesta, el agente se hace a un lado en este chat.
    await db.from("conversaciones")
      .update({ ultimo_mensaje: texto.trim(), ultimo_mensaje_at: ahora, no_leidos: 0, agente_activo: false, agente_motivo: "Lo atiende una persona" })
      .eq("id", conv.id);
    if (conv.lead_id) {
      await db.from("actividades").insert({
        lead_id: conv.lead_id, tipo: "whatsapp", texto: `Respuesta enviada: ${texto.trim()}`, creado_por: auth.user.id,
      });
    }
    marcarLeida(conv.zernio_conversation_id);
    return NextResponse.json({ ok: true, aviso: r.fallaParcial ?? r.advertencias[0]?.message ?? null });
  } catch (e: any) {
    // WhatsApp solo deja contestar libremente 24 h después del último mensaje del cliente.
    const msg = String(e?.message ?? "");
    const ventana = /24|window|re-engagement|template/i.test(msg)
      ? " Si pasaron más de 24 horas desde su último mensaje, WhatsApp exige una plantilla aprobada."
      : "";
    return NextResponse.json({ error: `Zernio no pudo enviar el mensaje: ${msg}.${ventana}` }, { status: 502 });
  }
}

const VENTANA_MS = 24 * 60 * 60 * 1000;

async function enviarPorZapier(
  db: ReturnType<typeof supabaseAdmin>,
  conv: { id: string; zernio_conversation_id: string; lead_id: string | null },
  texto: string,
  usuarioId: string,
) {
  const hook = process.env.ZAPIER_WA_SALIDA_URL;
  if (!hook) {
    return NextResponse.json({ error: "Falta configurar ZAPIER_WA_SALIDA_URL en Vercel para contestar WhatsApp desde el CRM." }, { status: 500 });
  }

  // WhatsApp solo deja mandar texto libre dentro de las 24 h desde el último mensaje del cliente
  const { data: ultimo } = await db.from("mensajes").select("created_at")
    .eq("conversacion_id", conv.id).eq("direccion", "entrante")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!ultimo || Date.now() - new Date(ultimo.created_at).getTime() > VENTANA_MS) {
    return NextResponse.json({
      error: "Pasaron más de 24 horas desde el último mensaje del cliente. WhatsApp solo permite mandarle una plantilla aprobada (como las de RMKT).",
    }, { status: 400 });
  }

  const telefono = telefonoWhatsApp(conv.zernio_conversation_id.slice(3));
  const mensajeId = crypto.randomUUID();
  const ahora = new Date().toISOString();
  const { data: fila, error } = await db.from("mensajes").insert({
    conversacion_id: conv.id,
    zernio_message_id: `crm:${mensajeId}`,
    direccion: "saliente", texto, estado: "enviado", autor: "humano",
    enviado_por: usuarioId, created_at: ahora,
  }).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let ok = false;
  try {
    const r = await fetch(hook, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ telefono, texto, mensaje_id: mensajeId }),
    });
    ok = r.ok;
  } catch { ok = false; }

  if (!ok) {
    await db.from("mensajes").update({ estado: "error" }).eq("id", fila.id);
    return NextResponse.json({ error: "Zapier no recibió el mensaje. Revisa que la automatización \"crm-a-whatsapp\" esté prendida." }, { status: 502 });
  }

  // Cuando un asesor contesta, el bot de WhatsApp se hace a un lado en este chat.
  await db.from("conversaciones")
    .update({ ultimo_mensaje: texto, ultimo_mensaje_at: ahora, no_leidos: 0, agente_activo: false, agente_motivo: "Lo atiende una persona" })
    .eq("id", conv.id);
  if (conv.lead_id) {
    await db.from("actividades").insert({ lead_id: conv.lead_id, tipo: "whatsapp", texto: `Respuesta enviada: ${texto}`, creado_por: usuarioId });
  }
  return NextResponse.json({ ok: true, aviso: null });
}
