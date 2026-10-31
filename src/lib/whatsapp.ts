import type { SupabaseClient } from "@supabase/supabase-js";
import { buscarConversacionWhatsApp, cuentaWhatsApp } from "./zernio";

/** "zernio" cuando WhatsApp ya está conectado en Zernio; "zapier" mientras siga el flujo de Zapier. */
export const whatsappPorZernio = () => (process.env.WHATSAPP_VIA ?? "zapier").toLowerCase() === "zernio";

/**
 * Chats que entraron por Zapier se guardaron como "wa:8112345678".
 * Cuando WhatsApp ya va por Zernio, busca su conversación en Zernio y la enlaza (sin perder el historial).
 * Regresa los ids de Zernio, o null si en Zernio todavía no hay plática con ese número.
 */
export async function enlazarConZernio(db: SupabaseClient, conv: { id: string; zernio_conversation_id: string | null; zernio_account_id?: string | null }) {
  const clave = String(conv.zernio_conversation_id ?? "");
  if (!clave.startsWith("wa:")) {
    return conv.zernio_account_id ? { conversationId: clave, accountId: conv.zernio_account_id } : null;
  }
  const accountId = await cuentaWhatsApp();
  if (!accountId) return null;
  const encontrada = await buscarConversacionWhatsApp(accountId, clave.slice(3));
  if (!encontrada) return null;
  // Si ya existe otra fila con esa conversación de Zernio (llegó un mensaje nuevo antes), no se toca
  const { data: otra } = await db.from("conversaciones").select("id").eq("zernio_conversation_id", encontrada).maybeSingle();
  if (otra && otra.id !== conv.id) return { conversationId: encontrada, accountId, filaExistente: otra.id as string };
  await db.from("conversaciones").update({ zernio_conversation_id: encontrada, zernio_account_id: accountId, plataforma: "whatsapp" }).eq("id", conv.id);
  return { conversationId: encontrada, accountId };
}
