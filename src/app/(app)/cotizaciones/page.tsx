"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, FileText, Plus, Printer, Search } from "lucide-react";
import { Barra } from "@/components/Marco";
import { Pastilla, Ventana, useOpciones, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS } from "@/lib/tipos";
import { dinero, fecha, hoyISO } from "@/lib/formato";
import { calcular, textoWhatsApp, type DatosCotizacion } from "@/lib/cotizacion";

type Cotizacion = DatosCotizacion & {
  id: string; folio: string; unidad_id: string; lead_id: string | null; precio_final: number;
  vigencia: string | null; estado: string; notas: string | null; created_at: string;
  unidades: { desarrollo: string; torre: string; numero: string; tipologia: string | null; m2_interior: number | null; m2_terraza: number | null; estado: string } | null;
  leads: { nombre: string; telefono: string | null } | null;
};

const ESTADOS = [
  { id: "vigente", nombre: "Vigente", tono: "info" }, { id: "aceptada", nombre: "Aceptada", tono: "bien" },
  { id: "vencida", nombre: "Vencida", tono: "neutro" }, { id: "cancelada", nombre: "Cancelada", tono: "mal" },
];

const enDias = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

export default function Cotizaciones() {
  const db = supabaseNavegador();
  const [lista, setLista] = useState<Cotizacion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [nueva, setNueva] = useState<Record<string, string> | null>(null);
  const [abierta, setAbierta] = useState<Cotizacion | null>(null);
  const [toast, avisar] = useToast();
  const hoy = hoyISO();

  const cargar = useCallback(async () => {
    const { data, error } = await db.from("cotizaciones")
      .select("*, unidades(desarrollo, torre, numero, tipologia, m2_interior, m2_terraza, estado), leads(nombre, telefono)")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setLista(data as Cotizacion[]);
  }, [db]);
  useEffect(() => { cargar(); }, [cargar]);

  // ?nuevo=1&unidad_id=…&lead_id=… (desde Inventario o la ficha del lead)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("nuevo")) {
      setNueva({ unidad_id: sp.get("unidad_id") ?? "", lead_id: sp.get("lead_id") ?? "" });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (lista ?? []).filter((c) => !t || `${c.folio} ${c.leads?.nombre ?? ""} ${c.unidades?.torre}-${c.unidades?.numero}`.toLowerCase().includes(t));
  }, [lista, q]);

  const estadoReal = (c: Cotizacion) => (c.estado === "vigente" && c.vigencia && c.vigencia < hoy ? "vencida" : c.estado);

  return (
    <>
      <Barra titulo="Cotizaciones" icono={<FileText size={18} />}>
        <button className="boton primario" onClick={() => setNueva({ unidad_id: "", lead_id: "" })}><Plus size={16} /> Nueva cotización</button>
      </Barra>
      <div className="contenido">
        <div className="tarjeta">
          <div className="herramientas" style={{ padding: 14 }}>
            <div className="buscador" style={{ width: "min(320px, 100%)" }}>
              <Search size={15} />
              <input id="buscar-cot" className="entrada" placeholder="Folio, cliente o depto…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="espacio" />
            <small style={{ color: "var(--texto-3)" }}>{visibles.length} cotizaciones</small>
          </div>
          {error && <div className="error-caja" style={{ margin: 14 }}>{error}</div>}
          <div className="tabla-caja">
            <table className="tabla">
              <thead><tr><th>Folio</th><th>Cliente</th><th>Depto.</th><th className="der">Precio final</th><th className="der">Enganche</th><th>Vigencia</th><th>Estado</th></tr></thead>
              <tbody>
                {visibles.map((c) => {
                  const r = calcular(c);
                  const e = estadoReal(c);
                  return (
                    <tr key={c.id} onClick={() => setAbierta(c)}>
                      <td><b>{c.folio}</b><br /><small style={{ color: "var(--texto-3)" }}>{fecha(c.created_at)}</small></td>
                      <td>{c.leads?.nombre ?? "—"}</td>
                      <td>{c.unidades ? `${c.unidades.desarrollo} ${c.unidades.torre}-${c.unidades.numero}` : "—"}</td>
                      <td className="der num">{dinero(c.precio_final)}{c.descuento_pct ? <><br /><small style={{ color: "var(--bien)" }}>−{c.descuento_pct}%</small></> : null}</td>
                      <td className="der num">{dinero(r.enganche)}</td>
                      <td>{c.vigencia ? fecha(c.vigencia) : "—"}</td>
                      <td><Pastilla tono={ESTADOS.find((x) => x.id === e)?.tono}>{ESTADOS.find((x) => x.id === e)?.nombre}</Pastilla></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {lista && visibles.length === 0 && <div className="vacio"><b>{lista.length ? "Sin resultados" : "Aún no hay cotizaciones"}</b>Cotiza desde aquí o desde un departamento del Inventario.</div>}
            {!lista && !error && <div className="vacio">Cargando…</div>}
          </div>
        </div>
      </div>

      {nueva && <NuevaCotizacion inicial={nueva} onCerrar={() => setNueva(null)} onCreada={(c) => { setNueva(null); cargar(); avisar(`Cotización ${c} creada`); }} />}
      {abierta && (
        <DetalleCotizacion c={abierta} estado={estadoReal(abierta)} onCerrar={() => setAbierta(null)} avisar={avisar}
          onCambio={async (estado) => {
            const { error } = await db.from("cotizaciones").update({ estado }).eq("id", abierta.id);
            if (error) return avisar(error.message);
            setAbierta(null); cargar();
          }} />
      )}
      {toast}
    </>
  );
}

function NuevaCotizacion({ inicial, onCerrar, onCreada }: { inicial: Record<string, string>; onCerrar: () => void; onCreada: (folio: string) => void }) {
  const db = supabaseNavegador();
  const unidades = useOpciones("unidades");
  const leads = useOpciones("leads");
  const [unidadId, setUnidadId] = useState(inicial.unidad_id ?? "");
  const [leadId, setLeadId] = useState(inicial.lead_id ?? "");
  const [d, setD] = useState({ descuento_pct: "0", enganche_pct: "15", mensualidades_pct: "15", num_mensualidades: "12", escrituracion_pct: "70" });
  const [vigencia, setVigencia] = useState(enDias(7));
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const unidad = unidades.find((u) => u.id === unidadId)?.fila as any;
  const [precio, setPrecio] = useState<number>(0);
  useEffect(() => {
    if (!unidadId) return;
    db.from("unidades").select("precio_lista").eq("id", unidadId).single().then(({ data }) => setPrecio(Number(data?.precio_lista ?? 0)));
  }, [db, unidadId]);

  const datos: DatosCotizacion = {
    precio_lista: precio, descuento_pct: Number(d.descuento_pct) || 0, enganche_pct: Number(d.enganche_pct) || 0,
    mensualidades_pct: Number(d.mensualidades_pct) || 0, num_mensualidades: Number(d.num_mensualidades) || 1,
    escrituracion_pct: Number(d.escrituracion_pct) || 0,
  };
  const r = calcular(datos);
  const disponibles = unidades.filter((u) => u.fila?.estado === "disponible" || u.id === unidadId);

  async function guardar() {
    if (!unidadId) return setError("Elige un departamento.");
    if (!r.sumaPctOk) return setError(`Los porcentajes suman ${r.sumaPct}%; deben sumar 100%.`);
    setGuardando(true);
    const { data: auth } = await db.auth.getUser();
    const { data, error } = await db.from("cotizaciones").insert({
      unidad_id: unidadId, lead_id: leadId || null, asesor_id: auth.user?.id ?? null,
      ...datos, precio_final: r.precioFinal, vigencia: vigencia || null, notas: notas || null,
    }).select("folio").single();
    setGuardando(false);
    if (error) return setError(error.message);
    if (leadId) {
      await db.from("actividades").insert({ lead_id: leadId, tipo: "sistema", texto: `Se le envió la cotización ${data.folio} por ${dinero(r.precioFinal)}.`, creado_por: auth.user?.id });
    }
    onCreada(data.folio);
  }

  const campo = (k: keyof typeof d, n: string, suf = "%") => (
    <div className="campo">
      <label htmlFor={`cot-${String(k)}`}>{n}</label>
      <div style={{ position: "relative" }}>
        <input id={`cot-${String(k)}`} className="entrada" type="number" step="any" value={d[k]} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
        {suf && <span style={{ position: "absolute", right: 10, top: 8, color: "var(--texto-3)" }}>{suf}</span>}
      </div>
    </div>
  );

  return (
    <Ventana titulo="Nueva cotización" onCerrar={onCerrar}>
      <div className="formulario">
        <div className="campo ancho">
          <label htmlFor="cot-unidad">Departamento *</label>
          <select id="cot-unidad" className="entrada" value={unidadId} onChange={(e) => setUnidadId(e.target.value)}>
            <option value="">Elige uno disponible…</option>
            {disponibles.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}
          </select>
        </div>
        <div className="campo ancho">
          <label htmlFor="cot-lead">Cliente</label>
          <select id="cot-lead" className="entrada" value={leadId} onChange={(e) => setLeadId(e.target.value)}>
            <option value="">Sin cliente (cotización general)</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
          </select>
        </div>
        {campo("descuento_pct", "Descuento")}
        <div className="campo"><label htmlFor="cot-vig">Vigencia</label><input id="cot-vig" className="entrada" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} /></div>
        {campo("enganche_pct", "Enganche")}
        {campo("mensualidades_pct", "En mensualidades")}
        {campo("num_mensualidades", "Número de mensualidades", "")}
        {campo("escrituracion_pct", "A la escrituración")}
      </div>

      {unidadId && (
        <div className="plan-pagos">
          <div><span>Precio de lista{unidad ? ` · ${unidad.torre}-${unidad.numero}` : ""}</span><span className="num">{dinero(precio)}</span></div>
          {datos.descuento_pct > 0 && <div><span>Descuento {datos.descuento_pct}%</span><span className="num" style={{ color: "var(--bien)" }}>−{dinero(r.ahorro)}</span></div>}
          <div><span>Enganche {datos.enganche_pct}%</span><span className="num">{dinero(r.enganche)}</span></div>
          <div><span>{r.n} mensualidades ({datos.mensualidades_pct}%)<small>Total {dinero(r.totalMensual)}</small></span><span className="num">{dinero(r.mensualidad)} / mes</span></div>
          <div><span>Escrituración {datos.escrituracion_pct}%</span><span className="num">{dinero(r.escrituracion)}</span></div>
          <div><span>Precio final</span><span className="num">{dinero(r.precioFinal)}</span></div>
        </div>
      )}
      {!r.sumaPctOk && <div className="aviso-caja">Enganche + mensualidades + escrituración suman {r.sumaPct}%. Ajusta para que den 100%.</div>}
      <div className="campo"><label htmlFor="cot-notas">Notas (opcional)</label><textarea id="cot-notas" className="entrada" value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
      {error && <div className="error-caja">{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
        <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Crear cotización"}</button>
      </div>
    </Ventana>
  );
}

function DetalleCotizacion({ c, estado, onCerrar, onCambio, avisar }: {
  c: Cotizacion; estado: string; onCerrar: () => void; onCambio: (estado: string) => void; avisar: (t: string) => void;
}) {
  const r = calcular(c);
  const u = c.unidades;
  const des = DESARROLLOS.find((x) => x.id === u?.desarrollo)?.nombre ?? u?.desarrollo ?? "";
  const m2 = u ? Number(u.m2_interior ?? 0) + Number(u.m2_terraza ?? 0) : 0;
  const texto = textoWhatsApp({ cliente: c.leads?.nombre, desarrollo: des, depto: u ? `${u.torre}-${u.numero}` : "", tipologia: u?.tipologia, m2: m2 || null, datos: c, vigencia: c.vigencia });

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); avisar("Copiado. Pégalo en el chat."); }
    catch { avisar("No se pudo copiar; selecciona el texto a mano."); }
  }

  return (
    <Ventana titulo={<span style={{ display: "flex", gap: 10, alignItems: "center" }}>{c.folio} <Pastilla tono={ESTADOS.find((x) => x.id === estado)?.tono}>{ESTADOS.find((x) => x.id === estado)?.nombre}</Pastilla></span>} onCerrar={onCerrar}>
      <div style={{ color: "var(--texto-2)" }}>
        <b style={{ color: "var(--texto)" }}>{c.leads?.nombre ?? "Sin cliente"}</b> · {des} · Depto. {u?.torre}-{u?.numero}{u?.tipologia ? ` · ${u.tipologia}` : ""}
      </div>
      <div className="plan-pagos">
        <div><span>Precio de lista</span><span className="num">{dinero(c.precio_lista)}</span></div>
        {c.descuento_pct > 0 && <div><span>Descuento {c.descuento_pct}%</span><span className="num" style={{ color: "var(--bien)" }}>−{dinero(r.ahorro)}</span></div>}
        <div><span>Enganche {c.enganche_pct}%</span><span className="num">{dinero(r.enganche)}</span></div>
        <div><span>{r.n} mensualidades ({c.mensualidades_pct}%)</span><span className="num">{dinero(r.mensualidad)} / mes</span></div>
        <div><span>Escrituración {c.escrituracion_pct}%</span><span className="num">{dinero(r.escrituracion)}</span></div>
        <div><span>Precio final</span><span className="num">{dinero(c.precio_final)}</span></div>
      </div>
      {c.vigencia && <small style={{ color: "var(--texto-3)" }}>Vigente hasta {fecha(c.vigencia)}</small>}
      <details>
        <summary style={{ cursor: "pointer", color: "var(--texto-2)" }}>Ver mensaje para WhatsApp</summary>
        <div className="codigo" style={{ whiteSpace: "pre-wrap", marginTop: 8, userSelect: "all" }}>{texto}</div>
      </details>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="boton" onClick={copiar}><Copy size={15} /> Copiar para WhatsApp</button>
        <a className="boton" href={`/imprimir/cotizacion/${c.id}`} target="_blank" rel="noopener"><Printer size={15} /> PDF / Imprimir</a>
        {estado === "vigente" && u?.estado === "disponible" && (
          <Link className="boton primario" href={`/separaciones?nuevo=1&unidad_id=${c.unidad_id}${c.lead_id ? "&lead_id=" + c.lead_id : ""}&cotizacion_id=${c.id}`}>Separar con esta cotización</Link>
        )}
        <div style={{ flex: 1 }} />
        {estado === "vigente" && <button className="boton peligro" onClick={() => onCambio("cancelada")}>Cancelar cotización</button>}
      </div>
    </Ventana>
  );
}
