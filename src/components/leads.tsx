"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { MessageCircle, Sparkles, Trash2 } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS, ETAPAS, ORIGENES, nombreEtapa, nombreOrigen, tonoEtapa, type Actividad, type Lead } from "@/lib/tipos";
import { dinero, fecha, normalizarTelefono, relativo } from "@/lib/formato";
import { Pastilla, Ventana, useOpciones } from "./ui";

/** Lista de leads en vivo (se actualiza sola cuando llega uno nuevo). */
export function useLeads() {
  const [leads, setLeads] = useState<Lead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cargar = useCallback(async () => {
    const { data, error } = await supabaseNavegador()
      .from("leads").select("*").order("created_at", { ascending: false }).limit(2000);
    if (error) setError(error.message);
    else setLeads(data as Lead[]);
  }, []);
  useEffect(() => {
    cargar();
    const db = supabaseNavegador();
    const canal = db.channel("leads-vivo")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, cargar)
      .subscribe();
    return () => { db.removeChannel(canal); };
  }, [cargar]);
  return { leads, setLeads, error, recargar: cargar };
}

export function PastillaEtapa({ etapa }: { etapa: string }) {
  return <Pastilla tono={tonoEtapa(etapa)}>{nombreEtapa(etapa)}</Pastilla>;
}

/** Formulario para capturar un lead a mano. */
export function NuevoLead({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (id: string) => void }) {
  const [d, setD] = useState<Record<string, string>>({ origen: "manual", desarrollo: "VRO", etapa: "nuevo" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const brokers = useOpciones("brokers");
  const asesores = useOpciones("perfiles");
  const poner = (k: string, v: string) => setD((x) => ({ ...x, [k]: v }));

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setGuardando(true);
    const db = supabaseNavegador();
    const { data: auth } = await db.auth.getUser();
    const { data, error } = await db.from("leads").insert({
      nombre: d.nombre?.trim() || "Sin nombre",
      telefono: normalizarTelefono(d.telefono),
      email: d.email?.trim() || null,
      origen: d.origen, desarrollo: d.desarrollo, etapa: d.etapa,
      broker_id: d.broker_id || null, asesor_id: d.asesor_id || null,
      tipologia: d.tipologia || null,
      presupuesto: d.presupuesto ? Number(d.presupuesto) : null,
      proximo_seguimiento: d.proximo_seguimiento || null,
      notas: d.notas || null,
    }).select("id").single();
    if (error) { setError(error.message); setGuardando(false); return; }
    await db.from("actividades").insert({ lead_id: data.id, tipo: "sistema", texto: "Lead capturado a mano.", creado_por: auth.user?.id });
    onCreado(data.id);
  }

  return (
    <Ventana titulo="Nuevo lead" onCerrar={onCerrar}>
      <form className="formulario" id="nuevo-lead" onSubmit={guardar}>
        <Campo id="n-nombre" etiqueta="Nombre *"><input id="n-nombre" className="entrada" required onChange={(e) => poner("nombre", e.target.value)} /></Campo>
        <Campo id="n-tel" etiqueta="Teléfono"><input id="n-tel" className="entrada" inputMode="tel" onChange={(e) => poner("telefono", e.target.value)} /></Campo>
        <Campo id="n-email" etiqueta="Correo"><input id="n-email" className="entrada" type="email" onChange={(e) => poner("email", e.target.value)} /></Campo>
        <Campo id="n-origen" etiqueta="Origen">
          <select id="n-origen" className="entrada" value={d.origen} onChange={(e) => poner("origen", e.target.value)}>
            {ORIGENES.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="n-des" etiqueta="Desarrollo">
          <select id="n-des" className="entrada" value={d.desarrollo} onChange={(e) => poner("desarrollo", e.target.value)}>
            {DESARROLLOS.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="n-broker" etiqueta="Broker">
          <select id="n-broker" className="entrada" onChange={(e) => poner("broker_id", e.target.value)}>
            <option value="">Ninguno</option>
            {brokers.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="n-asesor" etiqueta="Asesor asignado">
          <select id="n-asesor" className="entrada" onChange={(e) => poner("asesor_id", e.target.value)}>
            <option value="">Sin asignar</option>
            {asesores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </Campo>
        <Campo id="n-seg" etiqueta="Próximo seguimiento"><input id="n-seg" className="entrada" type="date" onChange={(e) => poner("proximo_seguimiento", e.target.value)} /></Campo>
        <Campo id="n-notas" etiqueta="Notas" ancho><textarea id="n-notas" className="entrada" onChange={(e) => poner("notas", e.target.value)} /></Campo>
      </form>
      {error && <div className="error-caja">{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
        <button className="boton primario" form="nuevo-lead" disabled={guardando}>{guardando ? "Guardando…" : "Crear lead"}</button>
      </div>
    </Ventana>
  );
}

function Campo({ id, etiqueta, ancho, children }: { id: string; etiqueta: string; ancho?: boolean; children: React.ReactNode }) {
  return <div className={`campo ${ancho ? "ancho" : ""}`}><label htmlFor={id}>{etiqueta}</label>{children}</div>;
}

/** Ficha completa del lead: datos editables, historial, chat ligado e IA. */
export function FichaLead({ id, onCerrar }: { id: string; onCerrar: () => void }) {
  const db = supabaseNavegador();
  const [lead, setLead] = useState<Lead | null>(null);
  const [acts, setActs] = useState<Actividad[]>([]);
  const [conv, setConv] = useState<{ id: string; plataforma: string | null } | null>(null);
  const [nota, setNota] = useState("");
  const [tipoNota, setTipoNota] = useState("nota");
  const [guardado, setGuardado] = useState<string | null>(null);
  const [ia, setIa] = useState<{ cargando: boolean; texto?: string; error?: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const brokers = useOpciones("brokers");
  const asesores = useOpciones("perfiles");

  const cargar = useCallback(async () => {
    const [{ data: l }, { data: a }, { data: c }] = await Promise.all([
      db.from("leads").select("*").eq("id", id).single(),
      db.from("actividades").select("*").eq("lead_id", id).order("created_at", { ascending: false }),
      db.from("conversaciones").select("id, plataforma").eq("lead_id", id).limit(1).maybeSingle(),
    ]);
    setLead(l as Lead);
    setActs((a ?? []) as Actividad[]);
    setConv(c);
  }, [db, id]);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(campo: keyof Lead, valor: unknown) {
    if (!lead) return;
    const anterior = lead[campo];
    let v = valor === "" ? null : valor;
    if (campo === "telefono") v = normalizarTelefono(v as string);
    setLead({ ...lead, [campo]: v } as Lead);
    const { error } = await db.from("leads").update({ [campo]: v }).eq("id", lead.id);
    if (error) { setGuardado(`Error: ${error.message}`); return; }
    if (campo === "etapa" && anterior !== v) {
      const { data: auth } = await db.auth.getUser();
      await db.from("actividades").insert({
        lead_id: lead.id, tipo: "cambio_etapa", creado_por: auth.user?.id,
        texto: `Etapa: ${nombreEtapa(String(anterior))} → ${nombreEtapa(String(v))}`,
      });
      cargar();
    }
    setGuardado("Guardado");
    setTimeout(() => setGuardado(null), 1500);
  }

  async function agregarNota() {
    if (!nota.trim() || !lead) return;
    const { data: auth } = await db.auth.getUser();
    await db.from("actividades").insert({ lead_id: lead.id, tipo: tipoNota, texto: nota.trim(), creado_por: auth.user?.id });
    setNota("");
    cargar();
  }

  async function analizar() {
    setIa({ cargando: true });
    const r = await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "lead", id }) });
    const d = await r.json().catch(() => ({ error: "Respuesta inválida" }));
    setIa(r.ok ? { cargando: false, texto: d.texto } : { cargando: false, error: d.error });
  }

  async function borrar() {
    await db.from("leads").delete().eq("id", id);
    onCerrar();
  }

  if (!lead) return <Ventana titulo="Cargando…" onCerrar={onCerrar} lado><p>Cargando…</p></Ventana>;

  const texto = (campo: keyof Lead, etiqueta: string, tipo = "text") => (
    <div className="campo">
      <label htmlFor={`f-${String(campo)}`}>{etiqueta}</label>
      <input id={`f-${String(campo)}`} className="entrada" type={tipo} defaultValue={(lead[campo] as string | number | null) ?? ""}
        onBlur={(e) => e.target.value !== String(lead[campo] ?? "") && cambiar(campo, tipo === "number" && e.target.value ? Number(e.target.value) : e.target.value)} />
    </div>
  );

  return (
    <Ventana lado onCerrar={onCerrar} titulo={<span style={{ display: "flex", gap: 10, alignItems: "center" }}>{lead.nombre} <PastillaEtapa etapa={lead.etapa} /></span>}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span className="etiqueta">{nombreOrigen(lead.origen)}</span>
        {lead.campana && <span className="etiqueta">{lead.campana}</span>}
        <small style={{ color: "var(--texto-3)" }}>Creado {relativo(lead.created_at)}</small>
        <div style={{ flex: 1 }} />
        {guardado && <small style={{ color: "var(--bien)" }}>{guardado}</small>}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Link className="boton primario" href={`/leads/${lead.id}`}>Abrir ficha completa</Link>
        {conv && <Link className="boton" href={`/bandeja?c=${conv.id}`}><MessageCircle size={15} /> Abrir chat</Link>}
        {lead.telefono && <span className="boton" style={{ cursor: "text", userSelect: "all" }}>{lead.telefono}</span>}
        <Link className="boton" href={`/cotizaciones?nuevo=1&lead_id=${lead.id}`}>Cotizar depto.</Link>
        <button className="boton" onClick={analizar}><Sparkles size={15} /> Siguiente paso con IA</button>
      </div>
      {ia && (ia.cargando ? <div className="ia-caja">Pensando…</div> : ia.error ? <div className="error-caja">{ia.error}</div> : <div className="ia-caja">{ia.texto}</div>)}

      <div className="segmentos" style={{ flexWrap: "wrap" }}>
        {ETAPAS.map((e) => (
          <button key={e.id} className={lead.etapa === e.id ? "activo" : ""} onClick={() => cambiar("etapa", e.id)}>{e.nombre}</button>
        ))}
      </div>

      <div className="formulario">
        {texto("nombre", "Nombre")}
        {texto("telefono", "Teléfono", "tel")}
        {texto("email", "Correo", "email")}
        <div className="campo">
          <label htmlFor="f-desarrollo">Desarrollo</label>
          <select id="f-desarrollo" className="entrada" value={lead.desarrollo ?? ""} onChange={(e) => cambiar("desarrollo", e.target.value)}>
            {DESARROLLOS.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="f-asesor">Asesor</label>
          <select id="f-asesor" className="entrada" value={lead.asesor_id ?? ""} onChange={(e) => cambiar("asesor_id", e.target.value)}>
            <option value="">Sin asignar</option>
            {asesores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="f-broker">Broker</label>
          <select id="f-broker" className="entrada" value={lead.broker_id ?? ""} onChange={(e) => cambiar("broker_id", e.target.value)}>
            <option value="">Ninguno</option>
            {brokers.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="f-origen">Origen</label>
          <select id="f-origen" className="entrada" value={lead.origen} onChange={(e) => cambiar("origen", e.target.value)}>
            {ORIGENES.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        </div>
        {texto("proximo_seguimiento", "Próximo seguimiento", "date")}
        {texto("tipologia", "Tipología de interés")}
        {texto("presupuesto", "Presupuesto (MXN)", "number")}
        {(lead.etapa === "apartado" || lead.etapa === "cerrado") && texto("valor_operacion", "Valor de la operación (MXN)", "number")}
        {lead.etapa === "perdido" && texto("motivo_perdida", "Motivo de pérdida")}
        <div className="campo ancho">
          <label htmlFor="f-notas">Notas</label>
          <textarea id="f-notas" className="entrada" defaultValue={lead.notas ?? ""} onBlur={(e) => e.target.value !== (lead.notas ?? "") && cambiar("notas", e.target.value)} />
        </div>
      </div>
      {lead.valor_operacion != null && <small style={{ color: "var(--texto-2)" }}>Operación: {dinero(lead.valor_operacion)}</small>}

      <div className="tarjeta" style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <b>Historial</b>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select id="tipo-nota" className="entrada" style={{ width: 130 }} value={tipoNota} onChange={(e) => setTipoNota(e.target.value)}>
            <option value="nota">Nota</option><option value="llamada">Llamada</option><option value="cita">Cita</option><option value="whatsapp">WhatsApp</option>
          </select>
          <input id="nota" className="entrada" style={{ flex: 1, minWidth: 160 }} placeholder="¿Qué pasó con este lead?" value={nota}
            onChange={(e) => setNota(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregarNota()} />
          <button className="boton primario" onClick={agregarNota}>Agregar</button>
        </div>
        <div className="linea-tiempo">
          {acts.map((a) => (
            <div className="evento" key={a.id}>
              <div><p>{a.texto}</p><small>{a.tipo} · {fecha(a.created_at)} {relativo(a.created_at)}</small></div>
            </div>
          ))}
          {acts.length === 0 && <small style={{ color: "var(--texto-3)" }}>Sin actividad todavía.</small>}
        </div>
      </div>

      <div>
        {confirmar ? (
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>¿Eliminar este lead y su historial?</span>
            <button className="boton peligro" onClick={borrar}>Sí, eliminar</button>
            <button className="boton" onClick={() => setConfirmar(false)}>No</button>
          </div>
        ) : (
          <button className="boton peligro" onClick={() => setConfirmar(true)}><Trash2 size={15} /> Eliminar lead</button>
        )}
      </div>
    </Ventana>
  );
}
