"use client";
import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";
import { Barra } from "@/components/Marco";
import { FichaLead, NuevoLead, PastillaEtapa, useLeads } from "@/components/leads";
import { useOpciones } from "@/components/ui";
import { DESARROLLOS, ETAPAS, ORIGENES, nombreOrigen } from "@/lib/tipos";
import { fecha, hoyISO, iniciales, relativo } from "@/lib/formato";

export default function PaginaLeads() {
  return <Suspense><Leads /></Suspense>;
}

function Leads() {
  const params = useSearchParams();
  const { leads, error } = useLeads();
  const asesores = useOpciones("perfiles");
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState(params.get("etapa") ?? "todas");
  const [origen, setOrigen] = useState("todos");
  const [desarrollo, setDesarrollo] = useState("todos");
  const [soloPendientes, setSoloPendientes] = useState(params.get("seguimiento") === "1");
  const [abierto, setAbierto] = useState<string | null>(params.get("id"));
  const [nuevo, setNuevo] = useState(false);
  const hoy = hoyISO();

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (leads ?? []).filter((l) =>
      (etapa === "todas" || l.etapa === etapa) &&
      (origen === "todos" || l.origen === origen) &&
      (desarrollo === "todos" || l.desarrollo === desarrollo) &&
      (!soloPendientes || (!!l.proximo_seguimiento && l.proximo_seguimiento <= hoy && !["cerrado", "perdido"].includes(l.etapa))) &&
      (!t || `${l.nombre} ${l.telefono ?? ""} ${l.email ?? ""} ${l.campana ?? ""}`.toLowerCase().includes(t))
    );
  }, [leads, q, etapa, origen, desarrollo, soloPendientes, hoy]);

  const nombreAsesor = (id: string | null) => asesores.find((a) => a.id === id)?.nombre ?? "—";

  return (
    <>
      <Barra titulo="Leads">
        <button className="boton primario" onClick={() => setNuevo(true)}><Plus size={16} /> Nuevo lead</button>
      </Barra>
      <div className="contenido">
        <div className="tarjeta">
          <div className="herramientas" style={{ padding: 14 }}>
            <div className="buscador" style={{ width: "min(300px, 100%)" }}>
              <Search size={15} />
              <input id="buscar-leads" className="entrada" placeholder="Nombre, teléfono, correo…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <select id="f-etapa" className="entrada" style={{ width: "auto" }} value={etapa} onChange={(e) => setEtapa(e.target.value)}>
              <option value="todas">Todas las etapas</option>
              {ETAPAS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <select id="f-origen" className="entrada" style={{ width: "auto" }} value={origen} onChange={(e) => setOrigen(e.target.value)}>
              <option value="todos">Todos los orígenes</option>
              {ORIGENES.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <select id="f-desarrollo" className="entrada" style={{ width: "auto" }} value={desarrollo} onChange={(e) => setDesarrollo(e.target.value)}>
              <option value="todos">Ambos desarrollos</option>
              {DESARROLLOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input id="f-pendientes" type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              Seguimiento para hoy
            </label>
            <div className="espacio" />
            <small style={{ color: "var(--texto-3)" }}>{visibles.length} leads</small>
          </div>
          {error && <div className="error-caja" style={{ margin: 14 }}>No pude leer los leads: {error}</div>}
          <div className="tabla-caja">
            <table className="tabla">
              <thead>
                <tr><th>Lead</th><th>Etapa</th><th>Origen</th><th>Desarrollo</th><th>Asesor</th><th>Seguimiento</th><th>Llegó</th></tr>
              </thead>
              <tbody>
                {visibles.map((l) => {
                  const atrasado = !!l.proximo_seguimiento && l.proximo_seguimiento < hoy && !["cerrado", "perdido"].includes(l.etapa);
                  return (
                    <tr key={l.id} onClick={() => setAbierto(l.id)}>
                      <td>
                        <div className="persona">
                          <div className="avatar">{iniciales(l.nombre)}</div>
                          <div><b>{l.nombre}</b><small>{l.telefono ?? l.email ?? "Sin contacto"}</small></div>
                        </div>
                      </td>
                      <td><PastillaEtapa etapa={l.etapa} /></td>
                      <td><span className="etiqueta">{nombreOrigen(l.origen)}</span></td>
                      <td>{l.desarrollo ?? "—"}</td>
                      <td>{nombreAsesor(l.asesor_id)}</td>
                      <td className={atrasado ? "atrasado" : ""}>{l.proximo_seguimiento ? fecha(l.proximo_seguimiento) : "—"}</td>
                      <td style={{ color: "var(--texto-3)" }}>{relativo(l.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {leads && visibles.length === 0 && (
              <div className="vacio">
                <b>{leads.length ? "Ningún lead coincide" : "Todavía no llegan leads"}</b>
                {leads.length ? "Quita algún filtro." : "Conecta Zernio y tus formularios en Conexiones, o captura uno con “Nuevo lead”."}
              </div>
            )}
            {!leads && !error && <div className="vacio">Cargando…</div>}
          </div>
        </div>
      </div>
      {abierto && <FichaLead id={abierto} onCerrar={() => setAbierto(null)} />}
      {nuevo && <NuevoLead onCerrar={() => setNuevo(false)} onCreado={(id) => { setNuevo(false); setAbierto(id); }} />}
    </>
  );
}
