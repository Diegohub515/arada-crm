"use client";
import Catalogo from "@/components/Catalogo";
import { CATEGORIAS_GASTO } from "@/lib/tipos";

type Proveedor = {
  id: string; nombre: string; rfc: string | null; categoria: string | null; contacto: string | null;
  telefono: string | null; email: string | null; notas: string | null;
};


export default function Proveedores() {
  return (
    <Catalogo<Proveedor>
      tabla="proveedores"
      titulo="Proveedores"
      singular="Proveedor"
      orden={{ campo: "nombre", asc: true }}
      buscarEn={(p) => `${p.nombre} ${p.rfc ?? ""} ${p.categoria ?? ""} ${p.contacto ?? ""}`}
      vacio="Registra agencias, fotógrafos, imprentas y demás para ligarlos a órdenes de compra y facturas."
      columnas={[
        { titulo: "Proveedor", render: (p) => <div className="persona"><div><b>{p.nombre}</b><small>{p.rfc ?? "Sin RFC"}</small></div></div> },
        { titulo: "Categoría", render: (p) => (p.categoria ? <span className="etiqueta">{p.categoria}</span> : "—") },
        { titulo: "Contacto", render: (p) => p.contacto ?? "—" },
        { titulo: "Teléfono", render: (p) => p.telefono ?? "—" },
        { titulo: "Correo", render: (p) => p.email ?? "—" },
      ]}
      campos={[
        { nombre: "nombre", etiqueta: "Nombre o razón social", requerido: true, ancho: true },
        { nombre: "rfc", etiqueta: "RFC" },
        { nombre: "categoria", etiqueta: "Categoría", tipo: "lista", opciones: CATEGORIAS_GASTO },
        { nombre: "contacto", etiqueta: "Persona de contacto" },
        { nombre: "telefono", etiqueta: "Teléfono" },
        { nombre: "email", etiqueta: "Correo", ancho: true },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}
