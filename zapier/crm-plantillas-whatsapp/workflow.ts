import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

const sdk = createZapierSdk();

// Arada CRM manda aquí los envíos de remarketing (una plantilla a muchos leads).
// La clave del CRM va en la conexión "Arada CRM" (API by Zapier), no en el código.
const CRM_URL = "https://arada-crm.vercel.app/api/webhooks/whatsapp";
const POR_TANDA = 10;

const EnvioSchema = z.object({ envio_id: z.string(), telefono: z.string() }).loose();

const InputSchema = z
  .object({
    campana_id: z.string(),
    plantilla: z.string(), // "nombre|idioma", ej. "descuentos_vro|es_MX"
    imagen_url: z.string().nullable().optional(),
    envios_json: z.string(), // lista de {envio_id, telefono} en texto JSON
  })
  .loose();

type Input = z.infer<typeof InputSchema>;

function normalizeInput(rawInput: unknown): unknown {
  return typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
}

export default defineDurable<Input>("crm-plantillas-whatsapp", async (ctx, rawInput) => {
  const input = InputSchema.parse(normalizeInput(rawInput));
  const envios = z.array(EnvioSchema).parse(JSON.parse(input.envios_json));
  const imagen = input.imagen_url ?? "";

  const resultados: { envio_id: string; ok: boolean; detalle?: string }[] = [];

  // De 10 en 10 para no saturar a WhatsApp
  for (let i = 0; i < envios.length; i += POR_TANDA) {
    const tanda = envios.slice(i, i + POR_TANDA);
    const res = await Promise.all(
      tanda.map(async (e) => {
        try {
          await ctx.step({
            name: `send-template-${e.envio_id}`,
            maxAttempts: 2,
            retryDelaySeconds: 10,
            run: async () =>
              sdk.runAction({
                app: "whatsapp-business",
                actionType: "write",
                action: "send_template_message",
                connection: "whatsapp_business_connection",
                inputs: {
                  template: input.plantilla,
                  recipient: e.telefono.replace(/\D/g, ""),
                  ...(imagen ? { header_media_file: imagen } : {}),
                },
              }),
          });
          return { envio_id: e.envio_id, ok: true };
        } catch (err: any) {
          return { envio_id: e.envio_id, ok: false, detalle: String(err?.message ?? err).slice(0, 300) };
        }
      }),
    );
    resultados.push(...res);
  }

  // Un solo aviso al CRM con el resultado de todos
  await ctx.step("report-results-to-crm", async () => {
    const r = await sdk.fetch(CRM_URL, {
      connection: "arada_crm",
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion: "resultado_campana", campana_id: input.campana_id, resultados }),
    });
    return r.status;
  });

  return { total: envios.length, enviados: resultados.filter((r) => r.ok).length };
});
