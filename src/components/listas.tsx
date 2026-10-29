"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Check, Plus, X } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";

type Opcion = { id: string; campo: string; valor: string; orden: number };

/* Pequeña memoria compartida: las opciones se cargan una sola vez y todos los selectores se actualizan juntos. */
let opciones: Opcion[] = [];
let cargado = false;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

async function cargar() {
  const { data } = await supabaseNavegador().from("opciones_campo").select("*").order("orden").order("valor");
  opciones = (data ?? []) as Opcion[];
  cargado = true;
  avisar();
}

export function useListas() {
  const version = useSyncExternalStore(
    (f) => { oyentes.add(f); return () => oyentes.delete(f); },
    () => opciones,
    () => opciones
  );
  useEffect(() => { if (!cargado) cargar(); }, []);
  return {
    de: (campo: string) => version.filter((o) => o.campo === campo),
    recargar: cargar,
  };
}

export async function agregarOpcion(campo: string, valor: string) {
  const v = valor.trim();
  if (!v) return null;
  const orden = Math.max(0, ...opciones.filter((o) => o.campo === campo).map((o) => o.orden)) + 1;
  const { error } = await supabaseNavegador().from("opciones_campo").insert({ campo, valor: v, orden });
  if (error && error.code !== "23505") throw new Error(error.message);
  await cargar();
  return v;
}

export async function borrarOpcion(id: string) {
  await supabaseNavegador().from("opciones_campo").delete().eq("id", id);
  await cargar();
}

export async function renombrarOpcion(id: string, valor: string) {
  const { error } = await supabaseNavegador().from("opciones_campo").update({ valor: valor.trim() }).eq("id", id);
  if (error) throw new Error(error.message);
  await cargar();
}

/** Desplegable con botón + para agregar una opción nueva sin salir de la ficha. */
export function SelectorLista({ id, campo, valor, onCambio }: { id: string; campo: string; valor: string | null; onCambio: (v: string | null) => void }) {
  const { de } = useListas();
  const [agregando, setAgregando] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const lista = de(campo);
  const existe = !valor || lista.some((o) => o.valor === valor);

  async function guardarNueva() {
    const v = await agregarOpcion(campo, nuevo).catch(() => null);
    setAgregando(false);
    setNuevo("");
    if (v) onCambio(v);
  }

  if (agregando) {
    return (
      <div className="lista-nueva">
        <input id={`${id}-nueva`} className="entrada" autoFocus placeholder="Nueva opción…" value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); guardarNueva(); } if (e.key === "Escape") setAgregando(false); }} />
        <button type="button" className="boton icono" onClick={guardarNueva} aria-label="Agregar opción"><Check size={15} /></button>
        <button type="button" className="boton icono" onClick={() => setAgregando(false)} aria-label="Cancelar"><X size={15} /></button>
      </div>
    );
  }
  return (
    <div className="lista-nueva">
      <select id={id} className="entrada" value={valor ?? ""} onChange={(e) => onCambio(e.target.value || null)}>
        <option value="">Seleccione una opción</option>
        {lista.map((o) => <option key={o.id} value={o.valor}>{o.valor}</option>)}
        {!existe && <option value={valor!}>{valor}</option>}
      </select>
      <button type="button" className="boton icono" onClick={() => setAgregando(true)} title="Agregar opción a esta lista" aria-label="Agregar opción"><Plus size={15} /></button>
    </div>
  );
}
