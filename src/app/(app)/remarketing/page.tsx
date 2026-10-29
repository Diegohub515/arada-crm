"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Send, ImageIcon, RefreshCw } from "lucide-react";
import { Barra } from "@/components/Marco";
import { Pastilla, Ventana, subirArchivo, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS, ETAPAS, ORIGENES, nombreEtapa, tonoEtapa } from "@/lib/tipos";

type Plantilla = {
  id: string; nombre: string; idioma: string; titulo: string | null; texto: string | null;
  imagen_path: string | null; desarrollo: string | null; activa: boolean;
};
type Campana = {
  id: string; nombre: string; total: number; enviados: number; errores: number; created_at: string;
  plantillas: { titulo: string | null; nombre: string } | null;
};
type LeadFila = { id: string; nombre: string; telefono: string | null; etapa: string; desarrollo: string | null; origen: string; created_at: string };

const COSTO_AVISO = "Cada lead gasta 1 tarea de Zapier, y Meta cobra cada plantilla enviada.";

export default function Remarketing() {
  const [vista, setVista] = useState<"nuevo" | "historial" | "plantillas">("nuevo");
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [toast, avisar] = useToast();
  const db = supabaseNavegador();

  const cargarPlantillas = useCallback(async () => {
    const { data } = await db.from("plantillas").select("*").order("created_at");
    setPlantillas((data ?? []) as Plantilla[]);
  }, [db]);
  useEffect(() => { cargarPlantillas(); }, [cargarPlantillas]);

  return (
    <>
      <Barra titulo="Remarketing WhatsApp" icono={<Megaphone size={18} />}>
        <div className="segmentos">
          <button className={vista === "nuevo" ? "activo" : ""} onClick={() => setVista("nuevo")}>Nuevo envío</button>
          <button className={vista === "historial" ? "activo" : ""} onClick={() => setVista("historial")}>Historial</button>
          <button className={vista === "plantillas" ? "activo" : ""} onClick={() => setVista("plantillas")}>Plantillas</button>
        </div>
      </Barra>
      <div className="contenido">
        {vista === "nuevo" && <NuevoEnvio plantillas={plantillas.filter((p) => p.activa)} avisar={avisar} onEnviado={() => setVista("historial")} />}
        {vista === "historial" && <Historial />}
        {vista === "plantillas" && <Plantillas plantillas={plantillas} recargar={cargarPlantillas} avisar={avisar} />}
      </div>
      {toast}
    </>
  );
}

/* ---------------- Nuevo envío ---------------- */

function NuevoEnvio({ plantillas, avisar, onEnviado }: { plantillas: Plantilla[]; avisar: (m: string) => void; onEnviado: () => void }) {
  const db = supabaseNavegador();
  const [plantillaId, setPlantillaId] = useState("");
  const [desarrollo, setDesarrollo] = useState("todos");
  const [etapas, setEtapas] = useState<string[]>(["nuevo", "contactado"]);
  const [origen, setOrigen] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [excluirDias, setExcluirDias] = useState(7);
  const [leads, setLeads] = useState<LeadFila[]>([]);
  const [quitados, setQuitados] = useState<Set<string>>(new Set());
  const [excluidos, setExcluidos] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!plantillaId && plantillas[0]) setPlantillaId(plantillas[0].id); }, [plantillas, plantillaId]);
  const plantilla = plantillas.find((p) => p.id === plantillaId);

  const buscar = useCallback(async () => {
    setCargando(true);
    setError(null);
    let q = db.from("leads").select("id, nombre, telefono, etapa, desarrollo, origen, created_at")
      .not("telefono", "is", null).order("created_at", { ascending: false }).limit(2000);
    if (desarrollo !== "todos") q = q.eq("desarrollo", desarrollo);
    if (etapas.length) q = q.in("etapa", etapas);
    if (origen !== "todos") q = q.eq("origen", origen);
    if (desde) q = q.gte("created_at", `${desde}T00:00:00`);
    if (hasta) q = q.lte("created_at", `${hasta}T23:59:59`);
    const { data, error } = await q;
    if (error) { setError(error.message); setCargando(false); return; }
    let lista = ((data ?? []) as LeadFila[]).filter((l) => (l.telefono ?? "").replace(/\D/g, "").length >= 10);

    // No repetir la misma plantilla a quien ya la recibió hace poco
    let fuera = 0;
    if (plantillaId && excluirDias > 0) {
      const limite = new Date(Date.now() - excluirDias * 86400000).toISOString();
      const { data: previos } = await db.from("campana_envios")
        .select("lead_id, campanas_wa!inner(plantilla_id)")
        .eq("campanas_wa.plantilla_id", plantillaId).neq("estado", "error").gte("created_at", limite).limit(5000);
      const ya = new Set((previos ?? []).map((p: any) => p.lead_id));
      const antes = lista.length;
      lista = lista.filter((l) => !ya.has(l.id));
      fuera = antes - lista.length;
    }
    setExcluidos(fuera);
    setLeads(lista);
    setQuitados(new Set());
    setCargando(false);
  }, [db, desarrollo, etapas, origen, desde, hasta, excluirDias, plantillaId]);

  useEffect(() => { buscar(); }, [buscar]);

  const seleccionados = useMemo(() => leads.filter((l) => !quitados.has(l.id)), [leads, quitados]);

  async function enviar() {
    if (!plantilla || seleccionados.length === 0) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/remarketing/enviar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          plantillaId: plantilla.id, leadIds: seleccionados.map((l) => l.id),
          filtros: { desarrollo, etapas, origen, desde, hasta, excluirDias },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo enviar");
      avisar(`Enviando a ${d.total} leads${d.fallas ? ` (${d.fallas} con error)` : ""}`);
      setConfirmar(false);
      onEnviado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const alternarEtapa = (id: string) => setEtapas((x) => (x.includes(id) ? x.filter((e) => e !== id) : [...x, id]));
  const sinImagen = plantilla && !plantilla.imagen_path;

  return (
    <>
      <section className="tarjeta">
        <div className="tarjeta-cabeza"><h2>1. Plantilla</h2></div>
        <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {plantillas.length === 0 ? (
            <div className="aviso-caja">No hay plantillas activas. Agrégalas en la pestaña “Plantillas”.</div>
          ) : (
            <select id="r-plantilla" className="entrada" value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} style={{ maxWidth: 420 }}>
              {plantillas.map((p) => <option key={p.id} value={p.id}>{p.titulo || p.nombre} ({p.nombre})</option>)}
            </select>
          )}
          {plantilla?.texto && <div className="globo saliente" style={{ maxWidth: 420, whiteSpace: "pre-wrap" }}>{plantilla.texto}</div>}
          {sinImagen && <div className="error-caja">Esta plantilla necesita su imagen de encabezado. Súbela en la pestaña “Plantillas” antes de enviar.</div>}
        </div>
      </section>

      <section className="tarjeta">
        <div className="tarjeta-cabeza"><h2>2. ¿A quién?</h2></div>
        <div className="tarjeta-cuerpo formulario">
          <div className="campo">
            <label htmlFor="r-desarrollo">Desarrollo</label>
            <select id="r-desarrollo" className="entrada" value={desarrollo} onChange={(e) => setDesarrollo(e.target.value)}>
              <option value="todos">Todos</option>
              {DESARROLLOS.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="r-origen">Origen</label>
            <select id="r-origen" className="entrada" value={origen} onChange={(e) => setOrigen(e.target.value)}>
              <option value="todos">Todos</option>
              {ORIGENES.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div className="campo ancho">
            <label>Etapa</label>
            <div className="chips">
              {ETAPAS.map((e) => (
                <button key={e.id} type="button" className={`chip ${etapas.includes(e.id) ? "activo" : ""}`} onClick={() => alternarEtapa(e.id)}
                  style={etapas.includes(e.id) ? { background: "var(--acento)", color: "#fff" } : undefined}>
                  {e.nombre}
                </button>
              ))}
            </div>
          </div>
          <div className="campo">
            <label htmlFor="r-desde">Llegaron desde</label>
            <input id="r-desde" type="date" className="entrada" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </div>
          <div className="campo">
            <label htmlFor="r-hasta">Hasta</label>
            <input id="r-hasta" type="date" className="entrada" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </div>
          <div className="campo ancho">
            <label htmlFor="r-excluir">No repetir a quien ya recibió esta plantilla en los últimos (días)</label>
            <input id="r-excluir" type="number" min={0} className="entrada" style={{ maxWidth: 120 }} value={excluirDias}
              onChange={(e) => setExcluirDias(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
      </section>

      <section className="tarjeta">
        <div className="tarjeta-cabeza">
          <h2>3. Revisa y envía</h2>
          <div className="espacio" />
          <button className="boton chico" onClick={buscar} disabled={cargando}><RefreshCw size={13} /> Actualizar</button>
        </div>
        <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="kpi-fila">
            <b style={{ fontSize: 22 }}>{cargando ? "…" : seleccionados.length}</b>
            <span style={{ color: "var(--texto-2)" }}>leads recibirán la plantilla</span>
            {excluidos > 0 && <small style={{ color: "var(--texto-3)" }}>· {excluidos} se omiten porque ya la recibieron</small>}
            {quitados.size > 0 && <small style={{ color: "var(--texto-3)" }}>· {quitados.size} quitados a mano</small>}
          </div>
          {error && <div className="error-caja">{error}</div>}
          <div className="tabla-caja" style={{ maxHeight: 380, overflow: "auto" }}>
            <table className="tabla">
              <thead><tr><th style={{ width: 36 }}></th><th>Nombre</th><th>Teléfono</th><th>Etapa</th><th>Desarrollo</th><th>Llegó</th></tr></thead>
              <tbody>
                {leads.slice(0, 500).map((l) => (
                  <tr key={l.id} onClick={() => setQuitados((q) => { const n = new Set(q); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })}>
                    <td><input type="checkbox" readOnly checked={!quitados.has(l.id)} aria-label={`Incluir a ${l.nombre}`} /></td>
                    <td>{l.nombre}</td>
                    <td className="num">{l.telefono}</td>
                    <td><Pastilla tono={tonoEtapa(l.etapa)}>{nombreEtapa(l.etapa)}</Pastilla></td>
                    <td>{l.desarrollo ?? "—"}</td>
                    <td className="num">{new Date(l.created_at).toLocaleDateString("es-MX")}</td>
                  </tr>
                ))}
                {!cargando && leads.length === 0 && <tr><td colSpan={6} className="vacio">Ningún lead coincide con esos filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          {leads.length > 500 && <small style={{ color: "var(--texto-3)" }}>Se muestran los primeros 500, pero se envía a todos los marcados.</small>}
          <div className="herramientas">
            <small style={{ color: "var(--texto-3)" }}>{COSTO_AVISO}</small>
            <div className="espacio" />
            <button className="boton primario" disabled={!plantilla || !!sinImagen || seleccionados.length === 0 || cargando} onClick={() => setConfirmar(true)}>
              <Send size={15} /> Enviar a {seleccionados.length}
            </button>
          </div>
        </div>
      </section>

      {confirmar && plantilla && (
        <Ventana titulo="¿Enviar remarketing?" onCerrar={() => !enviando && setConfirmar(false)}
          pie={<>
            <button className="boton" onClick={() => setConfirmar(false)} disabled={enviando}>Cancelar</button>
            <button className="boton primario" onClick={enviar} disabled={enviando}><Send size={15} /> {enviando ? "Enviando…" : `Sí, enviar a ${seleccionados.length}`}</button>
          </>}>
          <p style={{ marginTop: 0 }}>
            Se mandará la plantilla <b>{plantilla.titulo || plantilla.nombre}</b> a <b>{seleccionados.length}</b> leads por WhatsApp.
          </p>
          <ul style={{ color: "var(--texto-2)", paddingLeft: 18 }}>
            <li>Gasta unas <b>{seleccionados.length} tareas</b> de Zapier.</li>
            <li>Meta cobra cada plantilla entregada.</li>
            <li>Si el cliente contesta escribiendo, el bot le sigue la plática y lo ves en la Bandeja.</li>
          </ul>
        </Ventana>
      )}
    </>
  );
}

/* ---------------- Historial ---------------- */

function Historial() {
  const db = supabaseNavegador();
  const [campanas, setCampanas] = useState<Campana[]>([]);
  const [abierta, setAbierta] = useState<Campana | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await db.from("campanas_wa").select("id, nombre, total, enviados, errores, created_at, plantillas(titulo, nombre)")
      .order("created_at", { ascending: false }).limit(100);
    setCampanas((data ?? []) as any);
  }, [db]);
  useEffect(() => {
    cargar();
    const canal = db.channel("remarketing-campanas")
      .on("postgres_changes", { event: "*", schema: "public", table: "campanas_wa" }, cargar).subscribe();
    return () => { db.removeChannel(canal); };
  }, [db, cargar]);

  return (
    <>
      <div className="tabla-caja">
        <table className="tabla">
          <thead><tr><th>Envío</th><th>Plantilla</th><th className="der">Total</th><th className="der">Enviados</th><th className="der">Errores</th><th>Fecha</th></tr></thead>
          <tbody>
            {campanas.map((c) => {
              const enCurso = c.enviados + c.errores < c.total;
              return (
                <tr key={c.id} onClick={() => setAbierta(c)}>
                  <td>{c.nombre}</td>
                  <td>{c.plantillas?.titulo || c.plantillas?.nombre || "—"}</td>
                  <td className="der num">{c.total}</td>
                  <td className="der num">{enCurso ? <Pastilla tono="info">enviando…</Pastilla> : c.enviados}</td>
                  <td className="der num">{c.errores || "—"}</td>
                  <td className="num">{new Date(c.created_at).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</td>
                </tr>
              );
            })}
            {campanas.length === 0 && <tr><td colSpan={6} className="vacio">Todavía no hay envíos.</td></tr>}
          </tbody>
        </table>
      </div>
      {abierta && <DetalleCampana campana={abierta} onCerrar={() => setAbierta(null)} />}
    </>
  );
}

function DetalleCampana({ campana, onCerrar }: { campana: Campana; onCerrar: () => void }) {
  const db = supabaseNavegador();
  const [envios, setEnvios] = useState<any[]>([]);
  const [respondieron, setRespondieron] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      const { data } = await db.from("campana_envios").select("id, telefono, estado, detalle, lead_id, leads(nombre)")
        .eq("campana_id", campana.id).order("created_at");
      setEnvios(data ?? []);
      // ¿Quién contestó después del envío?
      const ids = (data ?? []).map((e: any) => e.lead_id).filter(Boolean);
      if (ids.length) {
        const { data: convs } = await db.from("conversaciones").select("id, lead_id").in("lead_id", ids.slice(0, 500));
        const porConv = new Map((convs ?? []).map((c: any) => [c.id, c.lead_id]));
        if (porConv.size) {
          const { data: resp } = await db.from("mensajes").select("conversacion_id")
            .in("conversacion_id", [...porConv.keys()]).eq("direccion", "entrante").gte("created_at", campana.created_at).limit(5000);
          setRespondieron(new Set((resp ?? []).map((m: any) => porConv.get(m.conversacion_id))));
        }
      }
    })();
  }, [db, campana]);

  return (
    <Ventana titulo={campana.nombre} onCerrar={onCerrar} lado>
      <div className="kpi-fila" style={{ marginBottom: 12 }}>
        <Pastilla tono="bien">{campana.enviados} enviados</Pastilla>
        {campana.errores > 0 && <Pastilla tono="mal">{campana.errores} con error</Pastilla>}
        <Pastilla tono="acento">{respondieron.size} respondieron</Pastilla>
      </div>
      <div className="tabla-caja">
        <table className="tabla">
          <thead><tr><th>Lead</th><th>Teléfono</th><th>Estado</th></tr></thead>
          <tbody>
            {envios.map((e) => (
              <tr key={e.id}>
                <td>{e.leads?.nombre ?? "—"}{respondieron.has(e.lead_id) && <> <Pastilla tono="acento">respondió</Pastilla></>}</td>
                <td className="num">{e.telefono}</td>
                <td title={e.detalle ?? ""}>
                  <Pastilla tono={e.estado === "enviado" ? "bien" : e.estado === "error" ? "mal" : "info"}>{e.estado}</Pastilla>
                  {e.detalle && <div><small style={{ color: "var(--texto-3)" }}>{e.detalle}</small></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Ventana>
  );
}

/* ---------------- Plantillas ---------------- */

function Plantillas({ plantillas, recargar, avisar }: { plantillas: Plantilla[]; recargar: () => void; avisar: (m: string) => void }) {
  const [editando, setEditando] = useState<Partial<Plantilla> | null>(null);
  return (
    <>
      <div className="aviso-caja">
        Las plantillas se crean y aprueban en Meta (Administrador de WhatsApp → Plantillas de mensajes). Aquí das de alta cada una con su
        <b> nombre exacto</b> e <b>idioma</b> como aparecen en Meta, y subes la imagen del encabezado si la lleva.
      </div>
      <div className="herramientas">
        <div className="espacio" />
        <button className="boton primario" onClick={() => setEditando({ idioma: "es_MX", activa: true })}><Plus size={15} /> Agregar plantilla</button>
      </div>
      <div className="tabla-caja">
        <table className="tabla">
          <thead><tr><th>Nombre en el CRM</th><th>Nombre en Meta</th><th>Idioma</th><th>Desarrollo</th><th>Imagen</th><th>Estado</th></tr></thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id} onClick={() => setEditando(p)}>
                <td>{p.titulo || "—"}</td>
                <td><span className="codigo">{p.nombre}</span></td>
                <td>{p.idioma}</td>
                <td>{p.desarrollo ?? "—"}</td>
                <td>{p.imagen_path ? <Pastilla tono="bien">Lista</Pastilla> : <Pastilla tono="aviso">Falta</Pastilla>}</td>
                <td>{p.activa ? <Pastilla tono="bien">Activa</Pastilla> : <Pastilla>Inactiva</Pastilla>}</td>
              </tr>
            ))}
            {plantillas.length === 0 && <tr><td colSpan={6} className="vacio">Sin plantillas. Corre el archivo schema.sql en Supabase o agrega una.</td></tr>}
          </tbody>
        </table>
      </div>
      {editando && <EditarPlantilla inicial={editando} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); recargar(); avisar("Plantilla guardada"); }} />}
    </>
  );
}

function EditarPlantilla({ inicial, onCerrar, onGuardado }: { inicial: Partial<Plantilla>; onCerrar: () => void; onGuardado: () => void }) {
  const db = supabaseNavegador();
  const [p, setP] = useState<Partial<Plantilla>>(inicial);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [vista, setVista] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (archivo) { const u = URL.createObjectURL(archivo); setVista(u); return () => URL.revokeObjectURL(u); }
    if (p.imagen_path) db.storage.from("archivos").createSignedUrl(p.imagen_path, 600).then(({ data }) => setVista(data?.signedUrl ?? null));
  }, [archivo, p.imagen_path, db]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const nombre = (p.nombre ?? "").trim();
      if (!/^[a-z0-9_]+$/.test(nombre)) throw new Error("El nombre en Meta solo lleva minúsculas, números y guion bajo (ej. descuentos_vro).");
      let imagen_path = p.imagen_path ?? null;
      if (archivo) imagen_path = await subirArchivo("plantillas", archivo);
      const fila = {
        nombre, idioma: (p.idioma ?? "es_MX").trim(), titulo: p.titulo?.trim() || null, texto: p.texto?.trim() || null,
        desarrollo: p.desarrollo || null, activa: p.activa ?? true, imagen_path,
      };
      const r = p.id ? await db.from("plantillas").update(fila).eq("id", p.id) : await db.from("plantillas").insert(fila);
      if (r.error) throw new Error(r.error.code === "23505" ? "Ya existe una plantilla con ese nombre e idioma." : r.error.message);
      onGuardado();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Ventana titulo={p.id ? "Editar plantilla" : "Nueva plantilla"} onCerrar={onCerrar}
      pie={<><button className="boton" onClick={onCerrar}>Cancelar</button><button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button></>}>
      <div className="formulario">
        <div className="campo">
          <label htmlFor="p-titulo">Nombre en el CRM</label>
          <input id="p-titulo" className="entrada" placeholder="Descuentos Vivia Roma" value={p.titulo ?? ""} onChange={(e) => setP({ ...p, titulo: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="p-nombre">Nombre exacto en Meta</label>
          <input id="p-nombre" className="entrada" placeholder="descuentos_vro" value={p.nombre ?? ""} onChange={(e) => setP({ ...p, nombre: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="p-idioma">Idioma</label>
          <input id="p-idioma" className="entrada" placeholder="es_MX" value={p.idioma ?? ""} onChange={(e) => setP({ ...p, idioma: e.target.value })} />
        </div>
        <div className="campo">
          <label htmlFor="p-desarrollo">Desarrollo</label>
          <select id="p-desarrollo" className="entrada" value={p.desarrollo ?? ""} onChange={(e) => setP({ ...p, desarrollo: e.target.value })}>
            <option value="">—</option>
            {DESARROLLOS.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
        <div className="campo ancho">
          <label htmlFor="p-texto">Texto (cópialo de Meta, solo para la vista previa)</label>
          <textarea id="p-texto" className="entrada" rows={4} value={p.texto ?? ""} onChange={(e) => setP({ ...p, texto: e.target.value })} />
        </div>
        <div className="campo ancho">
          <label htmlFor="p-imagen">Imagen del encabezado</label>
          <input id="p-imagen" type="file" accept="image/jpeg,image/png" className="entrada" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
          {vista ? <img src={vista} alt="Imagen de la plantilla" style={{ maxWidth: 260, borderRadius: 8, marginTop: 6 }} />
            : <small style={{ color: "var(--texto-3)" }}><ImageIcon size={12} /> Si la plantilla lleva imagen en Meta, súbela aquí (JPG o PNG, máx. 5 MB).</small>}
        </div>
        <label className="campo ancho" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <input type="checkbox" checked={p.activa ?? true} onChange={(e) => setP({ ...p, activa: e.target.checked })} /> Activa (aparece al hacer envíos)
        </label>
        {error && <div className="error-caja ancho">{error}</div>}
      </div>
    </Ventana>
  );
}
