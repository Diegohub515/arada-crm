import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enviarMensaje } from "./zernio";

/**
 * Agente de IA que contesta solo los chats de WhatsApp, Instagram y Messenger.
 * - Su prompt se edita en el CRM (Conexiones → Agente IA), tabla agente_config.
 * - Se puede apagar en general o por conversación.
 * - Se pausa solo cuando pasa el chat a una persona o cuando alguien del equipo contesta.
 */

const ESPERA_MS = 5000; // espera a que el cliente termine de escribir varios mensajes seguidos

const REGLAS_BASE = `Eres el asistente de ventas por chat de una desarrolladora inmobiliaria en Monterrey, México.
Escribes como una persona del equipo comercial: español de México, cálido, profesional y breve.

Reglas:
- Máximo 2 o 3 oraciones por mensaje. Nada de listas largas ni párrafos.
- Haz UNA sola pregunta por mensaje para calificar al cliente, en este orden aproximado:
  1) para vivir o para invertir, 2) cuántas recámaras, 3) presupuesto aproximado o si usaría crédito, 4) cuándo planea comprar.
- Cuando ya tengas al menos 2 de esos datos, o el cliente muestre interés claro, ofrece agendar visita al showroom con día y hora concretos.
- Usa SOLO la información del negocio que aparece abajo. Si te preguntan algo que no está ahí (precios exactos, fechas de entrega, metros, amenidades no mencionadas, descuentos), di que un asesor se lo confirma y marca pasar_a_humano.
- Nunca inventes precios, promociones, fechas ni disponibilidad.
- Pasa a humano si: el cliente lo pide, está molesto, pregunta algo legal o de contrato, ya confirmó una cita, o la conversación se atora.
- No menciones que eres una IA a menos que te lo pregunten directamente; si preguntan, dilo con honestidad.
- Si el cliente escribe en otro idioma, contesta en ese idioma.`;

const HERRAMIENTA = {
  name: "responder",
  description: "Envía la respuesta al cliente y guarda lo que aprendiste de él.",
  input_schema: {
    type: "object",
    properties: {
      mensaje: { type: "string", description: "Texto exacto que se enviará al cliente." },
      datos: {
        type: "object",
        description: "Solo los datos que el cliente dijo explícitamente. Omite lo que no sepas.",
        properties: {
          nombre: { type: "string" },
          email: { type: "string" },
          proposito: { type: "string", enum: ["vivir", "invertir", "ambos"] },
          recamaras: { type: "string", description: "Ej. '2 recámaras'" },
          presupuesto_mxn: { type: "number" },
          forma_pago: { type: "string", description: "contado, crédito bancario, Infonavit, etc." },
          cuando_compra: { type: "string", description: "Ej. 'este mes', '3 a 6 meses'" },
        },
      },
      cita: {
        type: "object",
        description: "Solo si el cliente CONFIRMÓ día y hora para visitar el showroom.",
        properties: {
          fecha: { type: "string", description: "AAAA-MM-DD" },
          hora: { type: "string", description: "HH:MM" },
        },
      },
      temperatura: { type: "string", enum: ["frio", "tibio", "caliente"] },
      pasar_a_humano: { type: "boolean" },
      motivo: { type: "string", description: "Por qué pasa a humano (si aplica), en una frase." },
    },
    required: ["mensaje", "temperatura", "pasar_a_humano"],
  },
} as const;

type Salida = {
  mensaje: string;
  datos?: {
    nombre?: string; email?: string; proposito?: string; recamaras?: string;
    presupuesto_mxn?: number; forma_pago?: string; cuando_compra?: string;
  };
  cita?: { fecha?: string; hora?: string };
  temperatura: "frio" | "tibio" | "caliente";
  pasar_a_humano: boolean;
  motivo?: string;
};

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ejecutarAgente(db: SupabaseClient, conversacionId: string, mensajeId: string) {
  if (!process.env.ANTHROPIC_API_KEY) return;
  await dormir(ESPERA_MS);

  // 1. ¿Sigue siendo el último mensaje del cliente y nadie ha contestado?
  const { data: ultimos } = await db
    .from("mensajes").select("id, direccion")
    .eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: false }).limit(1);
  if (!ultimos?.length || ultimos[0].id !== mensajeId || ultimos[0].direccion !== "entrante") return;

  const [{ data: config }, { data: conv }] = await Promise.all([
    db.from("agente_config").select("*").eq("id", 1).maybeSingle(),
    db.from("conversaciones").select("*").eq("id", conversacionId).single(),
  ]);
  if (!config?.activo || !conv?.agente_activo || !conv.zernio_account_id) return;

  const [{ data: msgs }, { data: lead }] = await Promise.all([
    db.from("mensajes").select("direccion, texto, autor, created_at")
      .eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(30),
    conv.lead_id ? db.from("leads").select("*").eq("id", conv.lead_id).single() : Promise.resolve({ data: null }),
  ]);

  const turnos = armarTurnos(msgs ?? []);
  if (!turnos) return;

  const salida = await generarRespuesta({ config, turnos, lead, plataforma: conv.plataforma });
  if (!salida?.mensaje?.trim()) return;

  // 3. Volver a revisar: si en estos segundos contestó una persona o llegó otro mensaje, no enviamos.
  const { data: revision } = await db
    .from("mensajes").select("id").eq("conversacion_id", conversacionId)
    .order("created_at", { ascending: false }).limit(1);
  if (revision?.[0]?.id !== mensajeId) return;
  const { data: sigue } = await db.from("conversaciones").select("agente_activo").eq("id", conversacionId).single();
  if (!sigue?.agente_activo) return;

  // 4. Enviar por Zernio y guardar
  const texto = salida.mensaje.trim();
  let estado = "enviado";
  let zernioId: string | null = null;
  try {
    const env = await enviarMensaje({
      conversationId: conv.zernio_conversation_id,
      accountId: conv.zernio_account_id,
      texto,
      idempotencia: crypto.createHash("sha256").update(`agente:${mensajeId}`).digest("hex"),
    });
    zernioId = env.messageId;
    if (env.fallaParcial) estado = "error";
  } catch (e) {
    console.error("Agente IA, envío:", e);
    estado = "error";
  }
  const ahoraISO = new Date().toISOString();
  await db.from("mensajes").upsert(
    { conversacion_id: conversacionId, zernio_message_id: zernioId, direccion: "saliente", texto, estado, autor: "agente", created_at: ahoraISO },
    { onConflict: "zernio_message_id" }
  );
  await db.from("conversaciones").update({ ultimo_mensaje: texto, ultimo_mensaje_at: ahoraISO, no_leidos: 0 }).eq("id", conversacionId);

  await aplicarSalida(db, conversacionId, lead, salida);
}

/** Junta el historial en turnos alternados cliente/asistente, como lo pide la API. */
function armarTurnos(msgs: { direccion: string; texto: string | null }[]) {
  const historial = [...msgs].reverse().map((m) => ({
    role: m.direccion === "entrante" ? ("user" as const) : ("assistant" as const),
    content: m.texto || "(archivo adjunto)",
  }));
  const turnos: { role: "user" | "assistant"; content: string }[] = [];
  for (const h of historial) {
    const prev = turnos[turnos.length - 1];
    if (prev && prev.role === h.role) prev.content += "\n" + h.content;
    else turnos.push({ ...h });
  }
  while (turnos.length && turnos[0].role !== "user") turnos.shift();
  if (!turnos.length || turnos[turnos.length - 1].role !== "user") return null;
  return turnos;
}

/** Guarda en la ficha lo que el agente aprendió y, si aplica, pasa el chat a una persona. */
async function aplicarSalida(db: SupabaseClient, conversacionId: string, lead: any, salida: Salida) {
  // Actualizar el lead con lo aprendido
  if (lead) {
    const d = salida.datos ?? {};
    const cambios: Record<string, unknown> = {};
    if (d.nombre && (!lead.nombre || lead.nombre === "Sin nombre")) cambios.nombre = d.nombre;
    if (d.email && !lead.email) cambios.email = d.email;
    if (d.recamaras && !lead.tipologia) cambios.tipologia = d.recamaras;
    if (d.presupuesto_mxn && !lead.presupuesto) cambios.presupuesto = d.presupuesto_mxn;
    if (lead.etapa === "nuevo") cambios.etapa = "contactado";

    const notasNuevas = [
      d.proposito && `Propósito: ${d.proposito}`,
      d.forma_pago && `Forma de pago: ${d.forma_pago}`,
      d.cuando_compra && `Cuándo compra: ${d.cuando_compra}`,
    ].filter((x): x is string => !!x && !(lead.notas ?? "").includes(x));
    if (notasNuevas.length) cambios.notas = [lead.notas, ...notasNuevas].filter(Boolean).join("\n");

    if (salida.cita?.fecha) {
      cambios.etapa = "cita";
      cambios.proximo_seguimiento = salida.cita.fecha;
      await db.from("actividades").insert({
        lead_id: lead.id, tipo: "cita",
        texto: `Cita en showroom agendada por el agente: ${salida.cita.fecha}${salida.cita.hora ? " a las " + salida.cita.hora : ""}. Confirmar con un asesor.`,
      });
    }
    if (Object.keys(cambios).length) await db.from("leads").update(cambios).eq("id", lead.id);
  }

  // Pasar a una persona
  if (salida.pasar_a_humano || salida.cita?.fecha) {
    const motivo = salida.cita?.fecha ? "Cita agendada" : salida.motivo || "El agente necesita apoyo";
    await db.from("conversaciones").update({ agente_activo: false, agente_motivo: motivo }).eq("id", conversacionId);
    if (lead) {
      await db.from("actividades").insert({
        lead_id: lead.id, tipo: "sistema", texto: `El agente pasó el chat a una persona: ${motivo}. Temperatura: ${salida.temperatura}.`,
      });
    }
  }
}

/**
 * Versión para Zapier (WhatsApp sin Zernio): genera la respuesta, la guarda y la regresa
 * para que Zapier la envíe. Devuelve null si el agente no debe contestar.
 */
export async function responderParaZapier(db: SupabaseClient, conversacionId: string): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const [{ data: config }, { data: conv }] = await Promise.all([
    db.from("agente_config").select("*").eq("id", 1).maybeSingle(),
    db.from("conversaciones").select("*").eq("id", conversacionId).single(),
  ]);
  if (!config?.activo || !conv?.agente_activo) return null;
  const [{ data: msgs }, { data: lead }] = await Promise.all([
    db.from("mensajes").select("direccion, texto").eq("conversacion_id", conversacionId).order("created_at", { ascending: false }).limit(30),
    conv.lead_id ? db.from("leads").select("*").eq("id", conv.lead_id).single() : Promise.resolve({ data: null }),
  ]);
  const turnos = armarTurnos(msgs ?? []);
  if (!turnos) return null;
  const salida = await generarRespuesta({ config, turnos, lead, plataforma: "whatsapp" });
  const texto = salida?.mensaje?.trim();
  if (!salida || !texto) return null;
  const ahora = new Date().toISOString();
  await db.from("mensajes").insert({ conversacion_id: conversacionId, direccion: "saliente", texto, estado: "enviado", autor: "agente", created_at: ahora });
  await db.from("conversaciones").update({ ultimo_mensaje: texto, ultimo_mensaje_at: ahora, no_leidos: 0 }).eq("id", conversacionId);
  await aplicarSalida(db, conversacionId, lead, salida);
  return texto;
}

/**
 * Cuando llega un "message.sent" que no salió del CRM (alguien contestó desde el celular
 * o desde Zernio), pausamos el agente en ese chat para no responder encima de una persona.
 */
export async function revisarRespuestaExterna(db: SupabaseClient, mensajeRowId: string, conversacionId: string, texto: string) {
  await dormir(8000);
  const { data: fila } = await db.from("mensajes").select("id, autor, enviado_por, zernio_message_id").eq("id", mensajeRowId).maybeSingle();
  if (!fila) return;
  if (fila.autor === "agente" || fila.enviado_por) return; // fue nuestro

  // Si Zernio no mandó id, puede ser un duplicado de algo que enviamos nosotros
  const hace5 = new Date(Date.now() - 5 * 60000).toISOString();
  const { data: gemelos } = await db
    .from("mensajes").select("id")
    .eq("conversacion_id", conversacionId).eq("direccion", "saliente").eq("texto", texto)
    .neq("id", mensajeRowId).gte("created_at", hace5).limit(1);
  if (gemelos?.length) {
    await db.from("mensajes").delete().eq("id", mensajeRowId);
    return;
  }
  await db.from("conversaciones")
    .update({ agente_activo: false, agente_motivo: "Una persona contestó desde otra app" })
    .eq("id", conversacionId);
}

/** Pide a la IA la siguiente respuesta. También se usa para probar el agente desde el CRM. */
export async function generarRespuesta(p: {
  config: { nombre: string; instrucciones: string; horario_showroom: string | null };
  turnos: { role: "user" | "assistant"; content: string }[];
  lead: any;
  plataforma: string | null;
}): Promise<Salida | null> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY en Vercel.");
  const { config, turnos, lead } = p;
  const ahora = new Date().toLocaleString("es-MX", { timeZone: "America/Monterrey", dateStyle: "full", timeStyle: "short" });
  const sistema = `${REGLAS_BASE}

Tu nombre: ${config.nombre}.
Fecha y hora actual en Monterrey: ${ahora}.
Horario del showroom: ${config.horario_showroom ?? "consultar con un asesor"}.
Canal: ${p.plataforma ?? "chat"}.

INFORMACIÓN DEL NEGOCIO E INSTRUCCIONES DEL EQUIPO:
${config.instrucciones}

LO QUE YA SABEMOS DEL CLIENTE:
${lead ? JSON.stringify({ nombre: lead.nombre, etapa: lead.etapa, tipologia: lead.tipologia, presupuesto: lead.presupuesto, notas: lead.notas }) : "Nada todavía."}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL_AGENTE || "claude-haiku-5-5",
      max_tokens: 800,
      system: sistema,
      tools: [HERRAMIENTA],
      tool_choice: { type: "tool", name: "responder" },
      messages: turnos,
    }),
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(datos?.error?.message ?? `La IA respondió ${r.status}`);
  const bloque = (datos.content ?? []).find((b: any) => b.type === "tool_use");
  return (bloque?.input as Salida) ?? null;
}

export type { Salida };
