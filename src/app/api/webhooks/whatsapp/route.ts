import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { guardarLead } from "@/lib/ingesta";
import { responderParaZapier } from "@/lib/agente";
import { normalizarTelefono } from "@/lib/formato";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * WhatsApp por Zapier (sin mudar el número a Zernio).
 *
 * En tu Zap de WhatsApp agrega "Webhooks by Zapier → POST" a:
 *   https://TU-DOMINIO/api/webhooks/whatsapp?token=TU_LEADS_WEBHOOK_TOKEN
 * con estos campos (JSON):
 *   telefono  → número del cliente
 *   nombre    → nombre del perfil de WhatsApp
 *   mensaje   → texto que mandó
 *   mensaje_id (opcional) → id del mensaje, evita duplicados si Zapier reintenta
 *   direccion (opcional) → "saliente" si registras un mensaje que mandó un asesor
 *   autor (opcional) → "bot" si el saliente lo mandó un bot (no pausa al agente)
 *   solo_registrar (opcional) → true para guardar el chat sin que conteste el agente del CRM
 *
 * Responde: { responder: true|false, respuesta: "texto para enviar" }
 * Después agrega en el Zap: Filtro "responder es true" → acción de WhatsApp que envía {{respuesta}}.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let p: Record<string, any> = {};
  try {
    const tipo = req.headers.get("content-type") ?? "";
    if (tipo.includes("application/json")) p = await req.json();
    else { const f = await req.formData(); f.forEach((v, k) => { p[k] = String(v); }); }
  } catch {
    return NextResponse.json({ error: "No pude leer la petición" }, { status: 400 });
  }

  if (!tokenValido(url.searchParams.get("token") ?? req.headers.get("x-api-token") ?? p.token)) {
    return NextResponse.json({ error: "Token inválido" }, { status: 401 });
  }

  // Zapier avisa que un mensaje escrito desde el CRM no se pudo mandar por WhatsApp
  if (p.accion === "estado") {
    if (!p.mensaje_id) return NextResponse.json({ ok: false, error: "Falta mensaje_id" }, { status: 400 });
    const { error } = await supabaseAdmin().from("mensajes")
      .update({ estado: p.estado === "enviado" ? "enviado" : "error" })
      .eq("zernio_message_id", `crm:${p.mensaje_id}`);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const telefono = normalizarTelefono(p.telefono ?? p.phone ?? p.from ?? p.wa_id);
  const texto = String(p.mensaje ?? p.message ?? p.text ?? p.body ?? "").trim();
  const nombre = String(p.nombre ?? p.name ?? p.profile_name ?? "").trim() || null;
  const direccion = p.direccion === "saliente" ? "saliente" : "entrante";
  // autor = "bot" cuando el mensaje lo mandó un bot externo (ej. el bot de Zapier): se guarda sin pausar al agente
  const esBot = direccion === "saliente" && ["bot", "agente"].includes(String(p.autor ?? "").toLowerCase());
  if (!telefono) return NextResponse.json({ error: "Falta el teléfono del cliente (campo telefono)" }, { status: 400 });

  const db = supabaseAdmin();
  try {
    // 1. Conversación de este teléfono
    const clave = `wa:${telefono}`;
    let { data: conv } = await db.from("conversaciones").select("id, lead_id, no_leidos, contacto_nombre, agente_activo").eq("zernio_conversation_id", clave).maybeSingle();
    if (!conv) {
      const r = await guardarLead(db, {
        nombre, telefono, origen: "whatsapp",
        notas: texto ? `Primer mensaje: ${texto}` : null,
        externalId: clave, originales: p,
        extra: { como_se_entero: "WhatsApp", primer_contacto: "WhatsApp", tipo_telefono: "Celular" },
      });
      const { data, error } = await db.from("conversaciones")
        .insert({ zernio_conversation_id: clave, plataforma: "whatsapp", contacto_nombre: nombre, contacto_id: telefono, lead_id: r.id })
        .select("id, lead_id, no_leidos, contacto_nombre, agente_activo").single();
      if (error?.code === "23505") {
        ({ data: conv } = await db.from("conversaciones").select("id, lead_id, no_leidos, contacto_nombre, agente_activo").eq("zernio_conversation_id", clave).single());
      } else if (error) throw error;
      else conv = data;
    }
    if (!conv) throw new Error("No se pudo crear la conversación");

    // 2. Guardar el mensaje (si Zapier reintenta con el mismo id, no se duplica)
    const ahora = new Date().toISOString();
    const { data: fila, error: errMsg } = await db.from("mensajes").insert({
      conversacion_id: conv.id,
      zernio_message_id: p.mensaje_id ? `wa:${p.mensaje_id}` : null,
      direccion, texto, autor: direccion === "entrante" ? "cliente" : esBot ? "agente" : "humano",
      estado: direccion === "entrante" ? "recibido" : "enviado", created_at: ahora,
    }).select("id").single();
    // bot_pausado: el bot de Zapier no debe contestar porque un asesor tomó el chat (o se pausó a mano)
    const botPausado = conv.agente_activo === false;
    if (errMsg?.code === "23505") return NextResponse.json({ responder: false, respuesta: "", motivo: "duplicado", bot_pausado: botPausado });
    if (errMsg) throw errMsg;

    await db.from("conversaciones").update({
      ultimo_mensaje: texto, ultimo_mensaje_at: ahora,
      contacto_nombre: conv.contacto_nombre ?? nombre,
      no_leidos: direccion === "entrante" ? (conv.no_leidos ?? 0) + 1 : 0,
      ...(direccion === "saliente" && !esBot ? { agente_activo: false, agente_motivo: "Lo atiende una persona" } : {}),
    }).eq("id", conv.id);

    if (direccion === "saliente") return NextResponse.json({ responder: false, respuesta: "" });

    if (String(p.solo_registrar ?? "").toLowerCase() === "true" || p.solo_registrar === true) {
      return NextResponse.json({ responder: false, respuesta: "", lead_id: conv.lead_id, bot_pausado: botPausado });
    }

    // 3. Si el cliente manda varios mensajes seguidos, solo contesta el último
    await new Promise((r) => setTimeout(r, 4000));
    const { data: ultimo } = await db.from("mensajes").select("id").eq("conversacion_id", conv.id)
      .order("created_at", { ascending: false }).limit(1);
    if (ultimo?.[0]?.id !== fila.id) return NextResponse.json({ responder: false, respuesta: "", motivo: "llegó otro mensaje" });

    // 4. Agente IA
    const respuesta = await responderParaZapier(db, conv.id);
    return NextResponse.json({ responder: !!respuesta, respuesta: respuesta ?? "" });
  } catch (e: any) {
    console.error("WhatsApp por Zapier:", e);
    return NextResponse.json({ error: e?.message ?? "Error", responder: false, respuesta: "" }, { status: 500 });
  }
}

function tokenValido(t: unknown) {
  const esperado = process.env.LEADS_WEBHOOK_TOKEN;
  if (!esperado || typeof t !== "string") return false;
  const a = Buffer.from(t), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
