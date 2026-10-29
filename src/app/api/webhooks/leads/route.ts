import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { buscarCampo, guardarLead } from "@/lib/ingesta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Entrada universal de leads. Funciona con:
 *  - Google Ads (formularios de cliente potencial → Webhook). Pega la URL y usa tu token como "Clave".
 *  - Zapier (Webhooks by Zapier → POST, JSON) para Meta, TikTok o lo que sea.
 *  - Tus landing pages (fetch POST con JSON o formulario).
 *
 * URL: https://TU-DOMINIO/api/webhooks/leads?token=TU_TOKEN
 * Campos que entiende (cualquier idioma/forma): nombre, telefono, email, origen, desarrollo,
 * campana, tipologia, presupuesto, notas, id.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const tipoContenido = req.headers.get("content-type") ?? "";
  let p: Record<string, any> = {};
  try {
    if (tipoContenido.includes("application/json")) p = await req.json();
    else {
      const form = await req.formData();
      form.forEach((v, k) => { p[k] = String(v); });
    }
  } catch {
    return NextResponse.json({ error: "No pude leer el cuerpo de la petición" }, { status: 400 });
  }

  const token = url.searchParams.get("token") ?? req.headers.get("x-api-token") ?? p.google_key ?? p.token;
  if (!tokenValido(token)) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

  const db = supabaseAdmin();

  try {
    // ---- Google Ads ----
    if (Array.isArray(p.user_column_data)) {
      if (p.is_test) return NextResponse.json({ ok: true, prueba: true });
      const mapa: Record<string, string> = {};
      for (const c of p.user_column_data) {
        mapa[c.column_id ?? c.column_name] = c.string_value ?? "";
        if (c.column_name) mapa[c.column_name] = c.string_value ?? "";
      }
      const nombre = buscarCampo(mapa, "FULL_NAME", "Nombre completo") ??
        [buscarCampo(mapa, "FIRST_NAME"), buscarCampo(mapa, "LAST_NAME")].filter(Boolean).join(" ");
      const r = await guardarLead(db, {
        nombre,
        telefono: buscarCampo(mapa, "PHONE_NUMBER", "Número de teléfono", "telefono"),
        email: buscarCampo(mapa, "EMAIL", "Correo electrónico"),
        origen: "google_ads",
        campana: p.campaign_name ?? (p.campaign_id ? `Campaña ${p.campaign_id}` : null),
        extra: { como_se_entero: "Google", primer_contacto: "Formulario", conjunto_anuncios: p.adgroup_name ?? null },
        notas: Object.entries(mapa).map(([k, v]) => `${k}: ${v}`).join("\n"),
        externalId: p.lead_id ? `google:${p.lead_id}` : null,
        originales: p,
      });
      return NextResponse.json({ ok: true, ...r });
    }

    // ---- Genérico (Zapier, landings) ----
    const plano = aplanar(p);
    const nombre =
      buscarCampo(plano, "nombre_completo", "full_name", "nombre", "name") ??
      [buscarCampo(plano, "first_name", "primer_nombre"), buscarCampo(plano, "last_name", "apellido")].filter(Boolean).join(" ");
    // Solo el campo exacto: "rango_presupuesto" (texto como "3 a 4 millones") no es un número
    const presupuestoTxt = plano.presupuesto ?? plano.budget ?? null;
    const r = await guardarLead(db, {
      nombre,
      telefono: buscarCampo(plano, "telefono", "phone_number", "phone", "celular", "whatsapp"),
      email: buscarCampo(plano, "email", "correo"),
      origen: origenValido(buscarCampo(plano, "origen", "source")) ?? "landing",
      desarrollo: buscarCampo(plano, "desarrollo"),
      campana: buscarCampo(plano, "campana", "campaign", "utm_campaign", "lead_magnet"),
      tipologia: buscarCampo(plano, "tipologia", "recamaras"),
      presupuesto: presupuestoTxt ? Number(presupuestoTxt.replace(/[^\d.]/g, "")) || null : null,
      notas: buscarCampo(plano, "notas", "mensaje", "message", "comentarios"),
      externalId: (plano.lead_id || plano.id) ? `ext:${plano.lead_id || plano.id}` : null,
      originales: p,
      extra: {
        conjunto_anuncios: buscarCampo(plano, "conjunto_anuncios", "adset_name", "ad_set_name"),
        anuncio: plano.anuncio || plano.ad_name || null,
        como_se_entero: buscarCampo(plano, "como_se_entero") ?? COMO_SE_ENTERO[origenValido(buscarCampo(plano, "origen", "source")) ?? "landing"] ?? null,
        primer_contacto: buscarCampo(plano, "primer_contacto") ?? (origenValido(buscarCampo(plano, "origen", "source")) === "whatsapp" ? "WhatsApp" : "Formulario"),
        rango_presupuesto: buscarCampo(plano, "rango_presupuesto"),
        tiempo_compra: buscarCampo(plano, "tiempo_compra", "cuando_compra"),
        motivo_compra: buscarCampo(plano, "motivo_compra", "proposito"),
      },
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    console.error("Webhook leads:", e);
    return NextResponse.json({ error: e?.message ?? "Error" }, { status: 500 });
  }
}

function tokenValido(t: unknown) {
  const esperado = process.env.LEADS_WEBHOOK_TOKEN;
  if (!esperado || typeof t !== "string") return false;
  const a = Buffer.from(t), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const COMO_SE_ENTERO: Record<string, string> = {
  meta_formulario: "Facebook", facebook: "Facebook", instagram: "Instagram", whatsapp: "WhatsApp",
  google_ads: "Google", landing: "Página web", broker: "Broker", referido: "Referido",
};

const ORIGENES = ["meta_formulario", "whatsapp", "instagram", "facebook", "google_ads", "landing", "broker", "referido", "manual", "otro"];
function origenValido(o: string | null) {
  if (!o) return null;
  const x = o.toLowerCase();
  if (ORIGENES.includes(x)) return x;
  if (x.includes("meta") || x.includes("facebook")) return "meta_formulario";
  if (x.includes("google")) return "google_ads";
  if (x.includes("whats")) return "whatsapp";
  if (x.includes("insta")) return "instagram";
  return "otro";
}

function aplanar(o: Record<string, any>, prefijo = "", salida: Record<string, string> = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v && typeof v === "object" && !Array.isArray(v)) aplanar(v, k + "_", salida);
    else if (v != null) salida[prefijo + k] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return salida;
}
