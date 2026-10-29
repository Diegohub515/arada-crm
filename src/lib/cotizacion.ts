import { dinero } from "./formato";

export type DatosCotizacion = {
  precio_lista: number;
  descuento_pct: number;
  enganche_pct: number;
  mensualidades_pct: number;
  num_mensualidades: number;
  escrituracion_pct: number;
};

/** Calcula precio final y plan de pagos (por defecto 15% enganche, 15% en mensualidades, 70% a escrituración). */
export function calcular(c: DatosCotizacion) {
  const precioFinal = Math.round(c.precio_lista * (1 - (c.descuento_pct || 0) / 100));
  const enganche = Math.round((precioFinal * c.enganche_pct) / 100);
  const totalMensual = Math.round((precioFinal * c.mensualidades_pct) / 100);
  const n = Math.max(1, c.num_mensualidades || 1);
  const mensualidad = Math.round(totalMensual / n);
  const escrituracion = precioFinal - enganche - totalMensual;
  const sumaPct = Number(c.enganche_pct) + Number(c.mensualidades_pct) + Number(c.escrituracion_pct);
  return { precioFinal, enganche, totalMensual, mensualidad, n, escrituracion, ahorro: c.precio_lista - precioFinal, sumaPctOk: Math.abs(sumaPct - 100) < 0.01, sumaPct };
}

/** Texto listo para pegar en WhatsApp. */
export function textoWhatsApp(p: {
  cliente?: string | null; desarrollo: string; depto: string; tipologia?: string | null; m2?: number | null;
  datos: DatosCotizacion; vigencia?: string | null;
}) {
  const r = calcular(p.datos);
  return [
    `Hola${p.cliente ? " " + p.cliente.split(" ")[0] : ""}, te comparto tu cotización de ${p.desarrollo}:`,
    ``,
    `🏢 Departamento ${p.depto}${p.tipologia ? " · " + p.tipologia : ""}${p.m2 ? " · " + p.m2 + " m²" : ""}`,
    p.datos.descuento_pct ? `💲 Precio de lista: ${dinero(p.datos.precio_lista)}` : null,
    p.datos.descuento_pct ? `🎉 Descuento ${p.datos.descuento_pct}%: −${dinero(r.ahorro)}` : null,
    `✅ Precio final: ${dinero(r.precioFinal)}`,
    ``,
    `Plan de pagos:`,
    `• Enganche ${p.datos.enganche_pct}%: ${dinero(r.enganche)}`,
    `• ${r.n} mensualidades de ${dinero(r.mensualidad)} (${p.datos.mensualidades_pct}%)`,
    `• Escrituración ${p.datos.escrituracion_pct}%: ${dinero(r.escrituracion)}`,
    p.vigencia ? `` : null,
    p.vigencia ? `Precio vigente hasta el ${new Date(p.vigencia + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.` : null,
  ].filter((x) => x !== null).join("\n");
}
