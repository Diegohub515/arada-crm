"use client";
import Link from "next/link";
import { Handshake } from "lucide-react";
import Catalogo from "@/components/Catalogo";
import { Pastilla } from "@/components/ui";
import { dinero, fecha, hoyISO } from "@/lib/formato";

type Separacion = {
  id: string; unidad_id: string; lead_id: string | null; cotizacion_id: string | null; monto: number; fecha: string;
  vence: string | null; metodo_pago: string | null; estado: string; archivo_path: string | null; notas: string | null;
  unidades: { desarrollo: string; torre: string; numero: string } | null;
  leads: { nombre: string } | null;
  cotizaciones: { precio_final: number; folio: string } | null;
};

const ESTADOS = [
  { id: "activa", nombre: "Activa" }, { id: "convertida", nombre: "Convertida en venta" },
  { id: "cancelada", nombre: "Cancelada" }, { id: "vencida", nombre: "Vencida" },
];
const TONO: Record<string, string> = { activa: "aviso", convertida: "bien", cancelada: "mal", vencida: "neutro" };
const METODOS = ["Transferencia", "Tarjeta", "Depósito", "Efectivo", "Cheque"].map((m) => ({ id: m, nombre: m }));

const enDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function Separaciones() {
  const hoy = hoyISO();
  const en3 = enDias(3);
  return (
    <Catalogo<Separacion>
      tabla="separaciones"
      titulo="Separaciones"
      singular="Separación"
      icono={<Handshake size={18} />}
      seleccion="*, unidades(desarrollo, torre, numero), leads(nombre), cotizaciones(precio_final, folio)"
      orden={{ campo: "fecha", asc: false }}
      carpetaArchivos="separaciones"
      buscarEn={(s) => `${s.leads?.nombre ?? ""} ${s.unidades?.torre}-${s.unidades?.numero} ${s.metodo_pago ?? ""}`}
      filtros={{ campo: "estado", opciones: ESTADOS.slice(0, 3) }}
      vacio="Registra aquí cada apartado con su comprobante. El departamento se marca como separado y el lead pasa a “Apartado”."
      resumen={(filas) => {
        const activas = filas.filter((s) => s.estado === "activa");
        const porVencer = activas.filter((s) => s.vence && s.vence <= en3);
        return (
          <div className="rejilla rejilla-3">
            <div className="tarjeta kpi"><div className="kpi-titulo">Separaciones activas</div><div className="kpi-valor">{activas.length}</div></div>
            <div className="tarjeta kpi"><div className="kpi-titulo">Monto separado</div><div className="kpi-valor">{dinero(activas.reduce((s, x) => s + Number(x.monto), 0))}</div></div>
            <div className="tarjeta kpi"><div className="kpi-titulo">Vencen en 3 días o menos</div>
              <div className="kpi-valor" style={{ color: porVencer.length ? "var(--mal)" : undefined }}>{porVencer.length}</div>
            </div>
          </div>
        );
      }}
      columnas={[
        { titulo: "Depto.", render: (s) => <b>{s.unidades ? `${s.unidades.desarrollo} ${s.unidades.torre}-${s.unidades.numero}` : "—"}</b> },
        { titulo: "Cliente", render: (s) => s.leads?.nombre ?? "—" },
        { titulo: "Monto", render: (s) => dinero(s.monto), der: true },
        { titulo: "Fecha", render: (s) => fecha(s.fecha) },
        { titulo: "Vence", render: (s) => <span className={s.estado === "activa" && s.vence && s.vence < hoy ? "atrasado" : ""}>{s.vence ? fecha(s.vence) : "—"}</span> },
        { titulo: "Estado", render: (s) => <Pastilla tono={TONO[s.estado]}>{ESTADOS.find((e) => e.id === s.estado)?.nombre}</Pastilla> },
        {
          titulo: "", render: (s) => s.estado === "activa" ? (
            <Link className="boton chico primario" onClick={(e) => e.stopPropagation()}
              href={`/ventas?nuevo=1&unidad_id=${s.unidad_id}${s.lead_id ? "&lead_id=" + s.lead_id : ""}&separacion_id=${s.id}${s.cotizacion_id ? "&cotizacion_id=" + s.cotizacion_id : ""}${s.cotizaciones ? "&precio_final=" + s.cotizaciones.precio_final : ""}`}>
              Registrar venta
            </Link>
          ) : null,
        },
      ]}
      campos={[
        { nombre: "unidad_id", etiqueta: "Departamento", tipo: "unidades", requerido: true, ancho: true },
        { nombre: "lead_id", etiqueta: "Cliente", tipo: "leads", ancho: true },
        { nombre: "cotizacion_id", etiqueta: "Cotización (opcional)", tipo: "cotizaciones", ancho: true },
        { nombre: "monto", etiqueta: "Monto de separación (MXN)", tipo: "numero", requerido: true },
        { nombre: "metodo_pago", etiqueta: "Forma de pago", tipo: "lista", opciones: METODOS },
        { nombre: "fecha", etiqueta: "Fecha", tipo: "fecha", porDefecto: hoy },
        { nombre: "vence", etiqueta: "Vence", tipo: "fecha", porDefecto: enDias(15) },
        { nombre: "estado", etiqueta: "Estado", tipo: "lista", opciones: ESTADOS, porDefecto: "activa", requerido: true },
        { nombre: "archivo", etiqueta: "Comprobante de pago", tipo: "archivo" },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}
