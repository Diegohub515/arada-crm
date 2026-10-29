"use client";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Bot, Search, Send, Sparkles, UserRound } from "lucide-react";
import { Barra } from "@/components/Marco";
import { FichaLead, PastillaEtapa } from "@/components/leads";
import { IconoRed } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import type { Conversacion, Lead, Mensaje } from "@/lib/tipos";
import { hora, iniciales, relativo } from "@/lib/formato";

type ConvConLead = Conversacion & { leads: Pick<Lead, "id" | "nombre" | "etapa"> | null };

export default function PaginaBandeja() {
  return <Suspense><Bandeja /></Suspense>;
}

function Bandeja() {
  const db = supabaseNavegador();
  const router = useRouter();
  const params = useSearchParams();
  const activaId = params.get("c");
  const [convs, setConvs] = useState<ConvConLead[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todas");

  const cargar = useCallback(async () => {
    const { data, error } = await db
      .from("conversaciones").select("*, leads(id, nombre, etapa)")
      .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false }).limit(500);
    if (error) setError(error.message);
    else setConvs(data as ConvConLead[]);
  }, [db]);

  useEffect(() => {
    cargar();
    const canal = db.channel("bandeja-convs")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversaciones" }, cargar)
      .subscribe();
    return () => { db.removeChannel(canal); };
  }, [db, cargar]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (convs ?? []).filter((c) => {
      if (filtro === "no_leidas" && c.no_leidos === 0) return false;
      if (filtro !== "todas" && filtro !== "no_leidas" && !(c.plataforma ?? "").includes(filtro)) return false;
      return !t || `${c.contacto_nombre ?? ""} ${c.contacto_id ?? ""} ${c.leads?.nombre ?? ""} ${c.ultimo_mensaje ?? ""}`.toLowerCase().includes(t);
    });
  }, [convs, q, filtro]);

  const activa = convs?.find((c) => c.id === activaId) ?? null;
  const abrir = (id: string | null) => router.replace(id ? `/bandeja?c=${id}` : "/bandeja");

  return (
    <>
      <Barra titulo="Bandeja" />
      <div className={`bandeja ${activa ? "con-chat" : ""}`}>
        <aside className="bandeja-lista">
          <div className="herramientas" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <div className="buscador">
              <Search size={15} />
              <input id="buscar-chat" className="entrada" placeholder="Buscar chat…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="segmentos" style={{ overflowX: "auto" }}>
              {[["todas", "Todas"], ["no_leidas", "No leídas"], ["whatsapp", "WhatsApp"], ["instagram", "Instagram"], ["facebook", "Messenger"]].map(([id, n]) => (
                <button key={id} className={filtro === id ? "activo" : ""} onClick={() => setFiltro(id)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="chats">
            {error && <div className="error-caja" style={{ margin: 12 }}>{error}</div>}
            {visibles.map((c) => {
              const nombre = c.leads?.nombre && c.leads.nombre !== "Sin nombre" ? c.leads.nombre : c.contacto_nombre || c.contacto_id || "Contacto";
              return (
                <button key={c.id} className={`chat-item ${c.id === activaId ? "activo" : ""}`} onClick={() => abrir(c.id)}>
                  <span className="avatar">{iniciales(nombre)}</span>
                  <div>
                    <div className="arriba">
                      <IconoRed plataforma={c.plataforma} />
                      <b>{nombre}</b>
                      <small>{relativo(c.ultimo_mensaje_at)}</small>
                    </div>
                    <div className="arriba">
                      <p style={{ flex: 1 }}>{c.ultimo_mensaje ?? ""}</p>
                      {c.no_leidos > 0 && <span className="no-leidos">{c.no_leidos}</span>}
                    </div>
                  </div>
                </button>
              );
            })}
            {convs && visibles.length === 0 && (
              <div className="vacio">
                <b>{convs.length ? "Sin resultados" : "Aún no hay chats"}</b>
                {convs.length ? "Prueba otro filtro." : "Cuando conectes Zernio, aquí aparecerán los mensajes de WhatsApp, Instagram y Messenger."}
              </div>
            )}
          </div>
        </aside>
        {activa ? <Chat conv={activa} onVolver={() => abrir(null)} /> : (
          <section className="conversacion" style={{ display: "grid", placeItems: "center" }}>
            <div className="vacio"><b>Elige un chat</b>Contesta desde aquí y el mensaje sale por la misma red donde te escribieron.</div>
          </section>
        )}
      </div>
    </>
  );
}

function Chat({ conv, onVolver }: { conv: ConvConLead; onVolver: () => void }) {
  const db = supabaseNavegador();
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sugiriendo, setSugiriendo] = useState(false);
  const [ficha, setFicha] = useState(false);
  const abajo = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    const { data } = await db.from("mensajes").select("*").eq("conversacion_id", conv.id).order("created_at").limit(500);
    setMensajes((data ?? []) as Mensaje[]);
  }, [db, conv.id]);

  useEffect(() => {
    cargar();
    setError(null);
    setTexto("");
    if (conv.no_leidos > 0) db.from("conversaciones").update({ no_leidos: 0 }).eq("id", conv.id).then(() => {});
    const canal = db.channel(`chat-${conv.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "mensajes", filter: `conversacion_id=eq.${conv.id}` }, cargar)
      .subscribe();
    return () => { db.removeChannel(canal); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.id]);

  useEffect(() => { abajo.current?.scrollIntoView({ block: "end" }); }, [mensajes.length]);

  async function enviar() {
    const t = texto.trim();
    if (!t || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await fetch("/api/mensajes/enviar", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversacionId: conv.id, texto: t }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error ?? "No se pudo enviar");
      setTexto("");
      if (d.aviso) setError(`Enviado con aviso: ${d.aviso}`);
      cargar();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setEnviando(false);
    }
  }

  const [agente, setAgente] = useState(conv.agente_activo);
  useEffect(() => setAgente(conv.agente_activo), [conv.agente_activo, conv.id]);
  async function alternarAgente() {
    const nuevo = !agente;
    setAgente(nuevo);
    const { error } = await db.from("conversaciones")
      .update({ agente_activo: nuevo, agente_motivo: nuevo ? null : "Pausado a mano" }).eq("id", conv.id);
    if (error) { setAgente(!nuevo); setError(error.message); }
  }

  async function sugerir() {
    setSugiriendo(true);
    setError(null);
    const r = await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accion: "respuesta", id: conv.id }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) setTexto(d.texto ?? "");
    else setError(d.error ?? "La IA no respondió");
    setSugiriendo(false);
  }

  const nombre = conv.leads?.nombre && conv.leads.nombre !== "Sin nombre" ? conv.leads.nombre : conv.contacto_nombre || conv.contacto_id || "Contacto";
  let diaAnterior = "";

  return (
    <section className="conversacion">
      <header className="conversacion-cabeza">
        <button className="boton icono boton-menu" onClick={onVolver} aria-label="Volver"><ArrowLeft size={17} /></button>
        <span className="avatar">{iniciales(nombre)}</span>
        <div>
          <b style={{ display: "flex", gap: 6, alignItems: "center" }}><IconoRed plataforma={conv.plataforma} /> {nombre}</b>
          <small>{conv.contacto_id ?? conv.plataforma ?? ""}</small>
        </div>
        {conv.leads && <PastillaEtapa etapa={conv.leads.etapa} />}
        <button className={`boton chico ${agente ? "agente-on" : ""}`} onClick={alternarAgente}
          title={agente ? "El agente contesta este chat. Clic para pausarlo." : `Agente pausado${conv.agente_motivo ? ": " + conv.agente_motivo : ""}. Clic para activarlo.`}>
          <Bot size={14} /> {agente ? "Agente activo" : "Agente pausado"}
        </button>
        {conv.leads ? (
          <button className="boton chico" onClick={() => setFicha(true)}><UserRound size={14} /> Ficha</button>
        ) : (
          <Link className="boton chico" href="/leads">Ver leads</Link>
        )}
      </header>
      <div className="mensajes">
        {mensajes.map((m) => {
          const dia = new Date(m.created_at).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
          const separador = dia !== diaAnterior ? <div className="dia" key={`d-${m.id}`}>{dia}</div> : null;
          diaAnterior = dia;
          return [
            separador,
            <div key={m.id} className={`globo ${m.direccion} ${m.estado === "error" ? "error" : ""}`}>
              {m.autor === "agente" && <span className="autor-agente"><Bot size={11} /> Agente IA</span>}
              {m.texto}
              {(m.adjuntos ?? []).map((a, i) => a?.url ? <div key={i}><a href={a.url} target="_blank" rel="noopener noreferrer">Ver {a.type ?? "archivo"}</a></div> : null)}
              <small>{hora(m.created_at)}{m.estado === "error" ? " · no enviado" : ""}</small>
            </div>,
          ];
        })}
        {mensajes.length === 0 && <div className="vacio">Sin mensajes guardados todavía.</div>}
        <div ref={abajo} />
      </div>
      {!agente && conv.agente_motivo && (
        <div className="aviso-caja" style={{ margin: "0 14px 8px" }}>
          El agente está pausado en este chat: {conv.agente_motivo}. Contéstale tú o reactívalo arriba.
        </div>
      )}
      {error && <div className="error-caja" style={{ margin: "0 14px 8px" }}>{error}</div>}
      {!conv.zernio_account_id ? (
        <div className="aviso-caja" style={{ margin: "0 14px 12px" }}>
          Este chat entra por Zapier: el agente IA contesta solo; si lo atiendes tú, contesta desde WhatsApp. Para contestar desde aquí hay que conectar el número a Zernio.
        </div>
      ) : (
      <div className="redactor">
        <button className="boton icono" onClick={sugerir} disabled={sugiriendo} title="Sugerir respuesta con IA" aria-label="Sugerir respuesta con IA">
          <Sparkles size={16} />
        </button>
        <textarea
          id="redactor"
          className="entrada"
          placeholder={sugiriendo ? "La IA está escribiendo…" : "Escribe tu respuesta… (Enter envía, Shift+Enter salto de línea)"}
          value={texto}
          rows={1}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); } }}
        />
        <button className="boton primario" onClick={enviar} disabled={enviando || !texto.trim()}>
          <Send size={15} /> {enviando ? "Enviando…" : "Enviar"}
        </button>
      </div>
      )}
      {ficha && conv.leads && <FichaLead id={conv.leads.id} onCerrar={() => setFicha(false)} />}
    </section>
  );
}
