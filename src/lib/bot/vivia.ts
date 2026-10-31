import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarMensaje } from "../zernio";
import { SYSTEM_PROMPT } from "./prompt";
import { ESTILO_EXTRA } from "./estilo";

/**
 * Bot de WhatsApp de Vivia Roma corriendo dentro del CRM (WhatsApp por Zernio).
 * Hace lo mismo que el workflow de Zapier "whatsapp-a-arada-crm":
 * prompt de Vivia Roma + estilo + nombre del cliente + lecciones aprobadas,
 * y entiende las etiquetas TRANSFERIR_ASESOR, [ENVIAR_PRECIOS_ROMA],
 * [ENVIAR_BROCHURE_ROMA], [ENVIAR_BROCHURE_SANTA_CATARINA], [NOMBRE: …] y "|||".
 */

const ESPERA_MS = 4000;          // por si el cliente manda varios mensajes seguidos
const PAUSA_ENTRE_PARTES_MS = 15000;
const MODELO = process.env.ANTHROPIC_MODEL_BOT || "claude-haiku-4-5-20251001";

const SITIO = (process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://arada-crm.vercel.app")).replace(/\/$/, "");

const LISTA_PRECIOS = {
  url: `${SITIO}/bot/lista-precios-vro-2026-10.jpg`,
  texto: "Aquí tienes nuestra lista de precios de Vivia Roma 🏡 Además, hoy tenemos descuento de hasta $300,000. ¿Cuál tipología te late más?",
};
const BROCHURE_ROMA = { url: `${SITIO}/bot/brochure-vro.jpg`, texto: "¡Aquí tienes el brochure de Vivia Roma! 😊" };
const BROCHURE_SC = {
  url: "https://www.dropbox.com/scl/fi/u7b1u09s6qeci4t9424p5/LocalesComercialesVSC.pdf?rlkey=74ktfo6x2zrnd880qnejjz8ql&st=9hhhws6j&dl=1",
  texto: "¡Aquí tienes el brochure de Vivia Santa Catarina! 😊",
};
const AVISO_ASESOR = "¡Gracias por tu mensaje! 😊 En un momento un asesor de Vivia Roma se pondrá en contacto contigo.";

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ¿Es un nombre de verdad y no "Sin nombre" o un teléfono? */
export function nombreReal(n: unknown) {
  const s = String(n ?? "").trim();
  return !!s && s.toLowerCase() !== "sin nombre" && !/^\+?[\d\s-]{7,}$/.test(s);
}

export async function botVivia(db: SupabaseClient, conversacionId: string, mensajeId: string) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  await dormir(ESPERA_MS);

  // 1. Solo contesta el último mensaje del cliente
  const ultimo = async () => {
    const { data } = await db.from("mensajes").select("id, direccion").eq("conversacion_id", conversacionId)
      .order("created_at", { ascending: false }).limit(1);
    return data?.[0];
  };
  const u = await ultimo();
  if (!u || u.id !== mensajeId || u.direccion !== "entrante") return;

  const [{ data: config }, { data: conv }] = await Promise.all([
    db.from("agente_config").select("activo").eq("id", 1).maybeSingle(),
    db.from("conversaciones").select("*").eq("id", conversacionId).single(),
  ]);
  // Interruptor general (Agente IA) y pausa por chat
  if (!config?.activo || !conv?.agente_activo || !conv.zernio_account_id || String(conv.zernio_conversation_id).startsWith("wa:")) return;

  const [{ data: msgs }, { data: lead }, { data: lecciones }] = await Promise.all([
    db.from("mensajes").select("direccion, texto, created_at").eq("conversacion_id", conversacionId)
      .order("created_at", { ascending: false }).limit(30),
    conv.lead_id ? db.from("leads").select("id, nombre, etapa").eq("id", conv.lead_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from("agente_lecciones").select("texto, categoria").eq("estado", "aprobada").order("created_at").limit(60),
  ]);

  // El bot de Zapier solo contestaba texto: si mandan solo una imagen o audio, se deja para el asesor
  const ultimoTexto = (msgs ?? [])[0]?.texto ?? "";
  if (!ultimoTexto.trim() || ultimoTexto.startsWith("📎")) return;

  const turnos = armarTurnos(msgs ?? []);
  if (!turnos) return;

  let textoLecciones = "";
  for (const l of lecciones ?? []) {
    const linea = `- (${l.categoria}) ${l.texto}\n`;
    if (textoLecciones.length + linea.length > 4000) break;
    textoLecciones += linea;
  }
  const nombreConocido = nombreReal((lead as any)?.nombre) ? (lead as any).nombre : nombreReal(conv.contacto_nombre) ? conv.contacto_nombre : "";
  const sistema = SYSTEM_PROMPT + ESTILO_EXTRA
    + `\n\nNOMBRE DEL CLIENTE QUE YA SABEMOS: ${nombreConocido || "todavía no lo sabemos"}`
    + (textoLecciones ? `\n\nLECCIONES APRENDIDAS DE CHATS ANTERIORES (aprobadas por el equipo; síguelas, pero los precios, descuentos y reglas de arriba siempre mandan):\n${textoLecciones}` : "");

  const crudo = await preguntarIA(sistema, turnos);
  if (!crudo) return;

  // 2. Antes de mandar: si llegó otro mensaje o una persona tomó el chat, no contestamos
  const u2 = await ultimo();
  if (u2?.id !== mensajeId) return;
  const { data: sigue } = await db.from("conversaciones").select("agente_activo").eq("id", conversacionId).single();
  if (!sigue?.agente_activo) return;

  // 3. Etiquetas
  const etiqueta = crudo.match(/\[NOMBRE:\s*([^\]]{1,60})\]/i);
  const nombreNuevo = etiqueta ? etiqueta[1].trim() : "";
  const respuesta = crudo.replace(/\s*\[NOMBRE:[^\]]*\]\s*/gi, " ").replace(/ +\n/g, "\n").trim();
  const r = respuesta.toLowerCase();
  const transferir = r.includes("transferir_asesor");
  const brochureRoma = r.includes("enviar_brochure_roma");
  const brochureSC = r.includes("enviar_brochure_santa_catarina");
  const precios = !transferir && r.includes("enviar_precios_roma");
  const normal = !transferir && !brochureRoma && !brochureSC && !precios;

  let n = 0;
  const enviar = async (texto: string, adjunto?: { url: string; tipo: "image" | "file"; nombre?: string }, guardarComo?: string) => {
    let estado = "enviado";
    let zernioId: string | null = null;
    try {
      const env = await enviarMensaje({
        conversationId: conv.zernio_conversation_id,
        accountId: conv.zernio_account_id,
        texto,
        adjuntoUrl: adjunto?.url,
        adjuntoTipo: adjunto?.tipo,
        adjuntoNombre: adjunto?.nombre,
        idempotencia: crypto.createHash("sha256").update(`bot:${mensajeId}:${n++}`).digest("hex"),
      });
      zernioId = env.messageId;
    } catch (e) {
      console.error("Bot Vivia, envío:", e);
      estado = "error";
    }
    const ahora = new Date().toISOString();
    const fila = { conversacion_id: conversacionId, zernio_message_id: zernioId, direccion: "saliente", texto: guardarComo ?? texto, estado, autor: "agente", created_at: ahora };
    if (zernioId) await db.from("mensajes").upsert(fila, { onConflict: "zernio_message_id" });
    else await db.from("mensajes").insert(fila);
    await db.from("conversaciones").update({ ultimo_mensaje: guardarComo ?? texto, ultimo_mensaje_at: ahora, no_leidos: 0 }).eq("id", conversacionId);
  };

  if (transferir) {
    const resumen = respuesta.split("|").slice(1).join("|").trim();
    await enviar(AVISO_ASESOR, undefined, `${AVISO_ASESOR}\n\n[Pasa a asesor${resumen ? ": " + resumen : ""}]`);
    await db.from("conversaciones").update({ agente_activo: false, agente_motivo: `Pasa a asesor${resumen ? ": " + resumen.slice(0, 200) : ""}` }).eq("id", conversacionId);
    if (lead) await db.from("actividades").insert({ lead_id: (lead as any).id, tipo: "sistema", texto: `El bot pasó el chat a un asesor${resumen ? ": " + resumen : ""}.` });
  }

  if (normal) {
    const parte1 = parteDe(respuesta, 0);
    const parte2 = parteDe(respuesta, 1);
    if (parte1.trim()) {
      await enviar(parte1);
      if (parte2.trim()) {
        await dormir(PAUSA_ENTRE_PARTES_MS);
        // Si el cliente escribió en la pausa, la segunda parte ya no se manda
        const u3 = await ultimo();
        const { data: aun } = await db.from("conversaciones").select("agente_activo").eq("id", conversacionId).single();
        if (u3?.direccion === "saliente" && aun?.agente_activo) await enviar(parte2);
      }
    }
  }

  if (precios) await enviar(LISTA_PRECIOS.texto, { url: LISTA_PRECIOS.url, tipo: "image" }, `[Se envió la lista de precios de Vivia Roma]\n${LISTA_PRECIOS.texto}`);
  if (brochureRoma) await enviar(BROCHURE_ROMA.texto, { url: BROCHURE_ROMA.url, tipo: "image" }, "[Se envió el brochure de Vivia Roma]");
  if (brochureSC) await enviar(BROCHURE_SC.texto, { url: BROCHURE_SC.url, tipo: "file", nombre: "Brochure_Vivia_SC.pdf" }, "[Se envió el brochure de Vivia Santa Catarina]");

  // 4. Nombre que dijo el cliente y etapa del lead
  if (nombreNuevo) {
    await db.from("conversaciones").update({ contacto_nombre: nombreNuevo.slice(0, 80) }).eq("id", conversacionId);
    if (lead && !nombreReal((lead as any).nombre)) await db.from("leads").update({ nombre: nombreNuevo.slice(0, 80) }).eq("id", (lead as any).id);
  }
  if (lead && (lead as any).etapa === "nuevo") await db.from("leads").update({ etapa: "contactado" }).eq("id", (lead as any).id);
}

/** Historial en turnos alternados cliente/bot, como lo pide la API. */
function armarTurnos(msgs: { direccion: string; texto: string | null }[]) {
  const turnos: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of [...msgs].reverse()) {
    const role = m.direccion === "entrante" ? ("user" as const) : ("assistant" as const);
    const content = (m.texto || "(archivo adjunto)").slice(0, 2000);
    const prev = turnos[turnos.length - 1];
    if (prev && prev.role === role) prev.content += "\n" + content;
    else turnos.push({ role, content });
  }
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  if (!turnos.length || turnos[turnos.length - 1].role !== "user") return null;
  return turnos;
}

function parteDe(texto: string, indice: number) {
  return texto.split("\n").filter(Boolean).map((l) => l.split("|||")[indice] ?? "").join("\n").trim();
}

async function preguntarIA(sistema: string, turnos: { role: "user" | "assistant"; content: string }[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO, max_tokens: 700, system: sistema, messages: turnos }),
  });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Bot Vivia, IA:", datos?.error?.message ?? r.status);
    return null;
  }
  return (datos.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || null;
}
