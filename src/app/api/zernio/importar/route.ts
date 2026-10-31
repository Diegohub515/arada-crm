import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { cuentaWhatsApp, listarConversaciones, listarMensajes } from "@/lib/zernio";
import { guardarLead } from "@/lib/ingesta";
import { normalizarTelefono } from "@/lib/formato";

export const runtime = "nodejs";
export const maxDuration = 300;

const LIMITE_MS = 240000;
const MAX_MENSAJES_POR_CHAT = 1000;

/**
 * Trae al CRM el historial de chats de WhatsApp que Zernio sincronizó (hasta 6 meses).
 * Se llama varias veces: cada llamada procesa lo que alcanza y regresa el cursor para seguir.
 * No hace que el bot conteste nada.
 */
export async function POST(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });

  const { cursor } = (await req.json().catch(() => ({}))) as { cursor?: string | null };
  const db = supabaseAdmin();
  const accountId = await cuentaWhatsApp().catch(() => null);
  if (!accountId) return NextResponse.json({ error: "No encontré WhatsApp conectado en Zernio. Conéctalo primero." }, { status: 400 });

  const inicio = Date.now();
  let siguiente: string | null = cursor ?? null;
  let chats = 0, mensajes = 0, terminado = false;

  try {
    while (Date.now() - inicio < LIMITE_MS) {
      const pagina = await listarConversaciones(accountId, siguiente);
      for (const c of pagina.conversaciones) {
        if (Date.now() - inicio > LIMITE_MS) break;
        mensajes += await importarChat(db, accountId, c);
        chats++;
      }
      siguiente = pagina.siguiente;
      if (!pagina.hayMas || !siguiente) { terminado = true; break; }
    }
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error al importar", chats, mensajes, cursor: siguiente }, { status: 502 });
  }
  return NextResponse.json({ ok: true, chats, mensajes, cursor: terminado ? null : siguiente, terminado });
}

async function importarChat(db: ReturnType<typeof supabaseAdmin>, accountId: string, c: any) {
  const idZernio: string = c.id;
  if (!idZernio) return 0;
  const telefono = normalizarTelefono(c.participantId ?? c.participant?.phone ?? c.participant?.id ?? c.participantPhone ?? c.contactPhone ?? c.phone);
  const nombre = String(c.participantName ?? c.participant?.name ?? c.contactName ?? c.name ?? "").trim() || null;

  // 1. Chat en el CRM: el de Zernio, el viejo de Zapier ("wa:…") o uno nuevo
  let { data: conv } = await db.from("conversaciones").select("id, lead_id").eq("zernio_conversation_id", idZernio).maybeSingle();
  if (!conv && telefono) {
    const { data: vieja } = await db.from("conversaciones").select("id, lead_id").eq("zernio_conversation_id", `wa:${telefono}`).maybeSingle();
    if (vieja) {
      await db.from("conversaciones").update({ zernio_conversation_id: idZernio, zernio_account_id: accountId, plataforma: "whatsapp" }).eq("id", vieja.id);
      conv = vieja;
    }
  }
  if (!conv) {
    const lead = telefono
      ? await guardarLead(db, { nombre, telefono, origen: "whatsapp", externalId: `zernio-conv:${idZernio}`, notas: "Chat importado del historial de WhatsApp", extra: { primer_contacto: "WhatsApp" }, sinAsignar: true })
      : null;
    const { data: nueva, error } = await db.from("conversaciones").insert({
      zernio_conversation_id: idZernio, zernio_account_id: accountId, plataforma: "whatsapp",
      contacto_id: telefono, contacto_nombre: nombre, lead_id: lead?.id ?? null,
    }).select("id, lead_id").single();
    if (error) throw error;
    conv = nueva;
  }

  // 2. Lo que ya está en el CRM (desde que corre el bot) no se vuelve a meter: solo lo anterior
  const { data: primero } = await db.from("mensajes").select("created_at").eq("conversacion_id", conv!.id)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  const antesDe = primero ? new Date(primero.created_at).getTime() - 60000 : Infinity;

  let cursor: string | null = null;
  let total = 0;
  let ultimo: { texto: string; fecha: string } | null = null;
  do {
    const pag = await listarMensajes(idZernio, accountId, cursor);
    const filas = pag.mensajes
      .filter((m) => new Date(m.createdAt ?? m.sentAt ?? m.timestamp ?? 0).getTime() < antesDe)
      .map((m) => {
        const entrante = /^(incoming|inbound|in|received)$/i.test(String(m.direction ?? m.type ?? "")) || m.isFromMe === false || m.fromMe === false;
        const adj = Array.isArray(m.attachments) && m.attachments.length ? m.attachments : null;
        const texto = String(m.message ?? m.text ?? m.content ?? m.body ?? "").trim() || (adj ? `📎 ${adj[0]?.type === "image" ? "Imagen" : adj[0]?.type === "audio" ? "Audio" : "Archivo adjunto"}` : "");
        return {
          conversacion_id: conv!.id, zernio_message_id: m.platformMessageId ?? m.id ?? m._id ?? null, direccion: entrante ? "entrante" : "saliente",
          texto, adjuntos: adj, estado: entrante ? "recibido" : "enviado", autor: entrante ? "cliente" : "humano",
          created_at: m.createdAt ?? m.sentAt ?? m.timestamp ?? new Date().toISOString(),
        };
      })
      .filter((f) => f.zernio_message_id);
    if (filas.length) {
      await db.from("mensajes").upsert(filas, { onConflict: "zernio_message_id", ignoreDuplicates: true });
      total += filas.length;
      const u = filas[filas.length - 1];
      ultimo = { texto: u.texto, fecha: u.created_at };
    }
    cursor = pag.siguiente;
  } while (cursor && total < MAX_MENSAJES_POR_CHAT);

  // 3. Si el chat era nuevo en el CRM, se acomoda en la Bandeja con su último mensaje
  if (ultimo && antesDe === Infinity) {
    await db.from("conversaciones").update({ ultimo_mensaje: ultimo.texto, ultimo_mensaje_at: ultimo.fecha }).eq("id", conv!.id);
  }
  // Lead creado por la importación: su fecha es la del primer mensaje del chat, no la de hoy
  if (conv!.lead_id) {
    const { data: pm } = await db.from("mensajes").select("created_at").eq("conversacion_id", conv!.id)
      .order("created_at", { ascending: true }).limit(1).maybeSingle();
    if (pm) await db.from("leads").update({ created_at: pm.created_at }).eq("id", conv!.lead_id).ilike("notas", "%importado del historial%").gt("created_at", pm.created_at);
  }
  return total;
}
