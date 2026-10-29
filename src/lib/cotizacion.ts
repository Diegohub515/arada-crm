import { dinero } from "./formato";

/** Esquemas de pago de Vivia Roma (los mismos que se usan en CAPI). */
export const ESQUEMAS = [
  { id: "10-15-75", enganche: 10, construccion: 15, escrituracion: 75 },
  { id: "15-15-70", enganche: 15, construccion: 15, escrituracion: 70 },
] as const;

/** Fecha estimada de escrituración (entrega feb 2028). Se puede cambiar en cada cotización. */
export const FECHA_ESCRITURACION = "2028-03-24";
/** Monto para apartar; es informativo, forma parte del enganche. */
export const APARTADO = 10000;

export type DatosCotizacion = {
  precio_lista: number;
  descuento_pct: number;
  descuento_monto?: number | null;
  enganche_pct: number;
  mensualidades_pct: number;
  num_mensualidades: number;
  escrituracion_pct: number;
  num_pagos_enganche?: number | null;
  fecha_primer_pago?: string | null;
  fecha_escrituracion?: string | null;
  apartado?: number | null;
  esquema?: string | null;
};

export type Pago = { num: number; concepto: "Enganche" | "Construcción" | "Escrituración"; fecha: string | null; importe: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Suma meses a una fecha ISO (AAAA-MM-DD) cuidando fin de mes. */
export function sumarMeses(iso: string, meses: number) {
  const [a, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d, ultimo));
  return base.toISOString().slice(0, 10);
}

/** Cuántas mensualidades caben entre el último pago de enganche y la escrituración (sin incluirla). */
export function mensualidadesHasta(primerPago: string, escrituracion: string, pagosEnganche = 1) {
  let n = 0;
  while (n < 120 && sumarMeses(primerPago, pagosEnganche + n) < escrituracion) n++;
  return Math.max(1, n);
}

/** Precio final y montos de cada parte del esquema. */
export function calcular(c: DatosCotizacion) {
  const precioLista = Number(c.precio_lista) || 0;
  const precioFinal = r2(precioLista * (1 - (Number(c.descuento_pct) || 0) / 100) - (Number(c.descuento_monto) || 0));
  const enganche = r2((precioFinal * Number(c.enganche_pct)) / 100);
  const totalMensual = r2((precioFinal * Number(c.mensualidades_pct)) / 100);
  const n = Math.max(1, Number(c.num_mensualidades) || 1);
  const mensualidad = r2(totalMensual / n);
  const escrituracion = r2(precioFinal - enganche - totalMensual);
  const sumaPct = Number(c.enganche_pct) + Number(c.mensualidades_pct) + Number(c.escrituracion_pct);
  return {
    precioFinal, enganche, totalMensual, mensualidad, n, escrituracion,
    ahorro: r2(precioLista - precioFinal), sumaPctOk: Math.abs(sumaPct - 100) < 0.01, sumaPct,
  };
}

/** Plan de pagos completo, con fechas. La última mensualidad absorbe los centavos. */
export function planDePagos(c: DatosCotizacion, fechaRespaldo?: string): Pago[] {
  const r = calcular(c);
  const primer = c.fecha_primer_pago || fechaRespaldo || null;
  const pe = Math.max(1, Number(c.num_pagos_enganche) || 1);
  const pagos: Pago[] = [];
  let num = 1;

  const pagoEng = r2(r.enganche / pe);
  for (let i = 0; i < pe; i++) {
    const importe = i === pe - 1 ? r2(r.enganche - pagoEng * (pe - 1)) : pagoEng;
    pagos.push({ num: num++, concepto: "Enganche", fecha: primer ? sumarMeses(primer, i) : null, importe });
  }
  for (let i = 0; i < r.n; i++) {
    const importe = i === r.n - 1 ? r2(r.totalMensual - r.mensualidad * (r.n - 1)) : r.mensualidad;
    pagos.push({ num: num++, concepto: "Construcción", fecha: primer ? sumarMeses(primer, pe + i) : null, importe });
  }
  pagos.push({ num: num++, concepto: "Escrituración", fecha: c.fecha_escrituracion || null, importe: r.escrituracion });
  return pagos;
}

/** "C2704" para los deptos que ya traen su clave; "A-101" para los demás. */
export function nombreDepto(u: { torre?: string | null; numero?: string | null } | null | undefined) {
  if (!u?.numero) return "";
  return /^[A-Za-z]\d{3,}$/.test(u.numero) ? u.numero : `${u.torre}-${u.numero}`;
}

/** Texto listo para pegar en WhatsApp. */
export function textoWhatsApp(p: {
  cliente?: string | null; desarrollo: string; depto: string; tipologia?: string | null; m2?: number | null;
  datos: DatosCotizacion; vigencia?: string | null;
}) {
  const r = calcular(p.datos);
  const descuento = (Number(p.datos.descuento_pct) || 0) > 0 || (Number(p.datos.descuento_monto) || 0) > 0;
  const esquema = p.datos.esquema || `${p.datos.enganche_pct}-${p.datos.mensualidades_pct}-${p.datos.escrituracion_pct}`;
  return [
    `Hola${p.cliente ? " " + p.cliente.split(" ")[0] : ""}, te comparto tu cotización de ${p.desarrollo}:`,
    ``,
    `🏢 Departamento ${p.depto}${p.tipologia ? " · Tipo " + p.tipologia : ""}${p.m2 ? " · " + p.m2 + " m²" : ""}`,
    descuento ? `💲 Precio de lista: ${dinero(p.datos.precio_lista)}` : null,
    descuento ? `🎉 Descuento: −${dinero(r.ahorro)}` : null,
    `✅ Precio final: ${dinero(r.precioFinal)}`,
    ``,
    `Esquema ${esquema}:`,
    `• Enganche ${p.datos.enganche_pct}%: ${dinero(r.enganche)}`,
    `• Construcción ${p.datos.mensualidades_pct}%: ${r.n} mensualidades de ${dinero(r.mensualidad)}`,
    `• Escrituración ${p.datos.escrituracion_pct}%: ${dinero(r.escrituracion)}`,
    `Apartas desde ${dinero(Number(p.datos.apartado ?? APARTADO))}.`,
    p.vigencia ? `` : null,
    p.vigencia ? `Precio vigente hasta el ${new Date(p.vigencia + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "long" })}.` : null,
  ].filter((x) => x !== null).join("\n");
}
