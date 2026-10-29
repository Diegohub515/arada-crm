import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CHATS = 150;
const MAX_CARACTERES = 90000;

/**
 * Análisis de los chats de WhatsApp con IA. Saca métricas y propone "lecciones"
 * que quedan pendientes hasta que alguien las aprueba en Agente IA → Aprendizaje.
 * Lo corre Vercel cada lunes (vercel.json) o un usuario con el botón "Analizar ahora".
 */
export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return analizar(7);
}

export async function POST(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const { dias } = (await req.json().catch(() => ({}))) as { dias?: number };
  return analizar(Math.min(Math.max(Number(dias) || 7, 1), 60));
}

async function analizar(dias: number) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "Falta ANTHROPIC_API_KEY en Vercel." }, { status: 500 });
  }
  const db = supabaseAdmin();
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - dias * 86400000);

  // Chats de WhatsApp con movimiento en el periodo
  const { data: convs, error } = await db.from("conversaciones")
    .select("id, lead_id, contacto_nombre, ultimo_mensaje_at, leads(nombre, etapa, desarrollo, origen)")
    .like("zernio_conversation_id", "wa:%").gte("ultimo_mensaje_at", desde.toISOString())
    .order("ultimo_mensaje_at", { ascending: false }).limit(MAX_CHATS);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!convs?.length) return NextResponse.json({ error: `No hubo chats de WhatsApp en los últimos ${dias} días.` }, { status: 400 });

  const ids = convs.map((c) => c.id);
  const mensajes: any[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const { data } = await db.from("mensajes").select("id, conversacion_id, direccion, autor, texto, created_at")
      .in("conversacion_id", ids.slice(i, i + 50)).order("created_at").limit(5000);
    mensajes.push(...(data ?? []));
  }
  const { data: votos } = await db.from("mensaje_feedback").select("mensaje_id, voto, correccion").gte("created_at", desde.toISOString());
  const votoPorMensaje = new Map((votos ?? []).map((v) => [v.mensaje_id, v]));
  const { data: aprobadas } = await db.from("agente_lecciones").select("texto").eq("estado", "aprobada");
  const { data: pendientes } = await db.from("agente_lecciones").select("texto").eq("estado", "pendiente");

  // ---- Métricas sencillas ----
  const porConv = new Map<string, any[]>();
  mensajes.forEach((m) => { const l = porConv.get(m.conversacion_id) ?? []; l.push(m); porConv.set(m.conversacion_id, l); });
  let siguieron = 0, transferidos = 0, conAsesor = 0, avanzaron = 0, totalCliente = 0;
  for (const c of convs as any[]) {
    const ms = porConv.get(c.id) ?? [];
    const delCliente = ms.filter((m) => m.direccion === "entrante").length;
    totalCliente += delCliente;
    if (delCliente >= 2) siguieron++;
    if (ms.some((m) => (m.texto ?? "").includes("[Pasa a asesor"))) transferidos++;
    if (ms.some((m) => m.direccion === "saliente" && m.autor === "humano" && !(m.texto ?? "").startsWith("📣"))) conAsesor++;
    if (["cita", "apartado", "cerrado"].includes(c.leads?.etapa)) avanzaron++;
  }
  const metricas = {
    dias, chats: convs.length,
    siguieron_platica: siguieron, pct_siguieron: Math.round((siguieron / convs.length) * 100),
    pasados_a_asesor: transferidos, atendidos_por_asesor: conAsesor,
    llegaron_a_cita_o_mas: avanzaron, promedio_mensajes_cliente: +(totalCliente / convs.length).toFixed(1),
    votos_positivos: (votos ?? []).filter((v) => v.voto === 1).length,
    votos_negativos: (votos ?? []).filter((v) => v.voto === -1).length,
  };

  // ---- Transcripciones (sin teléfonos) ----
  let texto = "";
  for (const c of convs as any[]) {
    const ms = porConv.get(c.id) ?? [];
    if (!ms.length) continue;
    const cabeza = `\n### Chat (etapa del lead: ${c.leads?.etapa ?? "sin lead"}; desarrollo: ${c.leads?.desarrollo ?? "?"}; origen: ${c.leads?.origen ?? "?"})\n`;
    const cuerpo = ms.slice(-40).map((m) => {
      const quien = m.direccion === "entrante" ? "CLIENTE" : m.autor === "agente" ? "BOT" : "ASESOR";
      const v = votoPorMensaje.get(m.id);
      const marca = v ? (v.voto === 1 ? " [👍 asesor]" : ` [👎 asesor${v.correccion ? `: debió decir "${v.correccion}"` : ""}]`) : "";
      return `${quien}: ${(m.texto ?? "").replace(/\d{8,}/g, "[tel]").slice(0, 600)}${marca}`;
    }).join("\n");
    if (texto.length + cabeza.length + cuerpo.length > MAX_CARACTERES) break;
    texto += cabeza + cuerpo + "\n";
  }

  const sistema = `Eres analista de ventas inmobiliarias. Revisas conversaciones de WhatsApp entre clientes y el bot (asistente virtual) de Arada Desarrollos (Vivia Roma: departamentos en preventa en Monterrey; Vivia Santa Catarina: locales comerciales). A veces interviene un ASESOR humano.
Tu trabajo: encontrar qué hace que los clientes sigan platicando y avancen a una llamada o visita, y qué hace que se vayan. Propón LECCIONES cortas y concretas para mejorar al bot.

Reglas para las lecciones:
- Cada lección es una instrucción directa para el bot, de 1 o 2 oraciones, en español de México.
- Basadas en lo que viste en los chats; pon como evidencia un ejemplo breve (sin datos personales).
- Categorías: "dato" (información que el bot no supo y el asesor sí dio), "estilo" (cómo escribir para sonar natural), "flujo" (qué preguntar y en qué orden), "evitar" (lo que hizo que el cliente se fuera o se molestara).
- Toma muy en cuenta los 👍/👎 y correcciones de los asesores, y lo que hacen los asesores que sí logran citas.
- NUNCA inventes precios, descuentos, fechas o datos del proyecto: un "dato" solo vale si un ASESOR lo dijo en los chats.
- El bot nunca debe decir que es una persona: si preguntan, es el asistente virtual.
- No repitas lecciones que ya existen (te las paso abajo). Máximo 8 lecciones, solo las que de verdad valgan la pena; si no hay nada nuevo, devuelve pocas o ninguna.`;

  const usuario = `MÉTRICAS DEL PERIODO (${dias} días): ${JSON.stringify(metricas)}

LECCIONES YA APROBADAS:
${(aprobadas ?? []).map((l) => `- ${l.texto}`).join("\n") || "(ninguna)"}

LECCIONES PENDIENTES DE REVISIÓN:
${(pendientes ?? []).map((l) => `- ${l.texto}`).join("\n") || "(ninguna)"}

CONVERSACIONES:
${texto}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL_ANALISIS || "claude-sonnet-5-5",
      max_tokens: 3000,
      system: sistema,
      tools: [{
        name: "reportar",
        description: "Entrega el análisis de los chats.",
        input_schema: {
          type: "object",
          properties: {
            resumen: { type: "string", description: "3 a 6 viñetas con lo más importante del periodo, en español sencillo." },
            lecciones: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  texto: { type: "string" },
                  categoria: { type: "string", enum: ["dato", "estilo", "flujo", "evitar"] },
                  evidencia: { type: "string" },
                },
                required: ["texto", "categoria", "evidencia"],
              },
            },
          },
          required: ["resumen", "lecciones"],
        },
      }],
      tool_choice: { type: "tool", name: "reportar" },
      messages: [{ role: "user", content: usuario }],
    }),
  });
  const datos = await r.json();
  if (!r.ok) return NextResponse.json({ error: datos?.error?.message ?? `La IA respondió ${r.status}` }, { status: 502 });
  const salida = (datos.content ?? []).find((b: any) => b.type === "tool_use")?.input as
    { resumen: string; lecciones: { texto: string; categoria: string; evidencia: string }[] } | undefined;
  if (!salida) return NextResponse.json({ error: "La IA no devolvió el análisis" }, { status: 502 });

  const { data: analisis } = await db.from("agente_analisis").insert({
    desde: desde.toISOString(), hasta: hasta.toISOString(), resumen: salida.resumen, metricas,
  }).select("id").single();
  const nuevas = (salida.lecciones ?? []).slice(0, 8).filter((l) => l.texto?.trim());
  if (nuevas.length) {
    await db.from("agente_lecciones").insert(nuevas.map((l) => ({
      texto: l.texto.trim(), categoria: l.categoria, evidencia: l.evidencia, origen: "analisis", estado: "pendiente", analisis_id: analisis?.id ?? null,
    })));
  }
  return NextResponse.json({ ok: true, metricas, resumen: salida.resumen, lecciones: nuevas.length });
}
