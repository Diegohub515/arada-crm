import crypto from "node:crypto";

/**
 * Conexión con Zernio (bandeja unificada de WhatsApp, Instagram, Facebook, etc.).
 * Docs: https://docs.zernio.com
 */
const BASE = (process.env.ZERNIO_API_URL || "https://zernio.com/api").replace(/\/$/, "");

export function firmaValida(cuerpoCrudo: string, firma: string | null) {
  const secreto = process.env.ZERNIO_WEBHOOK_SECRET;
  if (!secreto || !firma) return false;
  const esperada = crypto.createHmac("sha256", secreto).update(cuerpoCrudo, "utf8").digest("hex");
  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firma.trim().toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function llamar(ruta: string, init: RequestInit & { idempotencia?: string } = {}) {
  const llave = process.env.ZERNIO_API_KEY;
  if (!llave) throw new Error("Falta ZERNIO_API_KEY en las variables de entorno");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${llave}`,
    "Content-Type": "application/json",
  };
  if (init.idempotencia) headers["Idempotency-Key"] = init.idempotencia;
  const r = await fetch(`${BASE}${ruta}`, { ...init, headers, cache: "no-store" });
  const texto = await r.text();
  let datos: any = null;
  try { datos = texto ? JSON.parse(texto) : null; } catch { datos = { raw: texto }; }
  if (!r.ok) {
    const msg = datos?.error?.message || datos?.message || datos?.error || `Zernio respondió ${r.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return datos;
}

/** Envía un mensaje de texto a una conversación existente. */
export async function enviarMensaje(opts: {
  conversationId: string;
  accountId: string;
  texto: string;
  idempotencia: string;
}) {
  const res = await llamar(`/v1/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages`, {
    method: "POST",
    idempotencia: opts.idempotencia,
    body: JSON.stringify({ accountId: opts.accountId, message: opts.texto }),
  });
  return {
    messageId: (res?.data?.messageId as string | undefined) ?? null,
    advertencias: (res?.warnings as { message?: string }[] | undefined) ?? [],
    fallaParcial: res?.data?.partialFailure?.error as string | undefined,
  };
}

/** Marca la conversación como leída en Zernio (no detiene nada si falla). */
export async function marcarLeida(conversationId: string) {
  try {
    await llamar(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/read`, { method: "POST" });
  } catch {
    /* opcional */
  }
}

/* ---------- Lectura tolerante del payload ----------
 * Zernio no documenta todos los campos internos del remitente,
 * así que buscamos en varios nombres posibles y guardamos el original. */

export function primerTexto(...valores: unknown[]): string | null {
  for (const v of valores) if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

export function leerEventoMensaje(p: any) {
  const m = p?.message ?? {};
  const s = m?.sender ?? {};
  const conv = p?.conversation ?? {};
  const cuenta = p?.account ?? {};
  return {
    conversationId: primerTexto(conv.id, conv.conversationId, p?.conversationId),
    accountId: primerTexto(cuenta.accountId, cuenta.id, p?.accountId),
    plataforma: primerTexto(p?.platform, cuenta.platform, conv.platform, m?.platform)?.toLowerCase() ?? null,
    messageId: primerTexto(m.id, m.messageId, m.platformMessageId),
    texto: primerTexto(m.text, m.message, m.body) ?? (Array.isArray(m.attachments) && m.attachments.length ? "📎 Archivo adjunto" : ""),
    adjuntos: Array.isArray(m.attachments) ? m.attachments : null,
    remitenteNombre: primerTexto(s.name, s.displayName, s.username, conv.participantName, conv.contactName),
    remitenteId: primerTexto(s.phone, s.phoneNumber, s.id, s.username, conv.participantId, p?.profiles?.[0]?.externalId),
    fecha: primerTexto(m.createdAt, m.timestamp, p?.timestamp) ?? new Date().toISOString(),
  };
}

/** Convierte un `lead.received` de Zernio (formularios de Meta) a campos de lead. */
export function leerEventoLead(p: any) {
  const lead = p?.lead ?? {};
  const campos: Record<string, unknown> = lead.fields ?? lead.fieldData ?? {};
  // fieldData puede venir como arreglo [{name, values:[..]}]
  let mapa: Record<string, string> = {};
  if (Array.isArray(campos)) {
    for (const c of campos as any[]) mapa[String(c.name ?? c.key)] = String(c.values?.[0] ?? c.value ?? "");
  } else {
    for (const [k, v] of Object.entries(campos)) mapa[k] = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
  }
  return {
    externalId: primerTexto(lead.id, p?.leadId, p?.id),
    formId: primerTexto(p?.formId, lead.formId),
    adId: primerTexto(p?.adId, lead.adId),
    campos: mapa,
  };
}
