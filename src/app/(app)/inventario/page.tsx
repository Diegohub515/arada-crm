"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Building2, FileText, Lock, LockOpen, Plus, Table2, Upload } from "lucide-react";
import { Barra } from "@/components/Marco";
import { Pastilla, Ventana, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS } from "@/lib/tipos";
import { dinero, dineroCorto, fecha } from "@/lib/formato";

type Unidad = {
  id: string; desarrollo: string; torre: string; nivel: number; numero: string; tipologia: string | null;
  recamaras: number | null; banos: number | null; m2_interior: number | null; m2_terraza: number | null;
  cajones: number | null; vista: string | null; precio_lista: number; estado: string; notas: string | null;
};

const ESTADOS_UNIDAD = [
  { id: "disponible", nombre: "Disponible", tono: "bien" },
  { id: "separada", nombre: "Separada", tono: "aviso" },
  { id: "vendida", nombre: "Vendida", tono: "acento" },
  { id: "bloqueada", nombre: "Bloqueada", tono: "neutro" },
];
const tono = (e: string) => ESTADOS_UNIDAD.find((x) => x.id === e)?.tono ?? "neutro";
const nombreEstado = (e: string) => ESTADOS_UNIDAD.find((x) => x.id === e)?.nombre ?? e;

const CAMPOS: { k: keyof Unidad; n: string; tipo?: "number" }[] = [
  { k: "torre", n: "Torre" }, { k: "nivel", n: "Nivel", tipo: "number" }, { k: "numero", n: "Número" },
  { k: "tipologia", n: "Tipología" }, { k: "recamaras", n: "Recámaras", tipo: "number" }, { k: "banos", n: "Baños", tipo: "number" },
  { k: "m2_interior", n: "m² interiores", tipo: "number" }, { k: "m2_terraza", n: "m² terraza", tipo: "number" },
  { k: "cajones", n: "Cajones", tipo: "number" }, { k: "vista", n: "Vista" }, { k: "precio_lista", n: "Precio de lista (MXN)", tipo: "number" },
];

export default function Inventario() {
  const db = supabaseNavegador();
  const [unidades, setUnidades] = useState<Unidad[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [desarrollo, setDesarrollo] = useState("VRO");
  const [torre, setTorre] = useState("todas");
  const [vista, setVista] = useState<"torre" | "tabla">("torre");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [abierta, setAbierta] = useState<Unidad | null>(null);
  const [editando, setEditando] = useState<Partial<Unidad> | null>(null);
  const [importar, setImportar] = useState(false);
  const [toast, avisar] = useToast();

  const cargar = useCallback(async () => {
    const { data, error } = await db.from("unidades").select("*").order("nivel", { ascending: false }).order("numero");
    if (error) setError(error.message);
    else setUnidades(data as Unidad[]);
  }, [db]);
  useEffect(() => {
    cargar();
    const canal = db.channel("inventario").on("postgres_changes", { event: "*", schema: "public", table: "unidades" }, cargar).subscribe();
    return () => { db.removeChannel(canal); };
  }, [db, cargar]);

  const delDesarrollo = useMemo(() => (unidades ?? []).filter((u) => u.desarrollo === desarrollo), [unidades, desarrollo]);
  const torres = useMemo(() => Array.from(new Set(delDesarrollo.map((u) => u.torre))).sort(), [delDesarrollo]);
  const visibles = delDesarrollo.filter((u) => (torre === "todas" || u.torre === torre) && (filtroEstado === "todos" || u.estado === filtroEstado));

  const cuenta = (e: string) => delDesarrollo.filter((u) => u.estado === e).length;
  const total = delDesarrollo.length;
  const valorDisp = delDesarrollo.filter((u) => u.estado === "disponible").reduce((s, u) => s + Number(u.precio_lista), 0);
  const vendidoPct = total ? Math.round(((cuenta("vendida") + cuenta("separada")) / total) * 100) : 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const datos: Record<string, unknown> = { desarrollo: editando.desarrollo ?? desarrollo, notas: editando.notas ?? null };
    for (const c of CAMPOS) {
      const v = (editando as any)[c.k];
      datos[c.k] = v === "" || v == null ? null : c.tipo === "number" ? Number(v) : v;
    }
    if (datos.precio_lista == null) datos.precio_lista = 0;
    const { error } = editando.id
      ? await db.from("unidades").update(datos).eq("id", editando.id)
      : await db.from("unidades").insert(datos);
    if (error) return avisar(error.code === "23505" ? "Ya existe un departamento con esa torre y número." : error.message);
    setEditando(null);
    avisar(editando.id ? "Departamento actualizado" : "Departamento agregado");
    cargar();
  }

  async function bloquear(u: Unidad) {
    const nuevo = u.estado === "bloqueada" ? "disponible" : "bloqueada";
    const { error } = await db.from("unidades").update({ estado: nuevo }).eq("id", u.id);
    if (error) return avisar(error.message);
    setAbierta({ ...u, estado: nuevo });
    cargar();
  }

  // Tablero: filas por nivel, de arriba hacia abajo
  const niveles = useMemo(() => {
    const mapa = new Map<string, Unidad[]>();
    for (const u of visibles) {
      const k = `${u.torre}|${u.nivel}`;
      mapa.set(k, [...(mapa.get(k) ?? []), u]);
    }
    return Array.from(mapa.entries())
      .map(([k, us]) => ({ torre: k.split("|")[0], nivel: Number(k.split("|")[1]), us: us.sort((a, b) => a.numero.localeCompare(b.numero, "es", { numeric: true })) }))
      .sort((a, b) => a.torre.localeCompare(b.torre) || b.nivel - a.nivel);
  }, [visibles]);

  return (
    <>
      <Barra titulo="Inventario" icono={<Building2 size={18} />}>
        <button className="boton" onClick={() => setImportar(true)}><Upload size={15} /> Importar</button>
        <button className="boton primario" onClick={() => setEditando({ desarrollo, torre: torres[0] ?? "A", cajones: 1 })}><Plus size={16} /> Agregar</button>
      </Barra>
      <div className="contenido">
        {error && <div className="error-caja">No pude leer el inventario: {error}. ¿Ya corriste la parte de comercialización de supabase/schema.sql?</div>}

        <div className="herramientas">
          <div className="segmentos">
            {DESARROLLOS.map((d) => <button key={d.id} className={desarrollo === d.id ? "activo" : ""} onClick={() => { setDesarrollo(d.id); setTorre("todas"); }}>{d.nombre}</button>)}
          </div>
          {torres.length > 1 && (
            <select id="f-torre" className="entrada" style={{ width: "auto" }} value={torre} onChange={(e) => setTorre(e.target.value)}>
              <option value="todas">Todas las torres</option>
              {torres.map((t) => <option key={t} value={t}>Torre {t}</option>)}
            </select>
          )}
          <div className="espacio" />
          <div className="segmentos">
            <button className={vista === "torre" ? "activo" : ""} onClick={() => setVista("torre")}><Building2 size={13} /> Torre</button>
            <button className={vista === "tabla" ? "activo" : ""} onClick={() => setVista("tabla")}><Table2 size={13} /> Tabla</button>
          </div>
        </div>

        <div className="rejilla rejilla-4">
          {ESTADOS_UNIDAD.slice(0, 3).map((e) => (
            <button key={e.id} className={`tarjeta kpi filtro-kpi ${filtroEstado === e.id ? "activo" : ""}`} onClick={() => setFiltroEstado(filtroEstado === e.id ? "todos" : e.id)}>
              <div className="kpi-titulo"><span className={`punto ${e.tono}`} />{e.nombre}s</div>
              <div className="kpi-fila"><span className="kpi-valor">{cuenta(e.id)}</span><span className="kpi-nota">de {total}</span></div>
            </button>
          ))}
          <div className="tarjeta kpi">
            <div className="kpi-titulo">Avance comercial</div>
            <div className="kpi-fila"><span className="kpi-valor">{vendidoPct}%</span><span className="kpi-nota">{dineroCorto(valorDisp)} por vender</span></div>
            <div className="pista"><div className="relleno" style={{ width: `${vendidoPct}%` }} /></div>
          </div>
        </div>

        {unidades && delDesarrollo.length === 0 && (
          <div className="tarjeta"><div className="vacio">
            <b>Aún no hay departamentos en {DESARROLLOS.find((d) => d.id === desarrollo)?.nombre}</b>
            Agrégalos uno por uno o pega tu lista de precios con “Importar”.
            <button className="boton primario" onClick={() => setImportar(true)}><Upload size={15} /> Importar lista</button>
          </div></div>
        )}

        {vista === "torre" && niveles.length > 0 && (
          <div className="tarjeta">
            <div className="tarjeta-cuerpo torre-caja">
              <div className="torre">
                {niveles.map((n) => (
                  <div className="torre-nivel" key={`${n.torre}-${n.nivel}`}>
                    <div className="torre-etiqueta">{torres.length > 1 ? `${n.torre} · ` : ""}N{n.nivel}</div>
                    <div className="torre-unidades">
                      {n.us.map((u) => (
                        <button key={u.id} className={`depa ${u.estado}`} onClick={() => setAbierta(u)} title={`${u.numero} · ${nombreEstado(u.estado)}`}>
                          <b>{u.numero}</b>
                          <small>{u.tipologia ?? (u.recamaras ? `${u.recamaras} rec` : "")}</small>
                          <small className="num">{u.estado === "vendida" ? "Vendido" : dineroCorto(u.precio_lista)}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="leyenda">
                {ESTADOS_UNIDAD.map((e) => <span key={e.id}><span className={`punto ${e.tono}`} /> {e.nombre}</span>)}
              </div>
            </div>
          </div>
        )}

        {vista === "tabla" && visibles.length > 0 && (
          <div className="tarjeta"><div className="tabla-caja">
            <table className="tabla">
              <thead><tr><th>Depto.</th><th>Nivel</th><th>Tipología</th><th className="der">m²</th><th className="der">Precio</th><th className="der">$ / m²</th><th>Estado</th></tr></thead>
              <tbody>
                {visibles.map((u) => {
                  const m2 = Number(u.m2_interior ?? 0) + Number(u.m2_terraza ?? 0);
                  return (
                    <tr key={u.id} onClick={() => setAbierta(u)}>
                      <td><b>{u.torre}-{u.numero}</b></td><td>{u.nivel}</td><td>{u.tipologia ?? "—"}</td>
                      <td className="der num">{m2 || "—"}</td><td className="der num">{dinero(u.precio_lista)}</td>
                      <td className="der num">{m2 ? dinero(u.precio_lista / m2) : "—"}</td>
                      <td><Pastilla tono={tono(u.estado)}>{nombreEstado(u.estado)}</Pastilla></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div></div>
        )}
      </div>

      {abierta && <FichaUnidad u={abierta} onCerrar={() => setAbierta(null)} onEditar={() => { setEditando(abierta); setAbierta(null); }} onBloquear={() => bloquear(abierta)} />}

      {editando && (
        <Ventana titulo={editando.id ? `Editar ${editando.torre}-${editando.numero}` : "Nuevo departamento"} onCerrar={() => setEditando(null)}>
          <form id="form-unidad" className="formulario" onSubmit={guardar}>
            <div className="campo">
              <label htmlFor="u-des">Desarrollo</label>
              <select id="u-des" className="entrada" value={editando.desarrollo ?? desarrollo} onChange={(e) => setEditando({ ...editando, desarrollo: e.target.value })}>
                {DESARROLLOS.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </div>
            {CAMPOS.map((c) => (
              <div className="campo" key={c.k}>
                <label htmlFor={`u-${c.k}`}>{c.n}{["torre", "nivel", "numero"].includes(c.k) ? " *" : ""}</label>
                <input id={`u-${c.k}`} className="entrada" type={c.tipo ?? "text"} step="any" required={["torre", "nivel", "numero"].includes(c.k)}
                  value={(editando as any)[c.k] ?? ""} onChange={(e) => setEditando({ ...editando, [c.k]: e.target.value })} />
              </div>
            ))}
            <div className="campo ancho">
              <label htmlFor="u-notas">Notas</label>
              <textarea id="u-notas" className="entrada" value={editando.notas ?? ""} onChange={(e) => setEditando({ ...editando, notas: e.target.value })} />
            </div>
          </form>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="boton" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="boton primario" form="form-unidad">Guardar</button>
          </div>
        </Ventana>
      )}

      {importar && <Importador desarrollo={desarrollo} onCerrar={() => setImportar(false)} onListo={(n) => { setImportar(false); avisar(`${n} departamentos importados`); cargar(); }} />}
      {toast}
    </>
  );
}

function FichaUnidad({ u, onCerrar, onEditar, onBloquear }: { u: Unidad; onCerrar: () => void; onEditar: () => void; onBloquear: () => void }) {
  const db = supabaseNavegador();
  const [historia, setHistoria] = useState<{ tipo: string; texto: string; fecha: string; href: string }[]>([]);

  useEffect(() => {
    Promise.all([
      db.from("cotizaciones").select("id, folio, precio_final, estado, created_at, leads(nombre)").eq("unidad_id", u.id),
      db.from("separaciones").select("id, monto, estado, fecha, leads(nombre)").eq("unidad_id", u.id),
      db.from("ventas").select("id, precio_final, estado, fecha_contrato, leads(nombre)").eq("unidad_id", u.id),
    ]).then(([c, s, v]) => {
      const h = [
        ...((c.data ?? []) as any[]).map((x) => ({ tipo: "Cotización", texto: `${x.folio} · ${x.leads?.nombre ?? "sin cliente"} · ${dinero(x.precio_final)} (${x.estado})`, fecha: x.created_at, href: "/cotizaciones" })),
        ...((s.data ?? []) as any[]).map((x) => ({ tipo: "Separación", texto: `${x.leads?.nombre ?? "sin cliente"} · ${dinero(x.monto)} (${x.estado})`, fecha: x.fecha, href: "/separaciones" })),
        ...((v.data ?? []) as any[]).map((x) => ({ tipo: "Venta", texto: `${x.leads?.nombre ?? "sin cliente"} · ${dinero(x.precio_final)} (${x.estado})`, fecha: x.fecha_contrato, href: "/ventas" })),
      ].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
      setHistoria(h);
    });
  }, [db, u.id]);

  const m2 = Number(u.m2_interior ?? 0) + Number(u.m2_terraza ?? 0);
  const libre = u.estado === "disponible";
  return (
    <Ventana lado onCerrar={onCerrar} titulo={<span style={{ display: "flex", gap: 10, alignItems: "center" }}>Depto. {u.torre}-{u.numero} <Pastilla tono={tono(u.estado)}>{nombreEstado(u.estado)}</Pastilla></span>}>
      <div className="kpi-valor">{dinero(u.precio_lista)}</div>
      <div className="datos-depa">
        <div><small>Nivel</small><b>{u.nivel}</b></div>
        <div><small>Tipología</small><b>{u.tipologia ?? "—"}</b></div>
        <div><small>Recámaras</small><b>{u.recamaras ?? "—"}</b></div>
        <div><small>Baños</small><b>{u.banos ?? "—"}</b></div>
        <div><small>m² interiores</small><b>{u.m2_interior ?? "—"}</b></div>
        <div><small>m² terraza</small><b>{u.m2_terraza ?? "—"}</b></div>
        <div><small>Cajones</small><b>{u.cajones ?? "—"}</b></div>
        <div><small>Precio por m²</small><b>{m2 ? dinero(u.precio_lista / m2) : "—"}</b></div>
        {u.vista && <div><small>Vista</small><b>{u.vista}</b></div>}
      </div>
      {u.notas && <p style={{ margin: 0, color: "var(--texto-2)", whiteSpace: "pre-wrap" }}>{u.notas}</p>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="boton primario" href={`/cotizaciones?nuevo=1&unidad_id=${u.id}`}><FileText size={15} /> Cotizar</Link>
        {libre && <Link className="boton" href={`/separaciones?nuevo=1&unidad_id=${u.id}`}>Separar</Link>}
        {(libre || u.estado === "bloqueada") && (
          <button className="boton" onClick={onBloquear}>{u.estado === "bloqueada" ? <><LockOpen size={15} /> Liberar</> : <><Lock size={15} /> Bloquear</>}</button>
        )}
        <button className="boton" onClick={onEditar}>Editar</button>
      </div>
      <div className="tarjeta" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <b>Historial del departamento</b>
        <div className="linea-tiempo">
          {historia.map((h, i) => (
            <Link key={i} href={h.href} className="evento"><div><p><b>{h.tipo}:</b> {h.texto}</p><small>{fecha(h.fecha)}</small></div></Link>
          ))}
          {historia.length === 0 && <small style={{ color: "var(--texto-3)" }}>Sin cotizaciones, separaciones ni ventas todavía.</small>}
        </div>
      </div>
    </Ventana>
  );
}

/** Pega la lista de precios desde Excel o Google Sheets (con encabezados) y la sube de golpe. */
function Importador({ desarrollo, onCerrar, onListo }: { desarrollo: string; onCerrar: () => void; onListo: (n: number) => void }) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);

  const filas = useMemo(() => {
    const lineas = texto.trim().split(/\r?\n/).filter((l) => l.trim());
    if (lineas.length < 2) return [];
    const sep = lineas[0].includes("\t") ? "\t" : lineas[0].includes(";") ? ";" : ",";
    const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");
    const cab = lineas[0].split(sep).map(normal);
    const col = (...nombres: string[]) => cab.findIndex((c) => nombres.some((n) => c === n || c.startsWith(n)));
    const idx = {
      torre: col("torre", "edificio"), nivel: col("nivel", "piso"), numero: col("numero", "depto", "departamento", "unidad", "no"),
      tipologia: col("tipologia", "tipo", "modelo"), recamaras: col("recamaras", "rec"), banos: col("banos"),
      m2_interior: col("m2interior", "m2", "metros", "superficie"), m2_terraza: col("m2terraza", "terraza"),
      cajones: col("cajones", "estacionamiento"), vista: col("vista"), precio_lista: col("precio", "preciolista", "valor"),
    };
    const num = (v?: string) => {
      if (v == null || v.trim() === "") return null;
      const n = Number(v.replace(/[$,\s]/g, ""));
      return Number.isFinite(n) ? n : null;
    };
    return lineas.slice(1).map((l) => {
      const c = l.split(sep).map((x) => x.trim());
      const get = (i: number) => (i >= 0 ? c[i] : undefined);
      return {
        desarrollo,
        torre: get(idx.torre) || "A",
        nivel: num(get(idx.nivel)) ?? 0,
        numero: get(idx.numero) ?? "",
        tipologia: get(idx.tipologia) || null,
        recamaras: num(get(idx.recamaras)),
        banos: num(get(idx.banos)),
        m2_interior: num(get(idx.m2_interior)),
        m2_terraza: num(get(idx.m2_terraza)),
        cajones: num(get(idx.cajones)),
        vista: get(idx.vista) || null,
        precio_lista: num(get(idx.precio_lista)) ?? 0,
      };
    }).filter((f) => f.numero);
  }, [texto, desarrollo]);

  async function subir() {
    setSubiendo(true);
    setError(null);
    const { error } = await supabaseNavegador().from("unidades").upsert(filas, { onConflict: "desarrollo,torre,numero" });
    setSubiendo(false);
    if (error) return setError(error.message);
    onListo(filas.length);
  }

  return (
    <Ventana titulo={`Importar departamentos · ${DESARROLLOS.find((d) => d.id === desarrollo)?.nombre}`} onCerrar={onCerrar}>
      <p style={{ margin: 0, color: "var(--texto-2)" }}>
        Copia tu lista de precios desde Excel o Google Sheets, incluyendo la fila de encabezados, y pégala aquí.
        Columnas que entiende: Torre, Nivel, Número, Tipología, Recámaras, Baños, m2 interior, m2 terraza, Cajones, Vista, Precio.
        Si un departamento ya existe, se actualiza su información (el estado no cambia).
      </p>
      <textarea id="importar" className="entrada" style={{ minHeight: 180, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}
        placeholder={"Torre\tNivel\tNúmero\tTipología\tRecámaras\tm2\tPrecio\nA\t1\t101\tA\t2\t78\t3450000"}
        value={texto} onChange={(e) => setTexto(e.target.value)} />
      {filas.length > 0 && (
        <small style={{ color: "var(--texto-2)" }}>
          Se van a cargar <b>{filas.length}</b> departamentos. Ejemplo: {filas[0].torre}-{filas[0].numero}, nivel {filas[0].nivel}, {dinero(filas[0].precio_lista)}.
        </small>
      )}
      {error && <div className="error-caja">{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
        <button className="boton primario" disabled={!filas.length || subiendo} onClick={subir}>{subiendo ? "Importando…" : `Importar ${filas.length || ""}`}</button>
      </div>
    </Ventana>
  );
}
