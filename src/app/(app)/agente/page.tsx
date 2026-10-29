"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, RotateCcw, Send } from "lucide-react";
import { Barra } from "@/components/Marco";
import { useToast } from "@/components/ui";
import Aprendizaje from "@/components/Aprendizaje";
import { supabaseNavegador } from "@/lib/supabase/client";

type Config = { activo: boolean; nombre: string; instrucciones: string; horario_showroom: string | null; updated_at?: string };
type Turno = { role: "user" | "assistant"; content: string };

export default function Agente() {
  const db = supabaseNavegador();
  const [config, setConfig] = useState<Config | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [stats, setStats] = useState<{ enviados: number; pausados: number } | null>(null);
  const [toast, avisar] = useToast();

  // prueba
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [ultimo, setUltimo] = useState<any>(null);
  const abajo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    db.from("agente_config").select("*").eq("id", 1).maybeSingle().then(({ data, error }) => {
      if (error) setError(`${error.message}. ¿Ya corriste la parte del agente en supabase/schema.sql?`);
      else if (data) { setConfig(data as Config); setOriginal(JSON.stringify(data)); }
    });
    const hace30 = new Date(Date.now() - 30 * 86400000).toISOString();
    Promise.all([
      db.from("mensajes").select("id", { count: "exact", head: true }).eq("autor", "agente").gte("created_at", hace30),
      db.from("conversaciones").select("id", { count: "exact", head: true }).eq("agente_activo", false),
    ]).then(([a, b]) => setStats({ enviados: a.count ?? 0, pausados: b.count ?? 0 }));
  }, [db]);

  useEffect(() => { abajo.current?.scrollIntoView({ block: "end" }); }, [turnos.length, pensando]);

  const poner = (k: keyof Config, v: unknown) => setConfig((c) => (c ? { ...c, [k]: v } : c));
  const cambiado = config && JSON.stringify(config) !== original;

  async function guardar(cambios?: Partial<Config>) {
    if (!config) return;
    const nuevo = { ...config, ...cambios };
    setGuardando(true);
    const { error } = await db.from("agente_config").update({
      activo: nuevo.activo, nombre: nuevo.nombre, instrucciones: nuevo.instrucciones,
      horario_showroom: nuevo.horario_showroom, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setGuardando(false);
    if (error) return avisar(`No se guardó: ${error.message}`);
    setConfig(nuevo);
    setOriginal(JSON.stringify(nuevo));
    avisar(cambios && "activo" in cambios ? (nuevo.activo ? "Bot de WhatsApp encendido" : "Bot de WhatsApp apagado: solo contestan los asesores") : "Prompt guardado");
  }

  async function probar() {
    const t = texto.trim();
    if (!t || !config || pensando) return;
    const nuevos: Turno[] = [...turnos, { role: "user", content: t }];
    setTurnos(nuevos);
    setTexto("");
    setPensando(true);
    try {
      const r = await fetch("/api/ia", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion: "probar_agente", turnos: nuevos, config }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "La IA no respondió");
      setUltimo(d.salida);
      setTurnos([...nuevos, { role: "assistant", content: d.salida?.mensaje ?? "(sin respuesta)" }]);
    } catch (e: any) {
      avisar(e.message);
    } finally {
      setPensando(false);
    }
  }

  return (
    <>
      <Barra titulo="Agente IA" icono={<Bot size={18} />}>
        {config && (
          <label className="interruptor" htmlFor="agente-activo">
            <input id="agente-activo" type="checkbox" checked={config.activo} disabled={guardando}
              onChange={(e) => guardar({ activo: e.target.checked })} />
            Bot de WhatsApp: {config.activo ? "Encendido" : "Apagado"}
          </label>
        )}
      </Barra>
      <div className="contenido">
        <Aprendizaje avisar={avisar} />
        {error && <div className="error-caja">{error}</div>}
        {config && (
          <>
            <div className="rejilla rejilla-3">
              <div className="tarjeta kpi"><div className="kpi-titulo">Estado</div>
                <div className="kpi-valor" style={{ fontSize: 20 }}>
                  <span className={`pastilla ${config.activo ? "bien" : "aviso"}`}>{config.activo ? "Contestando chats" : "Apagado: solo contestan los asesores"}</span>
                </div>
              </div>
              <div className="tarjeta kpi"><div className="kpi-titulo">Mensajes enviados (30 días)</div><div className="kpi-valor">{stats?.enviados ?? "—"}</div></div>
              <div className="tarjeta kpi"><div className="kpi-titulo">Chats con una persona</div><div className="kpi-valor">{stats?.pausados ?? "—"}</div></div>
            </div>

            <div className="rejilla rejilla-2-1">
              <div className="tarjeta">
                <div className="tarjeta-cabeza"><h2>Prompt del agente</h2><div className="espacio" />
                  {config.updated_at && <small style={{ color: "var(--texto-3)" }}>Última edición {new Date(config.updated_at).toLocaleDateString("es-MX")}</small>}
                </div>
                <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div className="formulario">
                    <div className="campo">
                      <label htmlFor="ag-nombre">Nombre con el que se presenta</label>
                      <input id="ag-nombre" className="entrada" value={config.nombre} onChange={(e) => poner("nombre", e.target.value)} />
                    </div>
                    <div className="campo">
                      <label htmlFor="ag-horario">Horario del showroom</label>
                      <input id="ag-horario" className="entrada" value={config.horario_showroom ?? ""} onChange={(e) => poner("horario_showroom", e.target.value)} />
                    </div>
                    <div className="campo ancho">
                      <label htmlFor="ag-instr">Información del negocio e instrucciones</label>
                      <textarea id="ag-instr" className="entrada" style={{ minHeight: 280, lineHeight: 1.5 }}
                        value={config.instrucciones} onChange={(e) => poner("instrucciones", e.target.value)} />
                      <small style={{ color: "var(--texto-3)" }}>
                        Escribe aquí todo lo que el agente puede decir: ubicación, amenidades, esquemas de pago, promociones vigentes, qué no debe decir.
                        Lo que no esté aquí, el agente lo pasa a una persona en lugar de inventarlo.
                      </small>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                    <button className="boton" disabled={!cambiado} onClick={() => { const o = JSON.parse(original); setConfig(o); }}>Descartar</button>
                    <button className="boton primario" disabled={!cambiado || guardando} onClick={() => guardar()}>{guardando ? "Guardando…" : "Guardar prompt"}</button>
                  </div>
                </div>
              </div>

              <div className="tarjeta" style={{ display: "flex", flexDirection: "column", minHeight: 460 }}>
                <div className="tarjeta-cabeza">
                  <h2>Probar</h2><div className="espacio" />
                  <button className="boton chico" onClick={() => { setTurnos([]); setUltimo(null); }}><RotateCcw size={13} /> Reiniciar</button>
                </div>
                <small style={{ color: "var(--texto-3)", padding: "6px 16px 0" }}>Escribe como si fueras un cliente. Usa el prompt de la izquierda aunque no lo hayas guardado. No se envía a nadie.</small>
                <div className="mensajes" style={{ background: "var(--fondo)", margin: 12, borderRadius: 10, minHeight: 240 }}>
                  {turnos.map((t, i) => (
                    <div key={i} className={`globo ${t.role === "user" ? "entrante" : "saliente"}`}>
                      {t.role === "assistant" && <span className="autor-agente"><Bot size={11} /> {config.nombre}</span>}
                      {t.content}
                    </div>
                  ))}
                  {pensando && <div className="globo entrante" style={{ opacity: 0.6 }}>Escribiendo…</div>}
                  {!turnos.length && !pensando && <div className="vacio">Ejemplo: “Hola, vi su anuncio, ¿qué precio tienen?”</div>}
                  <div ref={abajo} />
                </div>
                {ultimo && (
                  <div style={{ padding: "0 14px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <span className={`pastilla ${ultimo.temperatura === "caliente" ? "mal" : ultimo.temperatura === "tibio" ? "aviso" : "info"}`}>{ultimo.temperatura}</span>
                    {ultimo.cita?.fecha && <span className="pastilla bien">Cita {ultimo.cita.fecha} {ultimo.cita.hora ?? ""}</span>}
                    {ultimo.pasar_a_humano && <span className="pastilla acento">Pasaría a una persona: {ultimo.motivo ?? ""}</span>}
                    {Object.entries(ultimo.datos ?? {}).map(([k, v]) => <span key={k} className="etiqueta">{k}: {String(v)}</span>)}
                  </div>
                )}
                <div className="redactor" style={{ borderRadius: "0 0 12px 12px" }}>
                  <textarea id="ag-prueba" className="entrada" rows={1} placeholder="Mensaje del cliente…" value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); probar(); } }} />
                  <button className="boton primario" onClick={probar} disabled={pensando || !texto.trim()}><Send size={15} /></button>
                </div>
              </div>
            </div>

            <div className="tarjeta">
              <div className="tarjeta-cabeza"><h2>Cómo trabaja</h2></div>
              <div className="tarjeta-cuerpo">
                <ul className="pasos">
                  <li>Contesta en segundos los mensajes nuevos de WhatsApp, Instagram y Messenger. Espera unos segundos por si el cliente manda varios mensajes seguidos.</li>
                  <li>Hace una pregunta a la vez para calificar: vivir o invertir, recámaras, presupuesto, cuándo compra. Lo que aprende lo guarda en la ficha del lead.</li>
                  <li>Ofrece visita al showroom. Si el cliente confirma, mueve el lead a “Cita en showroom” y deja el chat a tu equipo.</li>
                  <li>Se hace a un lado solo cuando: el cliente pide una persona, pregunta algo que no está en el prompt, o alguien del equipo contesta en ese chat.</li>
                  <li>En la Bandeja ves sus mensajes marcados como “Agente IA” y puedes pausarlo o reactivarlo en cada chat.</li>
                </ul>
              </div>
            </div>
          </>
        )}
        {!config && !error && <div className="vacio">Cargando…</div>}
      </div>
      {toast}
    </>
  );
}
