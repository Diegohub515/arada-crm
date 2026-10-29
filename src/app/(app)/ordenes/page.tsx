"use client";
import Catalogo from "@/components/Catalogo";
import { Pastilla } from "@/components/ui";
import { CATEGORIAS_GASTO, DESARROLLOS } from "@/lib/tipos";
import { dinero, fecha } from "@/lib/formato";

type Orden = {
  id: string; folio: string | null; concepto: string; categoria: string | null; desarrollo: string | null;
  monto: number; estado: string; fecha: string; archivo_path: string | null; notas: string | null;
  proveedor_id: string | null; proveedores: { nombre: string } | null;
};

const ESTADOS = [
  { id: "borrador", nombre: "Borrador" },
  { id: "aprobada", nombre: "Aprobada" },
  { id: "pagada", nombre: "Pagada" },
  { id: "cancelada", nombre: "Cancelada" },
];
const TONO: Record<string, string> = { borrador: "neutro", aprobada: "info", pagada: "bien", cancelada: "mal" };

export default function Ordenes() {
  return (
    <Catalogo<Orden>
      tabla="ordenes_compra"
      titulo="Órdenes de compra"
      singular="Orden"
      seleccion="*, proveedores(nombre)"
      orden={{ campo: "fecha", asc: false }}
      carpetaArchivos="ordenes"
      buscarEn={(o) => `${o.folio ?? ""} ${o.concepto} ${o.categoria ?? ""} ${o.proveedores?.nombre ?? ""}`}
      filtros={{ campo: "estado", opciones: ESTADOS }}
      vacio="Registra cada compra antes de pagarla para saber cuánto llevas comprometido por categoría y desarrollo."
      resumen={(filas) => {
        const activas = filas.filter((o) => o.estado !== "cancelada");
        const sum = (f: Orden[]) => f.reduce((s, o) => s + Number(o.monto || 0), 0);
        return (
          <div className="rejilla rejilla-3">
            <Resumen titulo="Comprometido (aprobadas)" valor={dinero(sum(activas.filter((o) => o.estado === "aprobada")))} />
            <Resumen titulo="Pagado" valor={dinero(sum(activas.filter((o) => o.estado === "pagada")))} />
            <Resumen titulo="Borradores por aprobar" valor={String(activas.filter((o) => o.estado === "borrador").length)} />
          </div>
        );
      }}
      columnas={[
        { titulo: "Folio", render: (o) => <b>{o.folio ?? "—"}</b> },
        { titulo: "Concepto", render: (o) => <span>{o.concepto}<br /><small style={{ color: "var(--texto-3)" }}>{o.proveedores?.nombre ?? "Sin proveedor"}</small></span> },
        { titulo: "Categoría", render: (o) => (o.categoria ? <span className="etiqueta">{o.categoria}</span> : "—") },
        { titulo: "Desarrollo", render: (o) => o.desarrollo ?? "—" },
        { titulo: "Fecha", render: (o) => fecha(o.fecha) },
        { titulo: "Monto", render: (o) => dinero(o.monto), der: true },
        { titulo: "Estado", render: (o) => <Pastilla tono={TONO[o.estado]}>{ESTADOS.find((e) => e.id === o.estado)?.nombre}</Pastilla> },
      ]}
      campos={[
        { nombre: "folio", etiqueta: "Folio" },
        { nombre: "fecha", etiqueta: "Fecha", tipo: "fecha" },
        { nombre: "concepto", etiqueta: "Concepto", requerido: true, ancho: true },
        { nombre: "proveedor_id", etiqueta: "Proveedor", tipo: "proveedores" },
        { nombre: "categoria", etiqueta: "Categoría", tipo: "lista", opciones: CATEGORIAS_GASTO },
        { nombre: "desarrollo", etiqueta: "Desarrollo", tipo: "lista", opciones: DESARROLLOS },
        { nombre: "monto", etiqueta: "Monto (MXN)", tipo: "numero", requerido: true },
        { nombre: "estado", etiqueta: "Estado", tipo: "lista", opciones: ESTADOS, porDefecto: "borrador", requerido: true },
        { nombre: "archivo", etiqueta: "Cotización u orden (PDF o imagen)", tipo: "archivo" },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}

function Resumen({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="tarjeta kpi">
      <div className="kpi-titulo">{titulo}</div>
      <div className="kpi-valor">{valor}</div>
    </div>
  );
}
