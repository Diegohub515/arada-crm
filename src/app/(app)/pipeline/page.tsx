"use client";
import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Barra } from "@/components/Marco";
import { FichaLead, NuevoLead, useLeads } from "@/components/leads";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS, ETAPAS, nombreEtapa, nombreOrigen, type Etapa } from "@/lib/tipos";
import { fecha, hoyISO } from "@/lib/formato";
import { useToast } from "@/components/ui";

export default function Pipeline() {
  const { leads, setLeads } = useLeads();
  const [desarrollo, setDesarrollo] = useState("todos");
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [toast, avisar] = useToast();
  const hoy = hoyISO();

  const columnas = useMemo(() => {
    const lista = (leads ?? []).filter((l) => desarrollo === "todos" || l.desarrollo === desarrollo);
    return ETAPAS.map((e) => ({ ...e, leads: lista.filter((l) => l.etapa === e.id) }));
  }, [leads, desarrollo]);

  async function mover(id: string, etapa: Etapa) {
    const lead = leads?.find((l) => l.id === id);
    if (!lead || lead.etapa === etapa) return;
    setLeads((ls) => ls?.map((l) => (l.id === id ? { ...l, etapa } : l)) ?? null);
    const db = supabaseNavegador();
    const { error } = await db.from("leads").update({ etapa }).eq("id", id);
    if (error) { avisar(`No se pudo mover: ${error.message}`); return; }
    const { data: auth } = await db.auth.getUser();
    await db.from("actividades").insert({
      lead_id: id, tipo: "cambio_etapa", creado_por: auth.user?.id,
      texto: `Etapa: ${nombreEtapa(lead.etapa)} → ${nombreEtapa(etapa)}`,
    });
    avisar(`${lead.nombre} → ${nombreEtapa(etapa)}`);
  }

  return (
    <>
      <Barra titulo="Pipeline">
        <div className="segmentos">
          {[{ id: "todos", nombre: "Todos" }, ...DESARROLLOS.map((d) => ({ id: d.id, nombre: d.id }))].map((o) => (
            <button key={o.id} className={desarrollo === o.id ? "activo" : ""} onClick={() => setDesarrollo(o.id)}>{o.nombre}</button>
          ))}
        </div>
        <button className="boton primario" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo</button>
      </Barra>
      <div className="contenido">
        <small style={{ color: "var(--texto-3)" }}>Arrastra una tarjeta para cambiarla de etapa. En el celular, ábrela y elige la etapa.</small>
        <div className="kanban">
          {columnas.map((c) => (
            <section
              key={c.id}
              className={`columna ${sobre === c.id ? "sobre" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setSobre(c.id); }}
              onDragLeave={() => setSobre((s) => (s === c.id ? null : s))}
              onDrop={(e) => { e.preventDefault(); setSobre(null); if (arrastrando) mover(arrastrando, c.id); setArrastrando(null); }}
            >
              <div className="columna-cabeza">
                <span className={`pastilla ${c.tono}`}>{c.nombre}</span>
                <small>{c.leads.length}</small>
              </div>
              {c.leads.slice(0, 200).map((l) => {
                const atrasado = !!l.proximo_seguimiento && l.proximo_seguimiento < hoy && !["cerrado", "perdido"].includes(l.etapa);
                return (
                  <article
                    key={l.id}
                    className="ficha"
                    draggable
                    onDragStart={() => setArrastrando(l.id)}
                    onDragEnd={() => setArrastrando(null)}
                    onClick={() => setAbierto(l.id)}
                  >
                    <b>{l.nombre}</b>
                    <div className="linea">
                      <span className="etiqueta">{nombreOrigen(l.origen)}</span>
                      {l.desarrollo && <span>{l.desarrollo}</span>}
                    </div>
                    <div className="linea">
                      <span>{l.telefono ?? l.email ?? "Sin contacto"}</span>
                      {l.proximo_seguimiento && <span className={atrasado ? "atrasado" : ""}>· {fecha(l.proximo_seguimiento)}</span>}
                    </div>
                  </article>
                );
              })}
              {c.leads.length === 0 && <small style={{ color: "var(--texto-3)", padding: "8px 4px" }}>Sin leads</small>}
            </section>
          ))}
        </div>
      </div>
      {abierto && <FichaLead id={abierto} onCerrar={() => setAbierto(null)} />}
      {nuevo && <NuevoLead onCerrar={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); setAbierto(id); }} />}
      {toast}
    </>
  );
}
