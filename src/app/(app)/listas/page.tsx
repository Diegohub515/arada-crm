"use client";
import { useState } from "react";
import { ListChecks, Plus, X } from "lucide-react";
import { Barra } from "@/components/Marco";
import { agregarOpcion, borrarOpcion, useListas } from "@/components/listas";
import { useToast } from "@/components/ui";
import { LISTAS_EDITABLES } from "@/lib/campos-lead";

/** Aquí se editan las opciones de todos los desplegables de la ficha del lead. */
export default function Listas() {
  const { de } = useListas();
  const [nuevos, setNuevos] = useState<Record<string, string>>({});
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [toast, avisar] = useToast();

  async function agregar(campo: string) {
    try {
      const v = await agregarOpcion(campo, nuevos[campo] ?? "");
      if (v) { setNuevos({ ...nuevos, [campo]: "" }); avisar(`“${v}” agregado`); }
    } catch (e: any) { avisar(e.message); }
  }

  return (
    <>
      <Barra titulo="Listas desplegables" icono={<ListChecks size={18} />} />
      <div className="contenido">
        <p style={{ margin: 0, color: "var(--texto-2)", maxWidth: 720 }}>
          Edita las opciones que aparecen en los desplegables de la ficha del lead y de la tabla de Leads.
          Quitar una opción no borra el dato de los leads que ya la tenían.
        </p>
        <div className="rejilla rejilla-3">
          {LISTAS_EDITABLES.map((l) => (
            <section className="tarjeta" key={l.campo}>
              <div className="tarjeta-cabeza"><h2>{l.nombre}</h2><div className="espacio" /><small style={{ color: "var(--texto-3)" }}>{de(l.campo).length}</small></div>
              <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="chips">
                  {de(l.campo).map((o) => (
                    <span className="chip" key={o.id}>
                      {o.valor}
                      {confirmar === o.id ? (
                        <button onClick={() => { borrarOpcion(o.id); setConfirmar(null); }} title="Confirmar" aria-label={`Confirmar quitar ${o.valor}`} style={{ color: "var(--mal)" }}>✓</button>
                      ) : (
                        <button onClick={() => setConfirmar(o.id)} aria-label={`Quitar ${o.valor}`}><X size={12} /></button>
                      )}
                    </span>
                  ))}
                  {de(l.campo).length === 0 && <small style={{ color: "var(--texto-3)" }}>Sin opciones todavía.</small>}
                </div>
                <div className="lista-nueva">
                  <input id={`nueva-${l.campo}`} className="entrada" placeholder="Nueva opción…" value={nuevos[l.campo] ?? ""}
                    onChange={(e) => setNuevos({ ...nuevos, [l.campo]: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && agregar(l.campo)} />
                  <button className="boton icono" onClick={() => agregar(l.campo)} aria-label="Agregar"><Plus size={15} /></button>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
      {toast}
    </>
  );
}
