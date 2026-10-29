import { defineDurable } from "@zapier/zapier-durable";
import { createZapierSdk } from "@zapier/zapier-sdk";
import { z } from "zod";
import dayjs from "dayjs";
import dayjsAdvancedFormatPlugin from "dayjs/plugin/advancedFormat.js";
import dayjsCustomParseFormatPlugin from "dayjs/plugin/customParseFormat.js";
import dayjsTimezonePlugin from "dayjs/plugin/timezone.js";
import dayjsUtcPlugin from "dayjs/plugin/utc.js";
import dayjsIsoWeekPlugin from "dayjs/plugin/isoWeek.js";
import { SYSTEM_PROMPT } from "./lib/prompt.ts";
import { ESTILO_EXTRA } from "./lib/estilo.ts";

const sdk = createZapierSdk();

// Arada CRM: cada mensaje (del cliente y del bot) se registra aquí para verlo en la Bandeja.
// La clave va en la conexión "Arada CRM" (API by Zapier), no en el código.
const CRM_URL = "https://arada-crm.vercel.app/api/webhooks/whatsapp";

const InputSchema = z
  .object({
    text: z.object({ body: z.string() }).loose(),
    from: z.string(),
    id: z.string().nullable().optional(),
  })
  .loose();

type Input = z.infer<typeof InputSchema>;

function normalizeInput(rawInput: unknown): unknown {
  return typeof rawInput === "string" ? JSON.parse(rawInput) : rawInput;
}

function textoDe(respuesta: unknown): string {
  const r = (respuesta as { data: Record<string, any>[] }).data?.[0];
  const res = r?.response ?? {};
  if (Array.isArray(res.content)) {
    return res.content.filter((c: any) => c?.type === "text").map((c: any) => String(c.text ?? "")).join("\n").trim();
  }
  return String(res["content[]text"] ?? "").trim();
}

function parteDe(texto: string, indice: number): string {
  return texto
    .split("\n")
    .filter(Boolean)
    .map((linea) => linea.split("|||")[indice] ?? "")
    .join("\n");
}

export default defineDurable<Input>("whatsapp-a-arada-crm", async (ctx, rawInput) => {
  const input = InputSchema.parse(normalizeInput(rawInput));

  // Registrar en el CRM nunca debe frenar al bot: si falla, se sigue.
  const registrar = async (nombre: string, data: Record<string, string>): Promise<Record<string, any> | null> => {
    try {
      const cuerpo = await ctx.step({
        name: nombre,
        maxAttempts: 2,
        retryDelaySeconds: 3,
        run: async () => {
          const res = await sdk.fetch(CRM_URL, {
            connection: "arada_crm",
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ telefono: input.from, ...data }),
          });
          const cuerpo = await res.text();
          if (!res.ok) throw new Error(`CRM respondió ${res.status}: ${cuerpo.slice(0, 200)}`);
          return cuerpo.slice(0, 6000);
        },
      });
      return JSON.parse(String(cuerpo));
    } catch {
      return null; /* el CRM no respondió; el bot sigue funcionando */
    }
  };

  const registro = await registrar("registrar-mensaje-cliente-en-crm", {
    mensaje: input.text.body,
    mensaje_id: input.id ?? "",
    solo_registrar: "true",
  });

  // Si un asesor tomó este chat en el CRM (o pausó el bot), el bot no contesta.
  if (registro?.bot_pausado === true) return { skipped: true, reason: "bot-pausado-en-crm" };

  // Lo que el bot ya aprendió (lecciones aprobadas en el CRM) y el nombre del cliente si lo sabemos
  const lecciones = String(registro?.lecciones ?? "").trim();
  const nombreConocido = String(registro?.nombre_cliente ?? "").trim();
  const sistema =
    SYSTEM_PROMPT +
    ESTILO_EXTRA +
    `\n\nNOMBRE DEL CLIENTE QUE YA SABEMOS: ${nombreConocido || "todavía no lo sabemos"}` +
    (lecciones
      ? `\n\nLECCIONES APRENDIDAS DE CHATS ANTERIORES (aprobadas por el equipo; síguelas, pero los precios, descuentos y reglas de arriba siempre mandan):\n${lecciones}`
      : "");

  const semana = await ctx.step("Datetime Line Item in Formatter", async () => {
    dayjs.extend(dayjsUtcPlugin);
    dayjs.extend(dayjsTimezonePlugin);
    dayjs.extend(dayjsCustomParseFormatPlugin);
    dayjs.extend(dayjsIsoWeekPlugin);
    dayjs.extend(dayjsAdvancedFormatPlugin);
    return dayjs.utc().tz("America/Mexico_City").format("YYYY-[W]WW");
  });

  const anthropicCreateMessage = await ctx.step("Create Message in Anthropic", async () =>
    sdk.runAction({
      app: "anthropic-claude",
      actionType: "write",
      action: "create_message",
      connection: "anthropic_claude_connection",
      inputs: {
        user_message: input.text.body,
        system: sistema,
        model: "claude-haiku-4-5-20251001",
        memory_key: `${semana}${input.from}`,
        advanced: true,
        max_web_search_uses: "1",
      },
    }),
  );

  // El bot marca el nombre del cliente con [NOMBRE: ...]; se quita antes de enviar y se guarda en el CRM
  const crudo = textoDe(anthropicCreateMessage);
  const etiqueta = crudo.match(/\[NOMBRE:\s*([^\]]{1,60})\]/i);
  const nombreNuevo = etiqueta ? etiqueta[1].trim() : "";
  const respuesta = crudo.replace(/\s*\[NOMBRE:[^\]]*\]\s*/gi, " ").replace(/ +\n/g, "\n").trim();
  const conNombre = nombreNuevo ? { nombre_cliente: nombreNuevo } : {};
  const r = respuesta.toLowerCase();
  const pathA = r.includes("transferir_asesor");
  const pathC = r.includes("enviar_brochure_roma");
  const pathD = r.includes("enviar_brochure_santa_catarina");
  const pathB = !pathA && !pathC && !pathD;

  if (pathA) {
    const aviso = "¡Gracias por tu mensaje! 😊 En un momento un asesor de Vivia Roma se pondrá en contacto contigo.";
    await ctx.step("Send Freeform Message in App228834", async () =>
      sdk.runAction({
        app: "whatsapp-business",
        actionType: "write",
        action: "send_freeform_message",
        connection: "whatsapp_business_connection",
        inputs: { recipient: input.from, message_text: aviso },
      }),
    );
    const resumen = respuesta.split("|").slice(1).join("|").trim();
    await registrar("registrar-transferencia-en-crm", {
      mensaje: `${aviso}\n\n[Pasa a asesor${resumen ? ": " + resumen : ""}]`,
      direccion: "saliente",
      autor: "bot",
      ...conNombre,
    });
  }

  if (pathB) {
    const parte1 = parteDe(respuesta, 0);
    const parte2 = parteDe(respuesta, 1);
    if (!parte1.trim()) return;

    await ctx.step("Send Freeform Message in App228834 2", async () =>
      sdk.runAction({
        app: "whatsapp-business",
        actionType: "write",
        action: "send_freeform_message",
        connection: "whatsapp_business_connection",
        inputs: { recipient: input.from, message_text: parte1 },
      }),
    );
    // Se guarda en el CRM una sola vez al final (ahorra tareas)
    if (!parte2) {
      await registrar("registrar-respuesta-en-crm", { mensaje: parte1, direccion: "saliente", autor: "bot", ...conNombre });
      return;
    }

    // Pausa entre los dos mensajes (antes era un paso de Code que esperaba 25 s)
    await ctx.wait("pausa-entre-mensajes", 25);

    await ctx.step("Send Freeform Message in App228834 3", async () =>
      sdk.runAction({
        app: "whatsapp-business",
        actionType: "write",
        action: "send_freeform_message",
        connection: "whatsapp_business_connection",
        inputs: { recipient: input.from, message_text: parte2 },
      }),
    );
    await registrar("registrar-respuesta-en-crm", { mensaje: `${parte1}\n\n${parte2}`, direccion: "saliente", autor: "bot", ...conNombre });
  }

  if (pathC) {
    await ctx.step("Send Media Message in App228834", async () =>
      sdk.runAction({
        app: "whatsapp-business",
        actionType: "write",
        action: "send_media_message",
        connection: "whatsapp_business_connection",
        inputs: {
          recipient: input.from,
          media_type: "image",
          file_url:
            "https://dl.dropboxusercontent.com/scl/fi/dn0zrg8tse1qw63xqipyx/One-Page-Digital_page-0001-1.jpg?rlkey=gf49y360c3e8t7kvpg3hdr4jq&st=4b7m780v&raw=1",
          caption: "¡Aquí tienes el brochure de Vivia Roma! 😊 ​",
          filename: "",
        },
      }),
    );
    await registrar("registrar-brochure-roma-en-crm", { mensaje: "[Se envió el brochure de Vivia Roma]", direccion: "saliente", autor: "bot", ...conNombre });
  }

  if (pathD) {
    await ctx.step("Send Media Message in App228834 2", async () =>
      sdk.runAction({
        app: "whatsapp-business",
        actionType: "write",
        action: "send_media_message",
        connection: "whatsapp_business_connection",
        inputs: {
          recipient: input.from,
          media_type: "document",
          file_url:
            "https://www.dropbox.com/scl/fi/u7b1u09s6qeci4t9424p5/LocalesComercialesVSC.pdf?rlkey=74ktfo6x2zrnd880qnejjz8ql&st=9hhhws6j&dl=1",
          caption: "¡Aquí tienes el brochure de Vivia Santa Catarina! 😊 ​",
          filename: "Brochure_Vivia_SC",
        },
      }),
    );
    await registrar("registrar-brochure-sc-en-crm", { mensaje: "[Se envió el brochure de Vivia Santa Catarina]", direccion: "saliente", autor: "bot", ...conNombre });
  }
});
