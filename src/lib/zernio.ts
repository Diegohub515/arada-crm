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

/** Envía un mensaje (texto y, opcional, un archivo por URL pública) a una conversación existente. */
export async function enviarMensaje(opts: {
  conversationId: string;
  accountId: string;
  texto: string;
  idempotencia: string;
  adjuntoUrl?: string;
  adjuntoTipo?: "image" | "video" | "audio" | "file";
  adjuntoNombre?: string;
}) {
  const cuerpo: Record<string, unknown> = { accountId: opts.accountId };
  if (opts.texto) cuerpo.message = opts.texto;
  if (opts.adjuntoUrl) {
    cuerpo.attachmentUrl = opts.adjuntoUrl;
    cuerpo.attachmentType = opts.adjuntoTipo ?? "file";
    if (opts.adjuntoNombre) cuerpo.attachmentName = opts.adjuntoNombre;
  }
  const res = await llamar(`/v1/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages`, {
    method: "POST",
    idempotencia: opts.idempotencia,
    body: JSON.stringify(cuerpo),
  });
  return {
    messageId: (res?.data?.messageId as string | undefined) ?? null,
    advertencias: (res?.warnings as { message?: string }[] | undefined) ?? [],
    fallaParcial: res?.data?.partialFailure?.error as string | undefined,
  };
}

/**
 * Manda una plantilla aprobada de WhatsApp. Si ya hay conversación en Zernio la usa;
 * si no, la crea con el teléfono (así se le escribe primero a un lead nuevo).
 */
export async function enviarPlantillaWhatsApp(opts: {
  accountId: string;
  telefono: string; // 52XXXXXXXXXX
  plantilla: string;
  idioma: string;
  imagenUrl?: string | null;
  conversationId?: string | null;
  idempotencia: string;
}) {
  if (opts.conversationId) {
    const componentes = opts.imagenUrl
      ? [{ type: "header", parameters: [{ type: "image", image: { link: opts.imagenUrl } }] }]
      : undefined;
    const res = await llamar(`/v1/inbox/conversations/${encodeURIComponent(opts.conversationId)}/messages`, {
      method: "POST",
      idempotencia: opts.idempotencia,
      body: JSON.stringify({
        accountId: opts.accountId,
        template: { elements: [{ name: opts.plantilla, language: opts.idioma, ...(componentes ? { components: componentes } : {}) }] },
      }),
    });
    return { messageId: (res?.data?.messageId as string | undefined) ?? null, conversationId: opts.conversationId };
  }
  const res = await llamar(`/v1/inbox/conversations`, {
    method: "POST",
    idempotencia: opts.idempotencia,
    body: JSON.stringify({
      accountId: opts.accountId,
      participantId: opts.telefono.replace(/\D/g, ""),
      templateName: opts.plantilla,
      templateLanguage: opts.idioma,
      ...(opts.imagenUrl ? { headerMedia: { type: "image", link: opts.imagenUrl } } : {}),
    }),
  });
  return {
    messageId: (res?.data?.messageId as string | undefined) ?? null,
    conversationId: (res?.data?.conversationId as string | undefined) ?? null,
  };
}

/** Contesta públicamente un comentario de una publicación (Facebook / Instagram). */
export async function responderComentario(opts: { postId: string; accountId: string; texto: string; commentId?: string | null; idempotencia: string }) {
  const res = await llamar(`/v1/inbox/comments/${encodeURIComponent(opts.postId)}`, {
    method: "POST",
    idempotencia: opts.idempotencia,
    body: JSON.stringify({ accountId: opts.accountId, message: opts.texto, ...(opts.commentId ? { commentId: opts.commentId } : {}) }),
  });
  return { commentId: (res?.data?.commentId as string | undefined) ?? null };
}

/** ID de la cuenta de WhatsApp conectada en Zernio (variable de entorno o la primera que encuentre). */
let cuentaWaCache: string | null = null;
export async function cuentaWhatsApp(): Promise<string | null> {
  if (process.env.ZERNIO_WHATSAPP_ACCOUNT_ID) return process.env.ZERNIO_WHATSAPP_ACCOUNT_ID;
  if (cuentaWaCache) return cuentaWaCache;
  const res = await llamar(`/v1/accounts?platform=whatsapp`);
  const lista: any[] = res?.accounts ?? res?.data ?? [];
  const cuenta = lista.find((a) => String(a.platform).toLowerCase() === "whatsapp" && a.isActive !== false) ?? lista[0];
  cuentaWaCache = cuenta?._id ?? cuenta?.id ?? cuenta?.accountId ?? null;
  return cuentaWaCache;
}

/** Conversaciones de WhatsApp en Zernio (para importar el historial). */
export async function listarConversaciones(accountId: string, cursor?: string | null) {
  const qs = new URLSearchParams({ accountId, platform: "whatsapp", limit: "50", sortOrder: "desc" });
  if (cursor) qs.set("cursor", cursor);
  const res = await llamar(`/v1/inbox/conversations?${qs}`);
  return {
    conversaciones: (res?.data ?? res?.conversations ?? res?.items ?? []) as any[],
    siguiente: (res?.pagination?.nextCursor as string | null | undefined) ?? null,
    hayMas: !!res?.pagination?.hasMore,
  };
}

/** Busca en Zernio la conversación de WhatsApp de un teléfono (10 dígitos o con lada). */
export async function buscarConversacionWhatsApp(accountId: string, telefono: string): Promise<string | null> {
  const diez = telefono.replace(/\D/g, "").slice(-10);
  if (diez.length < 10) return null;
  const qs = new URLSearchParams({ query: diez, platform: "whatsapp", accountId, limit: "10" });
  const res = await llamar(`/v1/inbox/conversations/search?${qs}`);
  const lista: any[] = res?.data ?? res?.conversations ?? [];
  for (const item of lista) {
    const c = item?.conversation ?? item;
    const participante = String(c?.participantId ?? c?.participant?.id ?? "").replace(/\D/g, "");
    if (participante.endsWith(diez)) return c?.id ?? c?.conversationId ?? null;
  }
  return null;
}

/** Mensajes de una conversación, del más viejo al más nuevo. */
export async function listarMensajes(conversationId: string, accountId: string, cursor?: string | null) {
  const qs = new URLSearchParams({ accountId, limit: "100", sortOrder: "asc" });
  if (cursor) qs.set("cursor", cursor);
  const res = await llamar(`/v1/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${qs}`);
  return {
    mensajes: (res?.messages ?? res?.data ?? res?.items ?? []) as any[],
    siguiente: (res?.pagination?.nextCursor as string | null | undefined) ?? null,
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
  const saliente = p?.event === "message.sent" || m?.direction === "outgoing";
  return {
    conversationId: primerTexto(conv.id, m.conversationId, conv.conversationId, p?.conversationId),
    accountId: primerTexto(cuenta.accountId, cuenta.id, p?.accountId),
    plataforma: primerTexto(p?.platform, cuenta.platform, m?.platform, conv.platform)?.toLowerCase() ?? null,
    // En WhatsApp el id de la plataforma (wamid) es el mismo que regresa el envío: así no se duplica
    messageId: primerTexto(m.platformMessageId, m.id, m.messageId),
    texto: primerTexto(m.text, m.message, m.body) ?? (Array.isArray(m.attachments) && m.attachments.length ? `📎 ${m.attachments[0]?.type === "image" ? "Imagen" : m.attachments[0]?.type === "audio" ? "Audio" : "Archivo adjunto"}` : ""),
    adjuntos: Array.isArray(m.attachments) && m.attachments.length ? m.attachments : null,
    // El cliente: en mensajes enviados el "sender" es el negocio, así que se lee de la conversación
    remitenteNombre: saliente
      ? primerTexto(conv.participantName, conv.contactName)
      : primerTexto(s.name, s.displayName, conv.participantName, s.username, conv.contactName),
    remitenteId: saliente
      ? primerTexto(conv.participantId)
      : primerTexto(s.phoneNumber, s.phone, s.id, conv.participantId, s.username, p?.profiles?.[0]?.externalId),
    fecha: primerTexto(m.sentAt, m.createdAt, m.timestamp, p?.timestamp) ?? new Date().toISOString(),
    /** "whatsapp_business_app" = lo mandaron desde el celular; "cloud_api" = API */
    origen: primerTexto(m.source, m.metadata?.source),
    enviadoPor: primerTexto(m.sentVia),
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
    // El id de Meta (leadgen_id) es el mismo que usa el flujo de Zapier: así no se duplica el lead
    externalId: primerTexto(lead.leadgenId, lead.leadgen_id, p?.leadgenId, lead.id, p?.leadId),
    formId: primerTexto(lead.formId, lead.form_id, p?.formId),
    formNombre: primerTexto(lead.formName, lead.form_name),
    adId: primerTexto(lead.adId, lead.ad_id, p?.adId),
    campanaId: primerTexto(lead.campaignId, lead.campaign_id),
    organico: lead.isOrganic === true || lead.is_organic === true,
    cuenta: primerTexto(p?.account?.username, p?.account?.name),
    campos: mapa,
  };
}
