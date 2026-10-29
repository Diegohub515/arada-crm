"use client";
import { BadgeDollarSign } from "lucide-react";
import Catalogo from "@/components/Catalogo";
import { Pastilla } from "@/components/ui";
import { dinero, dineroCorto, fecha, hoyISO } from "@/lib/formato";

type Venta = {
  id: string; unidad_id: string; lead_id: string | null; broker_id: string | null; precio_final: number;
  fecha_contrato: string; comision_broker_pct: number | null; estado: string; archivo_path: string | null; notas: string | null;
  unidades: { desarrollo: string; torre: string; numero: string; tipologia: string | null } | null;
  leads: { nombre: string } | null;
  brokers: { nombre: string } | null;
};

const ESTADOS = [
  { id: "firmada", nombre: "Contrato firmado" }, { id: "escriturada", nombre: "Escriturada" }, { id: "cancelada", nombre: "Cancelada" },
];
const TONO: Record<string, string> = { firmada: "info", escriturada: "bien", cancelada: "mal" };

export default function Ventas() {
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  const comision = (v: Venta) => (v.broker_id && v.comision_broker_pct ? (Number(v.precio_final) * Number(v.comision_broker_pct)) / 100 : 0);
  return (
    <Catalogo<Venta>
      tabla="ventas"
      titulo="Ventas"
      singular="Venta"
      icono={<BadgeDollarSign size={18} />}
      seleccion="*, unidades(desarrollo, torre, numero, tipologia), leads(nombre), brokers(nombre)"
      orden={{ campo: "fecha_contrato", asc: false }}
      carpetaArchivos="ventas"
      buscarEn={(v) => `${v.leads?.nombre ?? ""} ${v.unidades?.torre}-${v.unidades?.numero} ${v.brokers?.nombre ?? ""}`}
      filtros={{ campo: "estado", opciones: ESTADOS }}
      vacio="Registra cada contrato firmado. El departamento se marca como vendido y el lead como cerrado."
      resumen={(filas) => {
        const vivas = filas.filter((v) => v.estado !== "cancelada");
        const delMes = vivas.filter((v) => v.fecha_contrato.startsWith(mes));
        return (
          <div className="rejilla rejilla-4">
            <div className="tarjeta kpi"><div className="kpi-titulo">Ventas del mes</div><div className="kpi-fila"><span className="kpi-valor">{delMes.length}</span><span className="kpi-nota">{dineroCorto(delMes.reduce((s, v) => s + Number(v.precio_final), 0))}</span></div></div>
            <div className="tarjeta kpi"><div className="kpi-titulo">Total vendido</div><div className="kpi-valor">{dineroCorto(vivas.reduce((s, v) => s + Number(v.precio_final), 0))}</div></div>
            <div className="tarjeta kpi"><div className="kpi-titulo">Departamentos vendidos</div><div className="kpi-valor">{vivas.length}</div></div>
            <div className="tarjeta kpi"><div className="kpi-titulo">Comisiones a brokers</div><div className="kpi-valor">{dineroCorto(vivas.reduce((s, v) => s + comision(v), 0))}</div></div>
          </div>
        );
      }}
      columnas={[
        { titulo: "Depto.", render: (v) => <span><b>{v.unidades ? `${v.unidades.desarrollo} ${v.unidades.torre}-${v.unidades.numero}` : "—"}</b><br /><small style={{ color: "var(--texto-3)" }}>{v.unidades?.tipologia ?? ""}</small></span> },
        { titulo: "Cliente", render: (v) => v.leads?.nombre ?? "—" },
        { titulo: "Broker", render: (v) => v.brokers?.nombre ?? "Directa" },
        { titulo: "Precio", render: (v) => dinero(v.precio_final), der: true },
        { titulo: "Comisión", render: (v) => (comision(v) ? `${dinero(comision(v))} (${v.comision_broker_pct}%)` : "—"), der: true },
        { titulo: "Contrato", render: (v) => fecha(v.fecha_contrato) },
        { titulo: "Estado", render: (v) => <Pastilla tono={TONO[v.estado]}>{ESTADOS.find((e) => e.id === v.estado)?.nombre}</Pastilla> },
      ]}
      campos={[
        { nombre: "unidad_id", etiqueta: "Departamento", tipo: "unidades", requerido: true, ancho: true },
        { nombre: "lead_id", etiqueta: "Cliente", tipo: "leads", ancho: true },
        { nombre: "separacion_id", etiqueta: "Separación (opcional)", tipo: "separaciones", ancho: true },
        { nombre: "cotizacion_id", etiqueta: "Cotización (opcional)", tipo: "cotizaciones", ancho: true },
        { nombre: "precio_final", etiqueta: "Precio final (MXN)", tipo: "numero", requerido: true },
        { nombre: "fecha_contrato", etiqueta: "Fecha de contrato", tipo: "fecha", porDefecto: hoy },
        { nombre: "broker_id", etiqueta: "Broker (si aplica)", tipo: "brokers" },
        { nombre: "comision_broker_pct", etiqueta: "Comisión del broker (%)", tipo: "numero" },
        { nombre: "estado", etiqueta: "Estado", tipo: "lista", opciones: ESTADOS, porDefecto: "firmada", requerido: true },
        { nombre: "archivo", etiqueta: "Contrato (PDF)", tipo: "archivo" },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}
