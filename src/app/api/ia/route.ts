import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const CONTEXTO_NEGOCIO = `Trabajas para Arada, desarrolladora inmobiliaria en Monterrey que vende departamentos en preventa
(Vivia Roma, al sur de Monterrey, y Vivia Santa Catarina). El equipo de marketing atrae, contacta y califica leads
y agenda citas en el showroom; los asesores cierran la venta. Escribe en español de México, claro y breve.`;

async function preguntarIA(sistema: string, usuario: string) {
  const llave = process.env.ANTHROPIC_API_KEY;
  if (!llave) throw new Error("Falta ANTHROPIC_API_KEY. Agrégala en Vercel para usar la IA.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": llave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
      max_tokens: 1500,
      system: sistema,
      messages: [{ role: "user", content: usuario }],
    }),
  });
  const datos = await r.json();
  if (!r.ok) throw new Error(datos?.error?.message ?? `La IA respondió ${r.status}`);
  return (datos.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
}

export async function POST(req: Request) {
  const db = await supabaseServidor();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });

  const { accion, id } = (await req.json().catch(() => ({}))) as { accion?: string; id?: string };

  try {
    if (accion === "respuesta" && id) {
      const { data: conv } = await db.from("conversaciones").select("*, leads(*)").eq("id", id).single();
      const { data: msgs } = await db
        .from("mensajes").select("direccion, texto, created_at")
        .eq("conversacion_id", id).order("created_at", { ascending: false }).limit(20);
      const historial = (msgs ?? []).reverse()
        .map((m) => `${m.direccion === "entrante" ? "Cliente" : "Nosotros"}: ${m.texto ?? ""}`).join("\n");
      const texto = await preguntarIA(
        `${CONTEXTO_NEGOCIO}
Redacta la siguiente respuesta del equipo en este chat. Máximo 3 oraciones, tono cálido y profesional,
termina con UNA pregunta que avance hacia agendar visita al showroom o calificar (presupuesto, recámaras, cuándo compra).
No inventes precios, fechas de entrega ni datos que no estén en el chat. Devuelve solo el mensaje, sin comillas.`,
        `Plataforma: ${conv?.plataforma ?? "desconocida"}\nContacto: ${conv?.contacto_nombre ?? "sin nombre"}\nEtapa: ${conv?.leads?.etapa ?? "nuevo"}\n\nChat:\n${historial}`
      );
      return NextResponse.json({ texto });
    }

    if (accion === "lead" && id) {
      const { data: lead } = await db.from("leads").select("*").eq("id", id).single();
      const { data: acts } = await db.from("actividades").select("tipo, texto, created_at")
        .eq("lead_id", id).order("created_at", { ascending: false }).limit(15);
      const texto = await preguntarIA(
        `${CONTEXTO_NEGOCIO}
Analiza este lead y responde con: 1) temperatura (frío/tibio/caliente) y por qué en una línea,
2) el siguiente paso concreto, 3) un mensaje corto listo para enviar. Usa viñetas cortas.`,
        `Lead: ${JSON.stringify({ ...lead, datos_originales: undefined })}\n\nHistorial:\n${(acts ?? []).map((a) => `- ${a.created_at.slice(0, 10)} ${a.tipo}: ${a.texto}`).join("\n")}`
      );
      return NextResponse.json({ texto });
    }

    if (accion === "gastos") {
      const desde = new Date(); desde.setMonth(desde.getMonth() - 6);
      const d = desde.toISOString().slice(0, 10);
      const [{ data: ordenes }, { data: facturas }, { data: leads }] = await Promise.all([
        db.from("ordenes_compra").select("concepto, categoria, desarrollo, monto, estado, fecha, proveedores(nombre)").gte("fecha", d),
        db.from("facturas").select("concepto, categoria, desarrollo, total, estado, fecha_emision, fecha_vencimiento, proveedores(nombre)").gte("fecha_emision", d),
        db.from("leads").select("origen, etapa, created_at").gte("created_at", d),
      ]);
      const texto = await preguntarIA(
        `${CONTEXTO_NEGOCIO}
Eres analista financiero. Con las órdenes de compra, facturas y leads de los últimos 6 meses:
1) Resume el gasto por categoría y proveedor (montos en MXN).
2) Señala gastos repetidos, crecimientos raros o facturas por vencer.
3) Cruza gasto de marketing contra leads y citas por origen, si hay datos.
4) Da 3 a 5 recomendaciones concretas para ahorrar o reasignar presupuesto.
Si los datos son pocos, dilo y explica qué conviene registrar. Usa títulos cortos y viñetas.`,
        JSON.stringify({ ordenes, facturas, leads_por_origen_y_etapa: leads })
      );
      return NextResponse.json({ texto });
    }

    return NextResponse.json({ error: "Acción no reconocida" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Error de IA" }, { status: 500 });
  }
}
