"use client";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Columns3, FilterX, Plus, Search } from "lucide-react";
import { Barra } from "@/components/Marco";
import { NuevoLead, PastillaEtapa, useLeads } from "@/components/leads";
import { useListas } from "@/components/listas";
import { useOpciones, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { SECCIONES_LEAD, TODOS_CAMPOS, type CampoLead } from "@/lib/campos-lead";
import { DESARROLLOS, ETAPAS, ORIGENES, nombreOrigen, type Lead } from "@/lib/tipos";
import { dinero, fecha, hoyISO, iniciales, relativo } from "@/lib/formato";

const COLUMNAS_INICIALES = ["etapa", "origen", "desarrollo", "asesor_id", "nivel_interes", "proximo_seguimiento", "created_at"];
const CLAVE = "arada-crm:columnas-leads";

export default function PaginaLeads() {
  return <Suspense><Leads /></Suspense>;
}

function Leads() {
  const params = useSearchParams();
  const router = useRouter();
  const { leads, setLeads, error } = useLeads();
  const asesores = useOpciones("perfiles");
  const brokers = useOpciones("brokers");
  const { de } = useListas();
  const [toast, avisar] = useToast();
  const [q, setQ] = useState("");
  const [etapa, setEtapa] = useState(params.get("etapa") ?? "todas");
  const [origen, setOrigen] = useState("todos");
  const [desarrollo, setDesarrollo] = useState("todos");
  // Filtro por columna: clave del campo → valor ("__vacio" = sin dato)
  const [filtrosCol, setFiltrosCol] = useState<Record<string, string>>({});
  const [soloPendientes, setSoloPendientes] = useState(params.get("seguimiento") === "1");
  const [nuevo, setNuevo] = useState(false);
  const [columnas, setColumnas] = useState<string[]>(COLUMNAS_INICIALES);
  const [menuCols, setMenuCols] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hoy = hoyISO();

  useEffect(() => {
    try { const g = localStorage.getItem(CLAVE); if (g) setColumnas(JSON.parse(g)); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    if (!menuCols) return;
    const cerrar = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuCols(false); };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [menuCols]);

  function alternarColumna(k: string) {
    const nuevas = columnas.includes(k) ? columnas.filter((c) => c !== k) : [...columnas, k];
    setColumnas(nuevas);
    try { localStorage.setItem(CLAVE, JSON.stringify(nuevas)); } catch { /* sin almacenamiento */ }
  }

  const cols = columnas.map((k) => TODOS_CAMPOS.find((c) => c.k === k)).filter((c): c is CampoLead => !!c && c.k !== "nombre" && c.k !== "notas");

  /** ¿El lead pasa el filtro de esta columna? */
  function pasaColumna(l: Lead, c: CampoLead, f: string) {
    if (!f) return true;
    const v = (l as any)[c.k];
    const vacio = v == null || v === "";
    if (f === "__vacio") return vacio;
    if (vacio) return false;
    switch (c.tipo) {
      case "etapa": case "lista": case "asesor": case "broker": case "desarrollo": case "origen":
        return String(v) === f;
      case "fecha": return String(v).slice(0, 10) >= f; // "desde"
      case "numero": return Number(v) >= Number(f.replace(/[^\d.]/g, "") || 0); // "mínimo"
      default: return String(v).toLowerCase().includes(f.trim().toLowerCase());
    }
  }

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (leads ?? []).filter((l) =>
      (etapa === "todas" || l.etapa === etapa) &&
      (origen === "todos" || l.origen === origen) &&
      (desarrollo === "todos" || (desarrollo === "__vacio" ? !l.desarrollo : l.desarrollo === desarrollo)) &&
      cols.every((c) => pasaColumna(l, c, filtrosCol[c.k] ?? "")) &&
      (!soloPendientes || (!!l.proximo_seguimiento && l.proximo_seguimiento <= hoy && !["cerrado", "perdido"].includes(l.etapa))) &&
      (!t || `${l.nombre} ${l.telefono ?? ""} ${l.email ?? ""} ${l.campana ?? ""}`.toLowerCase().includes(t))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, q, etapa, origen, desarrollo, soloPendientes, hoy, filtrosCol, columnas]);

  const hayFiltros = !!q || etapa !== "todas" || origen !== "todos" || desarrollo !== "todos" || soloPendientes || Object.values(filtrosCol).some(Boolean);
  function limpiar() {
    setQ(""); setEtapa("todas"); setOrigen("todos"); setDesarrollo("todos"); setSoloPendientes(false); setFiltrosCol({});
  }

  /** Control de filtro bajo el encabezado de cada columna. */
  function filtroDe(c: CampoLead) {
    const f = filtrosCol[c.k] ?? "";
    const poner = (v: string) => setFiltrosCol((x) => ({ ...x, [c.k]: v }));
    const sel = (opciones: { id: string; nombre: string }[]) => (
      <select className="entrada filtro-col" value={f} onChange={(e) => poner(e.target.value)} aria-label={`Filtrar ${c.n}`}>
        <option value="">Todos</option>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
        <option value="__vacio">(vacío)</option>
      </select>
    );
    switch (c.tipo) {
      case "etapa": return sel(ETAPAS.map((e) => ({ id: e.id, nombre: e.nombre })));
      case "lista": {
        const usados = Array.from(new Set((leads ?? []).map((l) => (l as any)[c.k]).filter(Boolean))) as string[];
        const ops = Array.from(new Set([...de(c.k).map((o) => o.valor), ...usados]));
        return sel(ops.map((v) => ({ id: v, nombre: v })));
      }
      case "asesor": return sel(asesores);
      case "broker": return sel(brokers);
      case "desarrollo": return sel(DESARROLLOS);
      case "origen": return sel(ORIGENES.map((o) => ({ id: o.id, nombre: o.nombre })));
      case "fecha": return <input type="date" className="entrada filtro-col" value={f} onChange={(e) => poner(e.target.value)} title="Desde esta fecha" aria-label={`${c.n} desde`} />;
      case "numero": return <input className="entrada filtro-col" inputMode="numeric" placeholder="Mínimo" value={f} onChange={(e) => poner(e.target.value)} aria-label={`${c.n} mínimo`} />;
      default: return <input className="entrada filtro-col" placeholder="Contiene…" value={f} onChange={(e) => poner(e.target.value)} aria-label={`Filtrar ${c.n}`} />;
    }
  }

  async function editar(l: Lead, k: string, v: string) {
    const valor = v === "" ? null : v;
    setLeads((ls) => ls?.map((x) => (x.id === l.id ? ({ ...x, [k]: valor } as Lead) : x)) ?? null);
    const { error } = await supabaseNavegador().from("leads").update({ [k]: valor }).eq("id", l.id);
    avisar(error ? `No se guardó: ${error.message}` : "Guardado");
  }

  /** Celda: los desplegables se editan ahí mismo; lo demás se muestra como texto. */
  function celda(l: Lead, c: CampoLead) {
    const v = (l as any)[c.k];
    const parar = (e: React.SyntheticEvent) => e.stopPropagation();
    const select = (opciones: { id: string; nombre: string }[], vacio = "—") => (
      <select className="entrada celda-select" value={v ?? ""} onClick={parar} onChange={(e) => editar(l, c.k, e.target.value)} aria-label={c.n}>
        <option value="">{vacio}</option>
        {opciones.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
      </select>
    );
    switch (c.tipo) {
      case "etapa": return <span onClick={parar} className="celda-etapa"><PastillaEtapa etapa={l.etapa} />{select(ETAPAS.map((e) => ({ id: e.id, nombre: e.nombre })))}</span>;
      case "lista": return select(de(c.k).map((o) => ({ id: o.valor, nombre: o.valor })).concat(v && !de(c.k).some((o) => o.valor === v) ? [{ id: v, nombre: v }] : []));
      case "asesor": return select(asesores, "Sin asignar");
      case "broker": return select(brokers, "Ninguno");
      case "desarrollo": return select(DESARROLLOS);
      case "origen": return <span className="etiqueta">{nombreOrigen(v)}</span>;
      case "fecha": {
        if (!v) return "—";
        const atrasado = c.k === "proximo_seguimiento" && v < hoy && !["cerrado", "perdido"].includes(l.etapa);
        return <span className={atrasado ? "atrasado" : ""}>{c.k === "created_at" ? relativo(v) : fecha(v)}</span>;
      }
      case "numero": return v != null ? dinero(v) : "—";
      default: return v ?? "—";
    }
  }

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
              <option value="todos">Todos los desarrollos</option>
              {DESARROLLOS.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
              <option value="__vacio">Sin desarrollo</option>
            </select>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
              <input id="f-pendientes" type="checkbox" checked={soloPendientes} onChange={(e) => setSoloPendientes(e.target.checked)} />
              Seguimiento para hoy
            </label>
            <div className="espacio" />
            {hayFiltros && <button className="boton chico" onClick={limpiar}><FilterX size={14} /> Quitar filtros</button>}
            <small style={{ color: "var(--texto-3)" }}>{visibles.length} leads</small>
            <div style={{ position: "relative" }} ref={menuRef}>
              <button className="boton" onClick={() => setMenuCols((m) => !m)}><Columns3 size={15} /> Columnas</button>
              {menuCols && (
                <div className="columnas-menu">
                  {SECCIONES_LEAD.map((s) => (
                    <div key={s.titulo} style={{ display: "contents" }}>
                      <b>{s.titulo}</b>
                      {s.campos.filter((c) => c.k !== "nombre" && c.k !== "notas").map((c) => (
                        <label key={c.k}><input type="checkbox" checked={columnas.includes(c.k)} onChange={() => alternarColumna(c.k)} /> {c.n}</label>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {error && <div className="error-caja" style={{ margin: 14 }}>No pude leer los leads: {error}</div>}
          <div className="tabla-caja">
            <table className="tabla">
              <thead>
                <tr><th>Lead</th>{cols.map((c) => <th key={c.k}>{c.n}</th>)}</tr>
                <tr className="fila-filtros">
                  <th><input className="entrada filtro-col" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar lead" /></th>
                  {cols.map((c) => <th key={c.k}>{filtroDe(c)}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibles.map((l) => (
                  <tr key={l.id} onClick={() => router.push(`/leads/${l.id}`)}>
                    <td>
                      <div className="persona">
                        <div className="avatar">{iniciales(l.nombre)}</div>
                        <div><b>{l.nombre}</b><small>{l.telefono ?? l.email ?? "Sin contacto"}</small></div>
                      </div>
                    </td>
                    {cols.map((c) => <td key={c.k}>{celda(l, c)}</td>)}
                  </tr>
                ))}
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
        <small style={{ color: "var(--texto-3)" }}>Los desplegables de la tabla se guardan al cambiarlos. Con “Columnas” eliges qué ver; debajo de cada encabezado puedes filtrar esa columna.</small>
      </div>
      {nuevo && <NuevoLead onCerrar={() => setNuevo(false)} onCreado={(id) => router.push(`/leads/${id}`)} />}
      {toast}
    </>
  );
}
