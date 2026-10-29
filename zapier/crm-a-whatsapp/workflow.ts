import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";

const sdk = createZapierSdk();

// Arada CRM avisa aquí cuando un asesor contesta un chat de WhatsApp desde la Bandeja.
// La clave del CRM va en la conexión "Arada CRM" (API by Zapier), no en el código.
const CRM_URL = "https://arada-crm.vercel.app/api/webhooks/whatsapp";

const InputSchema = z
  .object({
    telefono: z.string(),
    texto: z.string(),
    mensaje_id: z.string().nullable().optional(),
  })
  .loose();

type Input = z.infer<typeof InputSchema>;

function normalizeInput(rawInput: unknown): unknown {
  return typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
}

export default defineDurable<Input>("crm-a-whatsapp", async (ctx, rawInput) => {
  const input = InputSchema.parse(normalizeInput(rawInput));
  const telefono = input.telefono.replace(/\D/g, "");
  const texto = input.texto.trim();
  if (!telefono || !texto) return { enviado: false, motivo: "faltan datos" };

  try {
    await ctx.step({
      name: "send-whatsapp-message",
      maxAttempts: 2,
      retryDelaySeconds: 5,
      run: async () =>
        sdk.runAction({
          app: "whatsapp-business",
          actionType: "write",
          action: "send_freeform_message",
          connection: "whatsapp_business_connection",
          inputs: { recipient: telefono, message_text: texto },
        }),
    });
    return { enviado: true };
  } catch (e: any) {
    // Solo si falla se avisa al CRM (así no se gasta una tarea extra en cada mensaje).
    const detalle = String(e?.message ?? e ?? "Error desconocido").slice(0, 300);
    await ctx.step("report-error-to-crm", async () => {
      const res = await sdk.fetch(CRM_URL, {
        connection: "arada_crm",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "estado", mensaje_id: input.mensaje_id ?? "", estado: "error", detalle }),
      });
      return res.status;
    });
    return { enviado: false, detalle };
  }
});
