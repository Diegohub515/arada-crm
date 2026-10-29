import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";

const sdk = createZapierSdk();

// Cada lead de un formulario de Meta (Facebook / Instagram) entra al Arada CRM.
// La clave va en la conexión "Arada CRM" (API by Zapier), no en el código.
const CRM_URL = "https://arada-crm.vercel.app/api/webhooks/leads";

// Página de Facebook → desarrollo del CRM
const DESARROLLO_POR_PAGINA: Record<string, string> = {
  "141189272412174": "VRO", // Vivia Roma
  "110422001633361": "VSC", // VIVIA SC
};

// Datos del anuncio que no son respuestas del formulario
const META = new Set([
  "id", "lead_id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name", "campaign_id", "campaign_name",
  "form_id", "form_name", "page_id", "page_name", "is_organic", "platform", "partner_name", "retailer_item_id",
  "custom_disclaimer_responses", "field_data", "home_listing", "vehicle", "inbox_url",
]);

function texto(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(texto).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v).trim();
}

function normal(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
}

export default defineDurable<Record<string, unknown>>("meta-formularios-a-arada-crm", async (ctx, rawInput) => {
  const lead = (typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput ?? {}) as Record<string, any>;

  // Respuestas del formulario: vienen en field_data o como campos sueltos
  const respuestas: Record<string, string> = {};
  if (Array.isArray(lead.field_data)) {
    for (const f of lead.field_data) {
      const v = texto(f?.values ?? f?.value);
      if (f?.name && v) respuestas[String(f.name)] = v;
    }
  }
  for (const [k, v] of Object.entries(lead)) {
    if (META.has(k) || k.startsWith("_")) continue;
    const t = texto(v);
    if (t && !(k in respuestas)) respuestas[k] = t;
  }

  const buscar = (...claves: string[]) => {
    const entradas = Object.entries(respuestas).map(([k, v]) => [normal(k), v] as const);
    for (const c of claves) {
      const o = normal(c);
      const hit = entradas.find(([k]) => k === o) ?? entradas.find(([k]) => k.includes(o));
      if (hit?.[1]) return hit[1];
    }
    return "";
  };

  const nombre = buscar("full_name", "nombre_completo", "nombre") ||
    [buscar("first_name", "nombre"), buscar("last_name", "apellido")].filter(Boolean).join(" ");
  const notas = Object.entries(respuestas).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("\n");
  const pagina = texto(lead.page_id);

  const datos = {
    origen: "meta_formulario",
    nombre,
    telefono: buscar("phone_number", "telefono", "phone", "celular", "whatsapp"),
    email: buscar("email", "correo"),
    desarrollo: DESARROLLO_POR_PAGINA[pagina] ?? "",
    campana: texto(lead.campaign_name) || texto(lead.form_name),
    conjunto_anuncios: texto(lead.adset_name),
    anuncio: texto(lead.ad_name),
    formulario: texto(lead.form_name),
    como_se_entero: texto(lead.platform).toLowerCase().startsWith("ig") ? "Instagram" : "Facebook",
    primer_contacto: "Formulario",
    motivo_compra: buscar("motivo", "proposito", "para_que"),
    tiempo_compra: buscar("tiempo", "cuando"),
    rango_presupuesto: buscar("presupuesto", "budget"),
    enganche: buscar("enganche"),
    notas: (texto(lead.form_name) ? `Formulario: ${texto(lead.form_name)}\n` : "") + notas,
    lead_id: texto(lead.id ?? lead.lead_id),
  };

  const respuesta = await ctx.step({
    name: "guardar-lead-en-crm",
    maxAttempts: 3,
    retryDelaySeconds: 10,
    run: async () => {
      const res = await sdk.fetch(CRM_URL, {
        connection: "arada_crm",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(datos),
      });
      const cuerpo = await res.text();
      if (!res.ok) throw new Error(`CRM respondió ${res.status}: ${cuerpo.slice(0, 300)}`);
      return cuerpo.slice(0, 2000);
    },
  });
  return { ok: true, crm: respuesta };
});
