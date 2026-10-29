"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, FileText, MessageCircle, Paperclip, Sparkles, Trash2, Upload } from "lucide-react";
import { Barra } from "@/components/Marco";
import { PastillaEtapa } from "@/components/leads";
import { SelectorLista } from "@/components/listas";
import { Pastilla, abrirArchivo, subirArchivo, useOpciones, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { SECCIONES_LEAD, type CampoLead } from "@/lib/campos-lead";
import { DESARROLLOS, ETAPAS, ORIGENES, nombreEtapa } from "@/lib/tipos";
import { dinero, fecha, normalizarTelefono, relativo } from "@/lib/formato";

type Fila = Record<string, any>;
const PASOS = [
  { id: "lead", n: "Nuevo lead" }, { id: "cotizacion", n: "Cotización" },
  { id: "separacion", n: "Separación" }, { id: "vendido", n: "Vendido" },
];
const PESTANAS = ["Comentarios", "Tareas", "Adjuntos", "Historial", "Eventos"] as const;

export default function FichaCompleta() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const db = supabaseNavegador();
  const [lead, setLead] = useState<Fila | null>(null);
  const [cambios, setCambios] = useState<Fila>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [paso, setPaso] = useState("lead");
  const [rel, setRel] = useState<{ cot: Fila[]; sep: Fila[]; ven: Fila[]; conv: Fila | null }>({ cot: [], sep: [], ven: [], conv: null });
  const [toast, avisar] = useToast();
  const asesores = useOpciones("perfiles");
  const brokers = useOpciones("brokers");

  const cargar = useCallback(async () => {
    const [{ data: l, error }, c, s, v, conv] = await Promise.all([
      db.from("leads").select("*").eq("id", id).single(),
      db.from("cotizaciones").select("*, unidades(desarrollo, torre, numero)").eq("lead_id", id).order("created_at", { ascending: false }),
      db.from("separaciones").select("*, unidades(desarrollo, torre, numero)").eq("lead_id", id).order("fecha", { ascending: false }),
      db.from("ventas").select("*, unidades(desarrollo, torre, numero)").eq("lead_id", id).order("fecha_contrato", { ascending: false }),
      db.from("conversaciones").select("id, plataforma").eq("lead_id", id).limit(1).maybeSingle(),
    ]);
    if (error) { setError(error.message); return; }
    setLead(l);
    setRel({ cot: c.data ?? [], sep: s.data ?? [], ven: v.data ?? [], conv: conv.data });
  }, [db, id]);
  useEffect(() => { cargar(); }, [cargar]);

  // Paso actual según lo que ya existe
  const pasoActual = rel.ven.some((x) => x.estado !== "cancelada") ? "vendido"
    : rel.sep.some((x) => x.estado === "activa") ? "separacion"
    : rel.cot.length ? "cotizacion" : "lead";
  const idxActual = PASOS.findIndex((p) => p.id === pasoActual);

  const valor = (k: string) => (k in cambios ? cambios[k] : lead?.[k]);
  const poner = (k: string, v: unknown) => setCambios((c) => ({ ...c, [k]: v === "" ? null : v }));
  const hayCambios = Object.keys(cambios).length > 0;

  async function guardar() {
    if (!lead || !hayCambios) return;
    setGuardando(true);
    const datos = { ...cambios };
    if ("telefono" in datos) datos.telefono = normalizarTelefono(datos.telefono);
    if ("presupuesto" in datos && datos.presupuesto != null) datos.presupuesto = Number(datos.presupuesto);
    delete datos.created_at;
    const { error } = await db.from("leads").update(datos).eq("id", lead.id);
    setGuardando(false);
    if (error) return avisar(`No se guardó: ${error.message}`);
    if ("etapa" in datos && datos.etapa !== lead.etapa) {
      const { data: auth } = await db.auth.getUser();
      await db.from("actividades").insert({ lead_id: lead.id, tipo: "cambio_etapa", creado_por: auth.user?.id, texto: `Etapa: ${nombreEtapa(lead.etapa)} → ${nombreEtapa(datos.etapa)}` });
    }
    setLead({ ...lead, ...datos });
    setCambios({});
    avisar("Cambios guardados");
  }

  function control(c: CampoLead) {
    const idc = `lf-${c.k}`;
    const v = valor(c.k);
    switch (c.tipo) {
      case "lista": return <SelectorLista id={idc} campo={c.k} valor={v ?? null} onCambio={(x) => poner(c.k, x)} />;
      case "notas": return <textarea id={idc} className="entrada" style={{ minHeight: 110 }} value={v ?? ""} onChange={(e) => poner(c.k, e.target.value)} />;
      case "fecha": return <input id={idc} className="entrada" type="date" disabled={c.k === "created_at"} value={v ? String(v).slice(0, 10) : ""} onChange={(e) => poner(c.k, e.target.value)} />;
      case "numero": return <input id={idc} className="entrada" type="number" step="any" value={v ?? ""} onChange={(e) => poner(c.k, e.target.value)} />;
      case "asesor": return <select id={idc} className="entrada" value={v ?? ""} onChange={(e) => poner(c.k, e.target.value)}><option value="">Sin asignar</option>{asesores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      case "broker": return (
        <div className="lista-nueva">
          <select id={idc} className="entrada" value={v ?? ""} onChange={(e) => poner(c.k, e.target.value)}><option value="">Ninguno</option>{brokers.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>
          <Link className="boton icono" href="/brokers" title="Agregar broker" aria-label="Agregar broker">+</Link>
        </div>
      );
      case "etapa": return <select id={idc} className="entrada" value={v ?? "nuevo"} onChange={(e) => poner(c.k, e.target.value)}>{ETAPAS.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      case "origen": return <select id={idc} className="entrada" value={v ?? "manual"} onChange={(e) => poner(c.k, e.target.value)}>{ORIGENES.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      case "desarrollo": return <select id={idc} className="entrada" value={v ?? "VRO"} onChange={(e) => poner(c.k, e.target.value)}>{DESARROLLOS.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}</select>;
      default: return <input id={idc} className="entrada" type={c.tipo === "email" ? "email" : c.tipo === "telefono" ? "tel" : "text"} placeholder={c.n} value={v ?? ""} onChange={(e) => poner(c.k, e.target.value)} />;
    }
  }

  if (error) return <><Barra titulo="Lead" /><div className="contenido"><div className="error-caja">{error}</div></div></>;
  if (!lead) return <><Barra titulo="Lead" /><div className="contenido"><div className="vacio">Cargando…</div></div></>;

  return (
    <>
      <Barra titulo={lead.nombre} icono={<button className="boton icono" onClick={() => router.back()} aria-label="Volver"><ArrowLeft size={16} /></button>}>
        <PastillaEtapa etapa={valor("etapa")} />
        {rel.conv && <Link className="boton" href={`/bandeja?c=${rel.conv.id}`}><MessageCircle size={15} /> Chat</Link>}
        <Link className="boton" href={`/cotizaciones?nuevo=1&lead_id=${lead.id}`}><FileText size={15} /> Cotizar</Link>
      </Barra>

      <div className="pasos-lead">
        {PASOS.map((p, i) => (
          <button key={p.id} className={`${paso === p.id ? "activo" : ""} ${i <= idxActual ? "hecho" : ""}`} onClick={() => setPaso(p.id)}>
            {p.n}
          </button>
        ))}
      </div>

      <div className="contenido ficha-rejilla">
        <div className="ficha-izq">
          {paso === "lead" && SECCIONES_LEAD.map((s) => (
            <section className="tarjeta seccion-ficha" key={s.titulo}>
              <h2>{s.titulo}</h2>
              <div className="formulario formulario-3">
                {s.campos.map((c) => (
                  <div key={c.k} className={`campo ${c.ancho ? "ancho" : ""}`}>
                    <label htmlFor={`lf-${c.k}`}>{c.requerido ? "* " : ""}{c.n}</label>
                    {control(c)}
                  </div>
                ))}
              </div>
            </section>
          ))}
          {paso === "cotizacion" && <Relacionados titulo="Cotizaciones" filas={rel.cot} vacio="Sin cotizaciones todavía." accion={<Link className="boton primario" href={`/cotizaciones?nuevo=1&lead_id=${lead.id}`}>Nueva cotización</Link>}
            render={(c) => <><b>{c.folio}</b> · {c.unidades?.torre}-{c.unidades?.numero} · {dinero(c.precio_final)} <Pastilla tono={c.estado === "aceptada" ? "bien" : "info"}>{c.estado}</Pastilla></>} href="/cotizaciones" />}
          {paso === "separacion" && <Relacionados titulo="Separaciones" filas={rel.sep} vacio="Sin separaciones." accion={<Link className="boton primario" href={`/separaciones?nuevo=1&lead_id=${lead.id}`}>Registrar separación</Link>}
            render={(s) => <><b>{s.unidades?.torre}-{s.unidades?.numero}</b> · {dinero(s.monto)} · {fecha(s.fecha)} <Pastilla tono={s.estado === "activa" ? "aviso" : "bien"}>{s.estado}</Pastilla></>} href="/separaciones" />}
          {paso === "vendido" && <Relacionados titulo="Ventas" filas={rel.ven} vacio="Sin ventas." accion={<Link className="boton primario" href={`/ventas?nuevo=1&lead_id=${lead.id}`}>Registrar venta</Link>}
            render={(v) => <><b>{v.unidades?.torre}-{v.unidades?.numero}</b> · {dinero(v.precio_final)} · {fecha(v.fecha_contrato)} <Pastilla tono="bien">{v.estado}</Pastilla></>} href="/ventas" />}
        </div>

        <div className="ficha-der">
          <PanelActividad leadId={lead.id} avisar={avisar} />
        </div>
      </div>

      {paso === "lead" && (
        <div className={`guardar-flotante ${hayCambios ? "visible" : ""}`}>
          <span>{Object.keys(cambios).length} cambio{Object.keys(cambios).length === 1 ? "" : "s"} sin guardar</span>
          <button className="boton" onClick={() => setCambios({})}>Descartar</button>
          <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      )}
      {toast}
    </>
  );
}

function Relacionados({ titulo, filas, vacio, accion, render, href }: { titulo: string; filas: Fila[]; vacio: string; accion: React.ReactNode; render: (f: Fila) => React.ReactNode; href: string }) {
  return (
    <section className="tarjeta seccion-ficha">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}><h2 style={{ flex: 1 }}>{titulo}</h2>{accion}</div>
      <div className="linea-tiempo">
        {filas.map((f) => <Link key={f.id} href={href} className="evento"><div><p>{render(f)}</p></div></Link>)}
        {filas.length === 0 && <small style={{ color: "var(--texto-3)" }}>{vacio}</small>}
      </div>
    </section>
  );
}

/* ---------- Panel derecho: comentarios, tareas, adjuntos, historial, eventos ---------- */
function PanelActividad({ leadId, avisar }: { leadId: string; avisar: (t: string) => void }) {
  const db = supabaseNavegador();
  const [pestana, setPestana] = useState<(typeof PESTANAS)[number]>("Comentarios");
  const [acts, setActs] = useState<Fila[]>([]);
  const [tareas, setTareas] = useState<Fila[]>([]);
  const [docs, setDocs] = useState<Fila[]>([]);
  const [texto, setTexto] = useState("");
  const [urgente, setUrgente] = useState(false);
  const [tarea, setTarea] = useState({ titulo: "", vence: "" });
  const [subiendo, setSubiendo] = useState(false);

  const cargar = useCallback(async () => {
    const [a, t, d] = await Promise.all([
      db.from("actividades").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
      db.from("tareas").select("*").eq("lead_id", leadId).order("hecha").order("vence", { nullsFirst: false }),
      db.from("documentos").select("*").eq("lead_id", leadId).order("created_at", { ascending: false }),
    ]);
    setActs(a.data ?? []); setTareas(t.data ?? []); setDocs(d.data ?? []);
  }, [db, leadId]);
  useEffect(() => { cargar(); }, [cargar]);

  const comentarios = acts.filter((a) => ["nota", "llamada", "whatsapp", "cita"].includes(a.tipo));
  const eventos = useMemo(() => [
    ...tareas.filter((t) => t.vence).map((t) => ({ f: t.vence, t: `Tarea: ${t.titulo}${t.hecha ? " (hecha)" : ""}` })),
    ...acts.filter((a) => a.tipo === "cita").map((a) => ({ f: a.created_at, t: a.texto })),
  ].sort((a, b) => (a.f < b.f ? 1 : -1)), [tareas, acts]);

  async function comentar() {
    if (!texto.trim()) return;
    const { data: auth } = await db.auth.getUser();
    const { error } = await db.from("actividades").insert({ lead_id: leadId, tipo: "nota", texto: texto.trim(), urgente, creado_por: auth.user?.id });
    if (error) return avisar(error.message);
    setTexto(""); setUrgente(false); cargar();
  }
  async function crearTarea() {
    if (!tarea.titulo.trim()) return;
    const { data: auth } = await db.auth.getUser();
    const { error } = await db.from("tareas").insert({ lead_id: leadId, titulo: tarea.titulo.trim(), vence: tarea.vence ? new Date(tarea.vence).toISOString() : null, creado_por: auth.user?.id, asignado_a: auth.user?.id });
    if (error) return avisar(error.message);
    setTarea({ titulo: "", vence: "" }); cargar();
  }
  async function alternarTarea(t: Fila) {
    await db.from("tareas").update({ hecha: !t.hecha }).eq("id", t.id); cargar();
  }
  async function borrarTarea(t: Fila) {
    await db.from("tareas").delete().eq("id", t.id); cargar();
  }
  async function subir(archivos: FileList | null) {
    if (!archivos?.length) return;
    setSubiendo(true);
    try {
      for (const f of Array.from(archivos)) {
        const ruta = await subirArchivo(`leads/${leadId}`, f);
        await db.from("documentos").insert({ nombre: f.name, categoria: "Expediente del cliente", archivo_path: ruta, lead_id: leadId });
      }
      cargar();
    } catch (e: any) { avisar(e.message); }
    setSubiendo(false);
  }

  return (
    <div className="tarjeta">
      <div className="pestanas">
        {PESTANAS.map((p) => (
          <button key={p} className={pestana === p ? "activo" : ""} onClick={() => setPestana(p)}>
            {p}{p === "Tareas" && tareas.filter((t) => !t.hecha).length ? <span className="no-leidos" style={{ marginLeft: 6 }}>{tareas.filter((t) => !t.hecha).length}</span> : null}
          </button>
        ))}
      </div>
      <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {pestana === "Comentarios" && (
          <>
            <div className="redactor-comentario">
              <textarea id="comentario" className="entrada" placeholder="Escribe un comentario…" value={texto} onChange={(e) => setTexto(e.target.value)} />
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <label className="interruptor" htmlFor="urgente"><input id="urgente" type="checkbox" checked={urgente} onChange={(e) => setUrgente(e.target.checked)} /> Urgente</label>
                <div style={{ flex: 1 }} />
                <button className="boton primario" onClick={comentar} disabled={!texto.trim()}>Comentar</button>
              </div>
            </div>
            <Lista vacio="No hay comentarios" filas={comentarios} render={(a) => (
              <><p>{a.urgente && <span className="pastilla mal" style={{ marginRight: 6 }}>Urgente</span>}{a.texto}</p><small>{a.tipo} · {relativo(a.created_at)}</small></>
            )} />
          </>
        )}
        {pestana === "Tareas" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input id="tarea-titulo" className="entrada" style={{ flex: 2, minWidth: 160 }} placeholder="Ej. Llamar para confirmar visita" value={tarea.titulo}
                onChange={(e) => setTarea({ ...tarea, titulo: e.target.value })} onKeyDown={(e) => e.key === "Enter" && crearTarea()} />
              <input id="tarea-vence" className="entrada" style={{ flex: 1, minWidth: 150 }} type="datetime-local" value={tarea.vence} onChange={(e) => setTarea({ ...tarea, vence: e.target.value })} />
              <button className="boton primario" onClick={crearTarea}>Agregar</button>
            </div>
            <Lista vacio="Sin tareas" filas={tareas} render={(t) => (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <input type="checkbox" checked={t.hecha} onChange={() => alternarTarea(t)} aria-label="Marcar como hecha" style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ textDecoration: t.hecha ? "line-through" : "none", color: t.hecha ? "var(--texto-3)" : undefined }}>{t.titulo}</p>
                  {t.vence && <small className={!t.hecha && new Date(t.vence) < new Date() ? "atrasado" : ""}><CalendarClock size={11} /> {new Date(t.vence).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</small>}
                </div>
                <button className="boton icono" onClick={() => borrarTarea(t)} aria-label="Borrar tarea"><Trash2 size={14} /></button>
              </div>
            )} plano />
          </>
        )}
        {pestana === "Adjuntos" && (
          <>
            <label className="zona-subir" htmlFor="subir-adjunto">
              <Upload size={18} /> {subiendo ? "Subiendo…" : "Sube INE, comprobante de domicilio, constancia fiscal, etc."}
              <input id="subir-adjunto" type="file" multiple hidden onChange={(e) => subir(e.target.files)} />
            </label>
            <Lista vacio="Sin archivos" filas={docs} render={(d) => (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Paperclip size={14} /><p style={{ flex: 1 }}>{d.nombre}</p>
                <button className="boton chico" onClick={() => abrirArchivo(d.archivo_path).catch((e) => avisar(e.message))}>Ver</button>
              </div>
            )} plano />
          </>
        )}
        {pestana === "Historial" && <Lista vacio="Sin movimientos" filas={acts} render={(a) => <><p>{a.texto}</p><small>{a.tipo} · {fecha(a.created_at)} · {relativo(a.created_at)}</small></>} />}
        {pestana === "Eventos" && <Lista vacio="Sin citas ni tareas con fecha" filas={eventos} render={(e) => <><p>{e.t}</p><small>{new Date(e.f).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</small></>} />}
      </div>
    </div>
  );
}

function Lista({ filas, render, vacio, plano }: { filas: Fila[]; render: (f: Fila) => React.ReactNode; vacio: string; plano?: boolean }) {
  if (!filas.length) return <div className="vacio">{vacio}</div>;
  return (
    <div className={plano ? "lista-plana" : "linea-tiempo"}>
      {filas.map((f, i) => <div key={f.id ?? i} className={plano ? "" : "evento"}><div>{render(f)}</div></div>)}
    </div>
  );
}
