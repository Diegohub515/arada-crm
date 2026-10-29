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

export type TablaOpciones =
  | "perfiles" | "brokers" | "proveedores" | "ordenes_compra"
  | "unidades" | "leads" | "cotizaciones" | "separaciones";

const SELECCION: Record<TablaOpciones, string> = {
  perfiles: "id, nombre, email",
  brokers: "id, nombre",
  proveedores: "id, nombre",
  ordenes_compra: "id, concepto, folio",
  unidades: "id, desarrollo, torre, nivel, numero, tipologia, estado, vista, precio_lista",
  leads: "id, nombre, telefono",
  cotizaciones: "id, folio, precio_final, unidades(torre, numero), leads(nombre)",
  separaciones: "id, monto, estado, unidades(torre, numero), leads(nombre)",
};

function etiquetaOpcion(tabla: TablaOpciones, r: any): string {
  switch (tabla) {
    case "ordenes_compra": return `${r.folio ? r.folio + " · " : ""}${r.concepto}`;
    case "perfiles": return r.nombre || r.email || "Sin nombre";
    case "unidades": {
      const clave = /^[A-Za-z]\d{3,}$/.test(r.numero) ? r.numero : `${r.torre}-${r.numero}`;
      const precio = Number(r.precio_lista) ? " · $" + Number(r.precio_lista).toLocaleString("es-MX") : "";
      return `${r.desarrollo} ${clave}${r.tipologia ? " · Tipo " + r.tipologia : ""}${r.vista ? " · " + r.vista : ""}${precio} (${r.estado})`;
    }
    case "leads": return `${r.nombre}${r.telefono ? " · " + r.telefono : ""}`;
    case "cotizaciones": return `${r.folio ?? "COT"} · ${r.unidades ? r.unidades.torre + "-" + r.unidades.numero : ""} · ${r.leads?.nombre ?? "sin cliente"}`;
    case "separaciones": return `${r.unidades ? r.unidades.torre + "-" + r.unidades.numero : ""} · ${r.leads?.nombre ?? "sin cliente"} (${r.estado})`;
    default: return r.nombre || "Sin nombre";
  }
}

/** Lista simple {id, nombre} de una tabla, para los selectores. */
export function useOpciones(tabla: TablaOpciones | null) {
  const [opciones, setOpciones] = useState<{ id: string; nombre: string; fila?: any }[]>([]);
  useEffect(() => {
    if (!tabla) return;
    let q = supabaseNavegador().from(tabla).select(SELECCION[tabla]);
    if (tabla === "leads") q = q.order("created_at", { ascending: false }).limit(1000);
    if (tabla === "unidades") q = q.order("tipologia").order("numero");
    q.then(({ data }: { data: any[] | null }) => {
      setOpciones((data ?? []).map((r) => ({ id: r.id, nombre: etiquetaOpcion(tabla, r), fila: r })));
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
