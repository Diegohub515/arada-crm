"use client";
import { useCallback, useEffect, useState } from "react";
import { Check, GraduationCap, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { Pastilla } from "@/components/ui";

type Leccion = {
  id: string; texto: string; categoria: string; origen: string; estado: string;
  evidencia: string | null; created_at: string;
};
type Analisis = { id: string; desde: string; hasta: string; resumen: string | null; metricas: any; created_at: string };

const CATEGORIAS: Record<string, { nombre: string; tono: string }> = {
  dato: { nombre: "Dato", tono: "info" },
  estilo: { nombre: "Estilo", tono: "acento" },
  flujo: { nombre: "Qué preguntar", tono: "neutro" },
  evitar: { nombre: "Evitar", tono: "mal" },
};
const ORIGEN: Record<string, string> = { analisis: "Análisis de chats", asesor: "Corrección de asesor", manual: "Agregada a mano" };

/** Lecciones que el bot de WhatsApp lee en cada mensaje. Solo cuentan las aprobadas. */
export default function Aprendizaje({ avisar }: { avisar: (m: string) => void }) {
  const db = supabaseNavegador();
  const [lecciones, setLecciones] = useState<Leccion[]>([]);
  const [analisis, setAnalisis] = useState<Analisis | null>(null);
  const [analizando, setAnalizando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [borrador, setBorrador] = useState("");
  const [nueva, setNueva] = useState("");
  const [catNueva, setCatNueva] = useState("dato");
  const [error, setError] = useState<string | null>(null);
  const [verDescartadas, setVerDescartadas] = useState(false);

  const cargar = useCallback(async () => {
    const [l, a] = await Promise.all([
      db.from("agente_lecciones").select("*").order("created_at", { ascending: false }).limit(300),
      db.from("agente_analisis").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (l.error) { setError(`${l.error.message}. ¿Ya corriste supabase/schema.sql?`); return; }
    setLecciones((l.data ?? []) as Leccion[]);
    setAnalisis((a.data ?? null) as Analisis | null);
  }, [db]);
  useEffect(() => { cargar(); }, [cargar]);

  async function cambiar(id: string, cambios: Partial<Leccion>) {
    const extra = cambios.estado === "aprobada" ? { aprobada_at: new Date().toISOString() } : {};
    const { error } = await db.from("agente_lecciones").update({ ...cambios, ...extra }).eq("id", id);
    if (error) return avisar(error.message);
    setLecciones((ls) => ls.map((l) => (l.id === id ? { ...l, ...cambios } : l)));
    if (cambios.estado === "aprobada") avisar("Aprobada: el bot ya la usa desde el siguiente mensaje");
  }

  async function agregar() {
    const t = nueva.trim();
    if (!t) return;
    const { data: u } = await db.auth.getUser();
    const { error } = await db.from("agente_lecciones").insert({
      texto: t, categoria: catNueva, origen: "manual", estado: "aprobada", aprobada_at: new Date().toISOString(), creado_por: u.user?.id,
    });
    if (error) return avisar(error.message);
    setNueva("");
    avisar("Lección agregada y aprobada");
    cargar();
  }

  async function analizar() {
    setAnalizando(true);
    setError(null);
    try {
      const r = await fetch("/api/agente/analizar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dias: 14 }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo analizar");
      avisar(d.lecciones ? `${d.lecciones} lecciones nuevas para revisar` : "Análisis listo, sin lecciones nuevas");
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAnalizando(false);
    }
  }

  const pendientes = lecciones.filter((l) => l.estado === "pendiente");
  const aprobadas = lecciones.filter((l) => l.estado === "aprobada");
  const descartadas = lecciones.filter((l) => l.estado === "descartada");
  const m = analisis?.metricas;

  const fila = (l: Leccion, acciones: React.ReactNode) => (
    <div key={l.id} className="leccion">
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Pastilla tono={CATEGORIAS[l.categoria]?.tono ?? "neutro"}>{CATEGORIAS[l.categoria]?.nombre ?? l.categoria}</Pastilla>
        <small style={{ color: "var(--texto-3)" }}>{ORIGEN[l.origen] ?? l.origen} · {new Date(l.created_at).toLocaleDateString("es-MX")}</small>
        <div className="espacio" style={{ flex: 1 }} />
        {acciones}
      </div>
      {editando === l.id ? (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <textarea className="entrada" rows={2} value={borrador} onChange={(e) => setBorrador(e.target.value)} aria-label="Editar lección" />
          <button className="boton icono" aria-label="Guardar" onClick={() => { cambiar(l.id, { texto: borrador.trim() }); setEditando(null); }}><Check size={15} /></button>
        </div>
      ) : (
        <p style={{ margin: "6px 0 0" }}>{l.texto}</p>
      )}
      {l.evidencia && <small style={{ color: "var(--texto-3)", display: "block", marginTop: 4 }}>Por qué: {l.evidencia}</small>}
    </div>
  );

  return (
    <div className="tarjeta">
      <div className="tarjeta-cabeza">
        <h2 style={{ display: "flex", gap: 8, alignItems: "center" }}><GraduationCap size={17} /> Aprendizaje del bot de WhatsApp</h2>
        <div className="espacio" />
        <button className="boton chico" onClick={analizar} disabled={analizando}>
          <Sparkles size={14} /> {analizando ? "Analizando chats… (1-2 min)" : "Analizar chats ahora"}
        </button>
      </div>
      <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <p style={{ margin: 0, color: "var(--texto-2)" }}>
          Cada lunes el CRM revisa los chats de la semana y propone lecciones. Las que <b>apruebes</b> las lee el bot en cada mensaje.
          También salen de los 👎 que marquen los asesores en la Bandeja.
        </p>
        {error && <div className="error-caja">{error}</div>}

        {analisis && (
          <div className="aviso-caja" style={{ whiteSpace: "pre-wrap" }}>
            <b>Último análisis ({new Date(analisis.created_at).toLocaleDateString("es-MX", { dateStyle: "medium" })})</b>
            {m && <div style={{ margin: "6px 0" }}>
              {m.chats} chats · {m.pct_siguieron}% siguieron la plática · {m.pasados_a_asesor} pasados a asesor · {m.llegaron_a_cita_o_mas} llegaron a cita o más
            </div>}
            {analisis.resumen}
          </div>
        )}

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Por revisar ({pendientes.length})</h3>
          {pendientes.length === 0 && <small style={{ color: "var(--texto-3)" }}>No hay lecciones pendientes.</small>}
          {pendientes.map((l) => fila(l, <>
            <button className="boton chico primario" onClick={() => cambiar(l.id, { estado: "aprobada" })}><Check size={13} /> Aprobar</button>
            <button className="boton icono" aria-label="Editar" onClick={() => { setEditando(l.id); setBorrador(l.texto); }}><Pencil size={14} /></button>
            <button className="boton icono" aria-label="Descartar" onClick={() => cambiar(l.id, { estado: "descartada" })}><X size={14} /></button>
          </>))}
        </div>

        <div>
          <h3 style={{ margin: "0 0 8px", fontSize: 14 }}>Lo que ya aprendió ({aprobadas.length})</h3>
          {aprobadas.map((l) => fila(l, <>
            <button className="boton icono" aria-label="Editar" onClick={() => { setEditando(l.id); setBorrador(l.texto); }}><Pencil size={14} /></button>
            <button className="boton icono" aria-label="Quitar" title="Quitar (el bot deja de usarla)" onClick={() => cambiar(l.id, { estado: "descartada" })}><Trash2 size={14} /></button>
          </>))}
          <div className="lista-nueva" style={{ marginTop: 8 }}>
            <select className="entrada" style={{ width: "auto" }} value={catNueva} onChange={(e) => setCatNueva(e.target.value)} aria-label="Tipo de lección">
              {Object.entries(CATEGORIAS).map(([k, v]) => <option key={k} value={k}>{v.nombre}</option>)}
            </select>
            <input className="entrada" placeholder="Enséñale algo, ej. Hay 1 cajón de estacionamiento por departamento" value={nueva}
              onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => e.key === "Enter" && agregar()} aria-label="Nueva lección" />
            <button className="boton icono" onClick={agregar} aria-label="Agregar lección"><Plus size={15} /></button>
          </div>
        </div>

        {descartadas.length > 0 && (
          <div>
            <button className="boton chico" onClick={() => setVerDescartadas((v) => !v)}>{verDescartadas ? "Ocultar" : "Ver"} descartadas ({descartadas.length})</button>
            {verDescartadas && descartadas.map((l) => fila(l, <button className="boton chico" onClick={() => cambiar(l.id, { estado: "aprobada" })}>Recuperar</button>))}
          </div>
        )}
      </div>
    </div>
  );
}
