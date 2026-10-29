"use client";
import Catalogo from "@/components/Catalogo";
import { Pastilla } from "@/components/ui";

type Broker = {
  id: string; nombre: string; inmobiliaria: string | null; telefono: string | null; email: string | null;
  comision_pct: number | null; activo: boolean; notas: string | null; leads: { count: number }[];
};

export default function Brokers() {
  return (
    <Catalogo<Broker>
      tabla="brokers"
      titulo="Brokers"
      singular="Broker"
      seleccion="*, leads(count)"
      orden={{ campo: "nombre", asc: true }}
      buscarEn={(b) => `${b.nombre} ${b.inmobiliaria ?? ""} ${b.telefono ?? ""} ${b.email ?? ""}`}
      vacio="Agrega a los asesores externos que te traen clientes para darles seguimiento y calcular su comisión."
      columnas={[
        { titulo: "Broker", render: (b) => <div className="persona"><div><b>{b.nombre}</b><small>{b.inmobiliaria ?? "Independiente"}</small></div></div> },
        { titulo: "Contacto", render: (b) => <span>{b.telefono ?? "—"}<br /><small style={{ color: "var(--texto-3)" }}>{b.email ?? ""}</small></span> },
        { titulo: "Comisión", render: (b) => (b.comision_pct != null ? `${b.comision_pct}%` : "—"), der: true },
        { titulo: "Leads", render: (b) => b.leads?.[0]?.count ?? 0, der: true },
        { titulo: "Estado", render: (b) => <Pastilla tono={b.activo ? "bien" : "neutro"}>{b.activo ? "Activo" : "Inactivo"}</Pastilla> },
      ]}
      campos={[
        { nombre: "nombre", etiqueta: "Nombre", requerido: true },
        { nombre: "inmobiliaria", etiqueta: "Inmobiliaria" },
        { nombre: "telefono", etiqueta: "Teléfono" },
        { nombre: "email", etiqueta: "Correo" },
        { nombre: "comision_pct", etiqueta: "Comisión (%)", tipo: "numero", porDefecto: 3 },
        { nombre: "activo", etiqueta: "Activo", tipo: "booleano", porDefecto: true },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}
