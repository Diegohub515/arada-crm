import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { enviarMensaje, marcarLeida } from "@/lib/zernio";

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
