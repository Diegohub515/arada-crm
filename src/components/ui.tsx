"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";

export function Ventana({
  titulo, onCerrar, children, pie, lado = false,
}: { titulo: React.ReactNode; onCerrar: () => void; children: React.ReactNode; pie?: React.ReactNode; lado?: boolean }) {
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [onCerrar]);
  return (
    <div className={`velo ${lado ? "lado" : ""}`} onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={lado ? "panel" : "ventana"} role="dialog" aria-modal="true">
        <div className="ventana-cabeza">
          <h2>{titulo}</h2>
          <button className="boton icono" onClick={onCerrar} aria-label="Cerrar"><X size={17} /></button>
        </div>
        <div className="ventana-cuerpo">{children}</div>
        {pie && <div className="ventana-pie">{pie}</div>}
      </div>
    </div>
  );
}

/** Mensaje breve en la parte de abajo: const [toast, avisar] = useToast() */
export function useToast() {
  const [texto, setTexto] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const avisar = useCallback((m: string) => {
    setTexto(m);
    clearTimeout(t.current);
    t.current = setTimeout(() => setTexto(null), 2600);
  }, []);
  const nodo = texto ? <div className="toast" role="status">{texto}</div> : null;
  return [nodo, avisar] as const;
}

export function Pastilla({ tono = "neutro", children }: { tono?: string; children: React.ReactNode }) {
  return <span className={`pastilla ${tono}`}>{children}</span>;
}

export function IconoRed({ plataforma }: { plataforma: string | null }) {
  const p = (plataforma ?? "").toLowerCase();
  const clase = p.includes("whatsapp") ? "whatsapp" : p.includes("instagram") ? "instagram" : p.includes("facebook") || p.includes("messenger") ? "facebook" : "otro";
  const letra = { whatsapp: "W", instagram: "I", facebook: "f", otro: "•" }[clase];
  return <span className={`red ${clase}`} title={plataforma ?? ""}>{letra}</span>;
}

/** Lista simple {id, nombre} de una tabla, para los selectores. */
export function useOpciones(tabla: "perfiles" | "brokers" | "proveedores" | "ordenes_compra") {
  const [opciones, setOpciones] = useState<{ id: string; nombre: string }[]>([]);
  useEffect(() => {
    const campo = tabla === "ordenes_compra" ? "id, nombre:concepto, folio" : tabla === "perfiles" ? "id, nombre, email" : "id, nombre";
    supabaseNavegador().from(tabla).select(campo).then(({ data }) => {
      setOpciones(
        ((data ?? []) as any[]).map((r) => ({
          id: r.id,
          nombre: tabla === "ordenes_compra" ? `${r.folio ? r.folio + " · " : ""}${r.nombre}` : r.nombre || r.email || "Sin nombre",
        }))
      );
    });
  }, [tabla]);
  return opciones;
}

/** Abre un archivo privado del bucket en una pestaña nueva con enlace temporal. */
export async function abrirArchivo(ruta: string) {
  const { data, error } = await supabaseNavegador().storage.from("archivos").createSignedUrl(ruta, 300);
  if (error || !data) throw new Error("No se pudo abrir el archivo");
  window.open(data.signedUrl, "_blank", "noopener");
}

export async function subirArchivo(carpeta: string, archivo: File) {
  const limpio = archivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.\-]+/g, "_");
  const ruta = `${carpeta}/${Date.now()}_${limpio}`;
  const { error } = await supabaseNavegador().storage.from("archivos").upload(ruta, archivo, { upsert: false });
  if (error) throw new Error(`No se pudo subir el archivo: ${error.message}`);
  return ruta;
}
