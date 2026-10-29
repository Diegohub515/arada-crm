"use client";
import Catalogo from "@/components/Catalogo";
import { DESARROLLOS } from "@/lib/tipos";
import { fecha } from "@/lib/formato";

type Documento = {
  id: string; nombre: string; categoria: string | null; desarrollo: string | null;
  archivo_path: string | null; notas: string | null; created_at: string;
};

const CATEGORIAS = [
  "Planos y tipologías", "Renders", "Lista de precios", "Esquemas de pago", "Contratos",
  "Escrituras y permisos", "Brochure", "Material de marca", "Otro",
].map((c) => ({ id: c, nombre: c }));

export default function Documentos() {
  return (
    <Catalogo<Documento>
      tabla="documentos"
      titulo="Documentos"
      singular="Documento"
      carpetaArchivos="documentos"
      buscarEn={(d) => `${d.nombre} ${d.categoria ?? ""} ${d.desarrollo ?? ""} ${d.notas ?? ""}`}
      filtros={{ campo: "desarrollo", opciones: DESARROLLOS }}
      vacio="Sube planos, renders, listas de precios y contratos para tenerlos a la mano del equipo."
      columnas={[
        { titulo: "Documento", render: (d) => <b>{d.nombre}</b> },
        { titulo: "Categoría", render: (d) => (d.categoria ? <span className="etiqueta">{d.categoria}</span> : "—") },
        { titulo: "Desarrollo", render: (d) => DESARROLLOS.find((x) => x.id === d.desarrollo)?.nombre ?? "General" },
        { titulo: "Subido", render: (d) => fecha(d.created_at) },
      ]}
      campos={[
        { nombre: "nombre", etiqueta: "Nombre", requerido: true, ancho: true },
        { nombre: "categoria", etiqueta: "Categoría", tipo: "lista", opciones: CATEGORIAS },
        { nombre: "desarrollo", etiqueta: "Desarrollo", tipo: "lista", opciones: DESARROLLOS },
        { nombre: "archivo", etiqueta: "Archivo", tipo: "archivo", ancho: true },
        { nombre: "notas", etiqueta: "Notas", tipo: "notas" },
      ]}
    />
  );
}
