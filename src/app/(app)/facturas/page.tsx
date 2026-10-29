"use client";
import { useState } from "react";
import { Sparkles } from "lucide-react";
import Catalogo from "@/components/Catalogo";
import { Pastilla, Ventana } from "@/components/ui";
import { CATEGORIAS_GASTO, DESARROLLOS } from "@/lib/tipos";
import { dinero, fecha, hoyISO } from "@/lib/formato";

type Factura = {
  id: string; folio: string | null; uuid_fiscal: string | null; concepto: string | null; categoria: string | null;
  desarrollo: string | null; subtotal: number | null; iva: number | null; total: number; fecha_emision: string | null;
  fecha_vencimiento: string | null; estado: string; archivo_path: string | null; notas: string | null;
  proveedor_id: string | null; orden_id: string | null; proveedores: { nombre: string } | null;
};

const ESTADOS = [
  { id: "pendiente", nombre: "Por pagar" },
  { id: "pagada", nombre: "Pagada" },
  { id: "cancelada", nombre: "Cancelada" },
];

export default function Facturas() {
  const [ia, setIa] = useState<{ cargando: boolean; texto?: string; error?: string } | null>(null);

  async function analizar() {
    setIa({ cargando: true });
    try {
      const r = await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "gastos" }) });
      const d = await r.json();
      setIa(r.ok ? { cargando: false, texto: d.texto } : { cargando: false, error: d.error });
    } catch {
      setIa({ cargando: false, error: "No hubo conexión con el servidor." });
    }
  }

  const hoy = hoyISO();
  const vencida = (f: Factura) => f.estado === "pendiente" && !!f.fecha_vencimiento && f.fecha_vencimiento < hoy;

  return (
    <>
      <Catalogo<Factura>
        tabla="facturas"
        titulo="Facturas"
        singular="Factura"
        seleccion="*, proveedores(nombre)"
        orden={{ campo: "fecha_emision", asc: false }}
        carpetaArchivos="facturas"
        extra={<button className="boton" onClick={analizar}><Sparkles size={15} /> Analizar gastos con IA</button>}
        buscarEn={(f) => `${f.folio ?? ""} ${f.uuid_fiscal ?? ""} ${f.concepto ?? ""} ${f.proveedores?.nombre ?? ""} ${f.categoria ?? ""}`}
        filtros={{ campo: "estado", opciones: ESTADOS }}
        vacio="Sube el PDF o XML de cada factura de proveedor para tener el gasto real por categoría y saber qué se vence."
        resumen={(filas) => {
          const pend = filas.filter((f) => f.estado === "pendiente");
          const mes = hoy.slice(0, 7);
          const sum = (f: Factura[]) => f.reduce((s, x) => s + Number(x.total || 0), 0);
          return (
            <div className="rejilla rejilla-3">
              <div className="tarjeta kpi"><div className="kpi-titulo">Por pagar</div><div className="kpi-valor">{dinero(sum(pend))}</div></div>
              <div className="tarjeta kpi"><div className="kpi-titulo">Vencidas</div>
                <div className="kpi-fila"><div className="kpi-valor" style={{ color: pend.some(vencida) ? "var(--mal)" : undefined }}>{pend.filter(vencida).length}</div><span className="kpi-nota">{dinero(sum(pend.filter(vencida)))}</span></div>
              </div>
              <div className="tarjeta kpi"><div className="kpi-titulo">Facturado este mes</div><div className="kpi-valor">{dinero(sum(filas.filter((f) => f.estado !== "cancelada" && (f.fecha_emision ?? "").startsWith(mes))))}</div></div>
            </div>
          );
        }}
        columnas={[
          { titulo: "Proveedor", render: (f) => <span><b>{f.proveedores?.nombre ?? "Sin proveedor"}</b><br /><small style={{ color: "var(--texto-3)" }}>{f.folio ? `Folio ${f.folio}` : f.uuid_fiscal?.slice(0, 8) ?? ""}</small></span> },
          { titulo: "Concepto", render: (f) => f.concepto ?? "—" },
          { titulo: "Categoría", render: (f) => (f.categoria ? <span className="etiqueta">{f.categoria}</span> : "—") },
          { titulo: "Emisión", render: (f) => fecha(f.fecha_emision) },
          { titulo: "Vence", render: (f) => <span className={vencida(f) ? "atrasado" : ""}>{fecha(f.fecha_vencimiento)}</span> },
          { titulo: "Total", render: (f) => dinero(f.total), der: true },
          { titulo: "Estado", render: (f) => vencida(f) ? <Pastilla tono="mal">Vencida</Pastilla> : <Pastilla tono={f.estado === "pagada" ? "bien" : f.estado === "cancelada" ? "neutro" : "aviso"}>{ESTADOS.find((e) => e.id === f.estado)?.nombre}</Pastilla> },
        ]}
        campos={[
          { nombre: "proveedor_id", etiqueta: "Proveedor", tipo: "proveedores" },
          { nombre: "orden_id", etiqueta: "Orden de compra", tipo: "ordenes" },
          { nombre: "folio", etiqueta: "Folio / serie" },
          { nombre: "uuid_fiscal", etiqueta: "UUID (folio fiscal)" },
          { nombre: "concepto", etiqueta: "Concepto", ancho: true },
          { nombre: "categoria", etiqueta: "Categoría", tipo: "lista", opciones: CATEGORIAS_GASTO },
          { nombre: "desarrollo", etiqueta: "Desarrollo", tipo: "lista", opciones: DESARROLLOS },
          { nombre: "subtotal", etiqueta: "Subtotal", tipo: "numero" },
          { nombre: "iva", etiqueta: "IVA", tipo: "numero" },
          { nombre: "total", etiqueta: "Total (MXN)", tipo: "numero", requerido: true },
          { nombre: "estado", etiqueta: "Estado", tipo: "lista", opciones: ESTADOS, porDefecto: "pendiente", requerido: true },
          { nombre: "fecha_emision", etiqueta: "Fecha de emisión", tipo: "fecha", porDefecto: hoy },
          { nombre: "fecha_vencimiento", etiqueta: "Fecha de vencimiento", tipo: "fecha" },
          { nombre: "archivo", etiqueta: "PDF o XML", tipo: "archivo", ancho: true },
          { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
        ]}
      />
      {ia && (
        <Ventana titulo="Análisis de gastos (últimos 6 meses)" onCerrar={() => setIa(null)}>
          {ia.cargando && <p>Revisando órdenes, facturas y leads…</p>}
          {ia.error && <div className="error-caja">{ia.error}</div>}
          {ia.texto && <div className="ia-caja">{ia.texto}</div>}
        </Ventana>
      )}
    </>
  );
}
