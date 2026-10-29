"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Copy, FileText, Plus, Printer, Search } from "lucide-react";
import { Barra } from "@/components/Marco";
import { Pastilla, Ventana, useOpciones, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS } from "@/lib/tipos";
import { dinero, dineroExacto, fecha, hoyISO } from "@/lib/formato";
import { APARTADO, ESQUEMAS, FECHA_ESCRITURACION, calcular, mensualidadesHasta, nombreDepto, planDePagos, textoWhatsApp, type DatosCotizacion, type Pago } from "@/lib/cotizacion";

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
    return (lista ?? []).filter((c) => !t || `${c.folio} ${c.leads?.nombre ?? ""} ${nombreDepto(c.unidades)}`.toLowerCase().includes(t));
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
                      <td>{c.unidades ? <><b>{nombreDepto(c.unidades)}</b>{c.esquema ? <><br /><small style={{ color: "var(--texto-3)" }}>Esquema {c.esquema}</small></> : null}</> : "—"}</td>
                      <td className="der num">{dinero(c.precio_final)}{Number(c.precio_lista) > Number(c.precio_final) ? <><br /><small style={{ color: "var(--bien)" }}>−{dinero(Number(c.precio_lista) - Number(c.precio_final))}</small></> : null}</td>
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

/** Resumen + tabla con fechas: se usa al crear y al ver una cotización. */
function PlanVista({ datos, pagos, compacto }: { datos: DatosCotizacion; pagos: Pago[]; compacto?: boolean }) {
  const r = calcular(datos);
  const pe = pagos.filter((p) => p.concepto === "Enganche").length;
  const hayDescuento = r.ahorro > 0;
  return (
    <>
      <div className="barra-esquema" title={`${datos.enganche_pct}% enganche · ${datos.mensualidades_pct}% construcción · ${datos.escrituracion_pct}% escrituración`}>
        <span style={{ width: `${datos.enganche_pct}%` }} /><span style={{ width: `${datos.mensualidades_pct}%` }} /><span style={{ width: `${datos.escrituracion_pct}%` }} />
      </div>
      <div className="resumen-cot">
        <div><small>Precio de lista</small><b className={hayDescuento ? "tachado" : ""}>{dinero(datos.precio_lista)}</b>{hayDescuento && <small style={{ color: "var(--bien)" }}>Ahorras {dinero(r.ahorro)}</small>}</div>
        <div><small>Enganche {datos.enganche_pct}%</small><b>{dinero(r.enganche)}</b><small>{pe > 1 ? `en ${pe} pagos` : "un pago"}</small></div>
        <div><small>Construcción {datos.mensualidades_pct}%</small><b>{dinero(r.mensualidad)}</b><small>{r.n} mensualidades</small></div>
        <div><small>Escrituración {datos.escrituracion_pct}%</small><b>{dinero(r.escrituracion)}</b><small>{datos.fecha_escrituracion ? fecha(datos.fecha_escrituracion) : "a la entrega"}</small></div>
      </div>
      <div className="resumen-cot" style={{ gridTemplateColumns: "1fr" }}>
        <div className="destacado" style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <small style={{ fontSize: 13 }}>Precio final{hayDescuento ? " con descuento" : ""}</small><b style={{ fontSize: 20 }}>{dinero(r.precioFinal)}</b>
        </div>
      </div>
      {!compacto && (
        <div className="tabla-plan">
          <table>
            <thead><tr><th>#</th><th>Concepto</th><th>Fecha</th><th className="der">Importe</th></tr></thead>
            <tbody>
              {pagos.map((p) => (
                <tr key={p.num} className={p.concepto === "Enganche" ? "eng" : p.concepto === "Escrituración" ? "esc" : ""}>
                  <td>{p.num}</td><td>{p.concepto}</td><td>{p.fecha ? fecha(p.fecha) : "—"}</td><td className="der">{dineroExacto(p.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NuevaCotizacion({ inicial, onCerrar, onCreada }: { inicial: Record<string, string>; onCerrar: () => void; onCreada: (folio: string) => void }) {
  const db = supabaseNavegador();
  const unidades = useOpciones("unidades");
  const leads = useOpciones("leads");
  const [unidadId, setUnidadId] = useState(inicial.unidad_id ?? "");
  const [leadId, setLeadId] = useState(inicial.lead_id ?? "");
  const [esquema, setEsquema] = useState<string>(ESQUEMAS[0].id);
  const [pct, setPct] = useState({ enganche: "10", construccion: "15", escrituracion: "75" });
  const [descPct, setDescPct] = useState("0");
  const [descMonto, setDescMonto] = useState("0");
  const [pagosEng, setPagosEng] = useState("1");
  const [primerPago, setPrimerPago] = useState(hoyISO());
  const [escritura, setEscritura] = useState(FECHA_ESCRITURACION);
  const [nManual, setNManual] = useState<string | null>(null);
  const [vigencia, setVigencia] = useState(enDias(7));
  const [notas, setNotas] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const unidad = unidades.find((u) => u.id === unidadId)?.fila as any;
  const precio = Number(unidad?.precio_lista ?? 0);
  const pe = Math.max(1, Math.min(12, Number(pagosEng) || 1));
  const nAuto = primerPago && escritura ? mensualidadesHasta(primerPago, escritura, pe) : 12;
  const n = nManual != null && Number(nManual) > 0 ? Math.round(Number(nManual)) : nAuto;

  function elegirEsquema(id: string) {
    setEsquema(id);
    const e = ESQUEMAS.find((x) => x.id === id);
    if (e) setPct({ enganche: String(e.enganche), construccion: String(e.construccion), escrituracion: String(e.escrituracion) });
  }

  const datos: DatosCotizacion = {
    precio_lista: precio, descuento_pct: Number(descPct) || 0, descuento_monto: Number(descMonto) || 0,
    enganche_pct: Number(pct.enganche) || 0, mensualidades_pct: Number(pct.construccion) || 0, escrituracion_pct: Number(pct.escrituracion) || 0,
    num_mensualidades: n, num_pagos_enganche: pe, fecha_primer_pago: primerPago || null, fecha_escrituracion: escritura || null,
    apartado: APARTADO, esquema: esquema === "personalizado" ? `${pct.enganche}-${pct.construccion}-${pct.escrituracion}` : esquema,
  };
  const r = calcular(datos);
  const pagos = planDePagos(datos);
  const disponibles = unidades.filter((u) => u.fila?.estado === "disponible" || u.id === unidadId);

  async function guardar() {
    if (!unidadId) return setError("Elige un departamento.");
    if (!precio) return setError("Ese departamento no tiene precio de lista; agrégalo en Inventario.");
    if (!r.sumaPctOk) return setError(`Los porcentajes suman ${r.sumaPct}%; deben sumar 100%.`);
    setGuardando(true);
    const { data: auth } = await db.auth.getUser();
    const { data, error } = await db.from("cotizaciones").insert({
      unidad_id: unidadId, lead_id: leadId || null, asesor_id: auth.user?.id ?? null,
      ...datos, precio_final: r.precioFinal, vigencia: vigencia || null, notas: notas || null,
    }).select("folio").single();
    setGuardando(false);
    if (error) {
      return setError(/column|esquema|descuento_monto|fecha_primer_pago/i.test(error.message)
        ? "Falta actualizar la base de datos: corre en Supabase la parte final de supabase/schema.sql (columnas nuevas de cotizaciones)."
        : error.message);
    }
    if (leadId) {
      await db.from("actividades").insert({ lead_id: leadId, tipo: "sistema", texto: `Se le envió la cotización ${data.folio} (${nombreDepto(unidad)}, esquema ${datos.esquema}) por ${dinero(r.precioFinal)}.`, creado_por: auth.user?.id });
    }
    onCreada(data.folio);
  }

  const num = (id: string, label: string, valor: string, set: (v: string) => void, suf?: string, extra?: React.ReactNode) => (
    <div className="campo">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: "relative" }}>
        <input id={id} className="entrada" type="number" step="any" min="0" value={valor} onChange={(e) => set(e.target.value)} />
        {suf && <span style={{ position: "absolute", right: 10, top: 8, color: "var(--texto-3)" }}>{suf}</span>}
      </div>
      {extra}
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
      </div>

      <div className="campo">
        <label>Esquema de pago</label>
        <div className="esquemas">
          {ESQUEMAS.map((e) => (
            <button type="button" key={e.id} className={`esquema-op ${esquema === e.id ? "activo" : ""}`} onClick={() => elegirEsquema(e.id)}>
              <b>{e.id}</b><small>{e.enganche}% enganche · {e.construccion}% construcción · {e.escrituracion}% escrituración</small>
            </button>
          ))}
          <button type="button" className={`esquema-op ${esquema === "personalizado" ? "activo" : ""}`} onClick={() => setEsquema("personalizado")}>
            <b>Personalizado</b><small>Tú pones los porcentajes</small>
          </button>
        </div>
      </div>

      <div className="formulario">
        {esquema === "personalizado" && <>
          {num("cot-eng", "Enganche", pct.enganche, (v) => setPct({ ...pct, enganche: v }), "%")}
          {num("cot-cons", "Construcción (mensualidades)", pct.construccion, (v) => setPct({ ...pct, construccion: v }), "%")}
          {num("cot-esc", "Escrituración", pct.escrituracion, (v) => setPct({ ...pct, escrituracion: v }), "%")}
          <div />
        </>}
        {num("cot-dpct", "Descuento en %", descPct, setDescPct, "%")}
        {num("cot-dmonto", "Descuento en pesos", descMonto, setDescMonto, "$")}
        {num("cot-pe", "Pagos de enganche", pagosEng, (v) => { setPagosEng(v); setNManual(null); }, "", <small style={{ color: "var(--texto-3)" }}>1 = enganche en una sola exhibición</small>)}
        {num("cot-n", "Mensualidades de construcción", String(n), (v) => setNManual(v), "",
          <small style={{ color: "var(--texto-3)" }}>{nManual != null && Number(nManual) !== nAuto ? <>Cambiado a mano · <button type="button" className="enlace" onClick={() => setNManual(null)}>volver a {nAuto}</button></> : "Se calculan solas hasta la escrituración"}</small>)}
        <div className="campo"><label htmlFor="cot-f1">Primer pago</label><input id="cot-f1" className="entrada" type="date" value={primerPago} onChange={(e) => { setPrimerPago(e.target.value); setNManual(null); }} /></div>
        <div className="campo"><label htmlFor="cot-fe">Escrituración</label><input id="cot-fe" className="entrada" type="date" value={escritura} onChange={(e) => { setEscritura(e.target.value); setNManual(null); }} /></div>
        <div className="campo"><label htmlFor="cot-vig">Precio vigente hasta</label><input id="cot-vig" className="entrada" type="date" value={vigencia} onChange={(e) => setVigencia(e.target.value)} /></div>
      </div>

      {unidadId && precio > 0 && <PlanVista datos={datos} pagos={pagos} />}
      {!r.sumaPctOk && <div className="aviso-caja">Enganche + construcción + escrituración suman {r.sumaPct}%. Ajusta para que den 100%.</div>}
      <div className="campo"><label htmlFor="cot-notas">Notas (opcional, salen en el PDF)</label><textarea id="cot-notas" className="entrada" value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
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
  const u = c.unidades;
  const des = DESARROLLOS.find((x) => x.id === u?.desarrollo)?.nombre ?? u?.desarrollo ?? "";
  const m2 = u ? Number(u.m2_interior ?? 0) + Number(u.m2_terraza ?? 0) : 0;
  const pagos = planDePagos(c, c.created_at.slice(0, 10));
  const texto = textoWhatsApp({ cliente: c.leads?.nombre, desarrollo: des, depto: nombreDepto(u), tipologia: u?.tipologia, m2: m2 || null, datos: c, vigencia: c.vigencia });

  async function copiar() {
    try { await navigator.clipboard.writeText(texto); avisar("Copiado. Pégalo en el chat."); }
    catch { avisar("No se pudo copiar; selecciona el texto a mano."); }
  }

  return (
    <Ventana titulo={<span style={{ display: "flex", gap: 10, alignItems: "center" }}>{c.folio} <Pastilla tono={ESTADOS.find((x) => x.id === estado)?.tono}>{ESTADOS.find((x) => x.id === estado)?.nombre}</Pastilla></span>} onCerrar={onCerrar}>
      <div style={{ color: "var(--texto-2)" }}>
        <b style={{ color: "var(--texto)" }}>{c.leads?.nombre ?? "Sin cliente"}</b> · {des} · Depto. {nombreDepto(u)}{u?.tipologia ? ` · Tipo ${u.tipologia}` : ""}{m2 ? ` · ${m2} m²` : ""}
        {c.esquema && <> · Esquema <b>{c.esquema}</b></>}
      </div>
      <PlanVista datos={c} pagos={pagos} />
      {c.vigencia && <small style={{ color: "var(--texto-3)" }}>Precio vigente hasta {fecha(c.vigencia)}</small>}
      <details>
        <summary style={{ cursor: "pointer", color: "var(--texto-2)" }}>Ver mensaje para WhatsApp</summary>
        <div className="codigo" style={{ whiteSpace: "pre-wrap", marginTop: 8, userSelect: "all" }}>{texto}</div>
      </details>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <a className="boton primario" href={`/imprimir/cotizacion/${c.id}`} target="_blank" rel="noopener"><Printer size={15} /> Ver PDF</a>
        <button className="boton" onClick={copiar}><Copy size={15} /> Copiar para WhatsApp</button>
        {estado === "vigente" && u?.estado === "disponible" && (
          <Link className="boton" href={`/separaciones?nuevo=1&unidad_id=${c.unidad_id}${c.lead_id ? "&lead_id=" + c.lead_id : ""}&cotizacion_id=${c.id}`}>Separar con esta cotización</Link>
        )}
        <div style={{ flex: 1 }} />
        {estado === "vigente" && <button className="boton peligro" onClick={() => onCambio("cancelada")}>Cancelar cotización</button>}
      </div>
    </Ventana>
  );
}
