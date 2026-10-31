"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Plus, Trash2, UserPlus } from "lucide-react";
import { Barra } from "@/components/Marco";
import { Pastilla, Ventana, useToast } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { DESARROLLOS } from "@/lib/tipos";

type Asesor = { id: string; nombre: string | null; email: string | null; rol: string; activo: boolean; telefono: string | null };
type Guardia = { id: string; asesor_id: string; fecha: string; hora_inicio: string; hora_fin: string; desarrollo: string | null };

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const COLORES = ["#2563eb", "#16a34a", "#d97706", "#db2777", "#7c3aed", "#0891b2", "#dc2626", "#65a30d"];

/** Fecha AAAA-MM-DD de hoy en Monterrey */
function hoyMty() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey" }).format(new Date());
}
function horaMty() {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "America/Monterrey", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
}
function sumarDias(f: string, n: number) {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function lunesDe(f: string) {
  const d = new Date(`${f}T12:00:00Z`);
  return sumarDias(f, -((d.getUTCDay() + 6) % 7));
}
const corta = (h: string) => h.slice(0, 5);
const fechaBonita = (f: string) => new Date(`${f}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });

export default function Guardias() {
  const db = supabaseNavegador();
  const [toast, avisar] = useToast();
  const [asesores, setAsesores] = useState<Asesor[]>([]);
  const [guardias, setGuardias] = useState<Guardia[]>([]);
  const [lunes, setLunes] = useState(() => lunesDe(hoyMty()));
  const [soyAdmin, setSoyAdmin] = useState(false);
  const [nueva, setNueva] = useState<string | null>(null); // fecha del día donde se abrió "agregar"
  const [altaAsesor, setAltaAsesor] = useState(false);

  const dias = useMemo(() => DIAS.map((n, i) => ({ nombre: n, fecha: sumarDias(lunes, i) })), [lunes]);

  const cargar = useCallback(async () => {
    const [{ data: a }, { data: g }, { data: auth }] = await Promise.all([
      db.from("perfiles").select("id, nombre, email, rol, activo, telefono").order("nombre"),
      db.from("guardias").select("*").gte("fecha", lunes).lte("fecha", sumarDias(lunes, 6)).order("hora_inicio"),
      db.auth.getUser(),
    ]);
    setAsesores((a ?? []) as Asesor[]);
    setGuardias((g ?? []) as Guardia[]);
    setSoyAdmin(!!(a ?? []).find((x: any) => x.id === auth.user?.id && x.rol === "admin"));
  }, [db, lunes]);
  useEffect(() => { cargar(); }, [cargar]);

  const color = (id: string) => COLORES[Math.max(0, asesores.findIndex((a) => a.id === id)) % COLORES.length];
  const nombre = (id: string) => { const a = asesores.find((x) => x.id === id); return a?.nombre || a?.email || "—"; };

  const hoy = hoyMty();
  const ahora = horaMty();
  const deGuardia = guardias.filter((g) => g.fecha === hoy && corta(g.hora_inicio) <= ahora && corta(g.hora_fin) > ahora);

  async function borrar(id: string) {
    await db.from("guardias").delete().eq("id", id);
    setGuardias((gs) => gs.filter((g) => g.id !== id));
  }

  async function copiarSemana() {
    if (!guardias.length) return avisar("Esta semana no tiene guardias para copiar.");
    const sig = sumarDias(lunes, 7);
    const { count } = await db.from("guardias").select("id", { count: "exact", head: true }).gte("fecha", sig).lte("fecha", sumarDias(sig, 6));
    if (count && !confirm(`La semana siguiente ya tiene ${count} guardias. ¿Agregar las de esta semana de todos modos?`)) return;
    const filas = guardias.map(({ asesor_id, fecha, hora_inicio, hora_fin, desarrollo }) => ({ asesor_id, fecha: sumarDias(fecha, 7), hora_inicio, hora_fin, desarrollo }));
    const { error } = await db.from("guardias").insert(filas);
    if (error) return avisar(error.message);
    avisar(`Copiadas ${filas.length} guardias a la semana siguiente.`);
    setLunes(sig);
  }

  async function activar(a: Asesor) {
    const r = await fetch("/api/asesores", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: a.id, activo: !a.activo }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return avisar(d.error ?? "No se pudo cambiar.");
    cargar();
  }

  return (
    <>
      <Barra titulo="Guardias" icono={<CalendarClock size={18} />}>
        {soyAdmin && <button className="boton" onClick={() => setAltaAsesor(true)}><UserPlus size={15} /> Nuevo asesor</button>}
      </Barra>
      <div className="contenido">
        <div className="tarjeta">
          <div className="tarjeta-cuerpo" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <b>De guardia ahora ({ahora}):</b>
            {deGuardia.length
              ? deGuardia.map((g) => <span key={g.id} className="guardia-chip" style={{ borderColor: color(g.asesor_id) }}>{nombre(g.asesor_id)} · hasta {corta(g.hora_fin)}{g.desarrollo ? ` · ${g.desarrollo}` : ""}</span>)
              : <span style={{ color: "var(--texto-3)" }}>Nadie. Los leads nuevos se quedan sin asesor hasta que alguien los tome.</span>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
          <button className="boton icono" onClick={() => setLunes(sumarDias(lunes, -7))} aria-label="Semana anterior"><ChevronLeft size={17} /></button>
          <b>Semana del {fechaBonita(lunes)} al {fechaBonita(sumarDias(lunes, 6))}</b>
          <button className="boton icono" onClick={() => setLunes(sumarDias(lunes, 7))} aria-label="Semana siguiente"><ChevronRight size={17} /></button>
          {lunes !== lunesDe(hoy) && <button className="boton" onClick={() => setLunes(lunesDe(hoy))}>Hoy</button>}
          <div style={{ flex: 1 }} />
          <button className="boton" onClick={copiarSemana}><Copy size={15} /> Copiar a la semana siguiente</button>
          <button className="boton primario" onClick={() => setNueva(dias.find((d) => d.fecha >= hoy)?.fecha ?? lunes)}><Plus size={15} /> Agregar guardia</button>
        </div>

        <div className="semana-guardias">
          {dias.map((d) => {
            const delDia = guardias.filter((g) => g.fecha === d.fecha);
            return (
              <div key={d.fecha} className={`dia-guardia ${d.fecha === hoy ? "hoy" : ""}`}>
                <div className="dia-cabeza">
                  <b>{d.nombre}</b> <small>{fechaBonita(d.fecha)}</small>
                </div>
                {delDia.map((g) => (
                  <div key={g.id} className="turno" style={{ borderLeftColor: color(g.asesor_id) }}>
                    <div>
                      <b>{nombre(g.asesor_id)}</b>
                      <small>{corta(g.hora_inicio)} – {corta(g.hora_fin)}{g.desarrollo ? ` · ${g.desarrollo}` : ""}</small>
                    </div>
                    <button className="boton icono" onClick={() => borrar(g.id)} aria-label="Quitar guardia"><Trash2 size={14} /></button>
                  </div>
                ))}
                <button className="boton agregar-turno" onClick={() => setNueva(d.fecha)}><Plus size={14} /> Agregar</button>
              </div>
            );
          })}
        </div>

        <div className="tarjeta" style={{ marginTop: 16 }}>
          <div className="tarjeta-cabeza"><h2>Equipo</h2></div>
          <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {asesores.map((a) => (
              <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className="punto-color" style={{ background: color(a.id) }} />
                <b>{a.nombre || a.email}</b>
                <small style={{ color: "var(--texto-3)" }}>{a.email}{a.telefono ? ` · ${a.telefono}` : ""}</small>
                <Pastilla tono={a.rol === "admin" ? "info" : "neutro"}>{a.rol === "admin" ? "Administrador" : "Asesor"}</Pastilla>
                {!a.activo && <Pastilla tono="mal">Desactivado</Pastilla>}
                {soyAdmin && a.rol !== "admin" && (
                  <button className="boton" style={{ marginLeft: "auto" }} onClick={() => activar(a)}>{a.activo ? "Desactivar" : "Activar"}</button>
                )}
              </div>
            ))}
            <small style={{ color: "var(--texto-3)" }}>
              Cada lead nuevo (formularios, WhatsApp, Zapier) se asigna al asesor que esté de guardia en ese momento. Si hay dos o más al mismo tiempo, se reparte al que lleva menos leads ese día.
            </small>
          </div>
        </div>
      </div>

      {nueva && <NuevaGuardia fecha={nueva} dias={dias} asesores={asesores.filter((a) => a.activo)} onCerrar={() => setNueva(null)} onListo={(n) => { setNueva(null); avisar(`Guardia guardada${n > 1 ? ` (${n} días)` : ""}.`); cargar(); }} />}
      {altaAsesor && <AltaAsesor onCerrar={() => setAltaAsesor(false)} onListo={() => { setAltaAsesor(false); avisar("Asesor dado de alta. Ya puede entrar con su correo y contraseña."); cargar(); }} />}
      {toast}
    </>
  );
}

function NuevaGuardia({ fecha, dias, asesores, onCerrar, onListo }: {
  fecha: string; dias: { nombre: string; fecha: string }[]; asesores: Asesor[]; onCerrar: () => void; onListo: (n: number) => void;
}) {
  const db = supabaseNavegador();
  const [asesor, setAsesor] = useState(asesores.length === 1 ? asesores[0].id : "");
  const [elegidos, setElegidos] = useState<string[]>([fecha]);
  const [inicio, setInicio] = useState("09:00");
  const [fin, setFin] = useState("18:00");
  const [desarrollo, setDesarrollo] = useState("");
  const [semanas, setSemanas] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const alternar = (f: string) => setElegidos((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]));

  async function guardar() {
    setError(null);
    if (!asesor) return setError("Elige al asesor.");
    if (!elegidos.length) return setError("Elige al menos un día.");
    if (fin <= inicio) return setError("La hora de salida debe ser después de la de entrada.");
    setGuardando(true);
    const filas = [];
    for (let s = 0; s < semanas; s++) {
      for (const f of elegidos) filas.push({ asesor_id: asesor, fecha: sumarDias(f, 7 * s), hora_inicio: inicio, hora_fin: fin, desarrollo: desarrollo || null });
    }
    const { error } = await db.from("guardias").insert(filas);
    setGuardando(false);
    if (error) return setError(error.message);
    onListo(filas.length);
  }

  return (
    <Ventana titulo="Agregar guardia" onCerrar={onCerrar} pie={
      <>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
        <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
      </>
    }>
      <div className="formulario">
        <div className="campo">
          <label htmlFor="g-asesor">Asesor</label>
          <select id="g-asesor" className="entrada" value={asesor} onChange={(e) => setAsesor(e.target.value)}>
            <option value="">Elige…</option>
            {asesores.map((a) => <option key={a.id} value={a.id}>{a.nombre || a.email}</option>)}
          </select>
        </div>
        <div className="campo">
          <label>Días</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {dias.map((d) => (
              <button key={d.fecha} type="button" className={`boton ${elegidos.includes(d.fecha) ? "primario" : ""}`} onClick={() => alternar(d.fecha)}>
                {d.nombre.slice(0, 3)} {fechaBonita(d.fecha)}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div className="campo"><label htmlFor="g-ini">De</label><input id="g-ini" type="time" className="entrada" value={inicio} onChange={(e) => setInicio(e.target.value)} /></div>
          <div className="campo"><label htmlFor="g-fin">A</label><input id="g-fin" type="time" className="entrada" value={fin} onChange={(e) => setFin(e.target.value)} /></div>
        </div>
        <div className="campo">
          <label htmlFor="g-des">Leads de</label>
          <select id="g-des" className="entrada" value={desarrollo} onChange={(e) => setDesarrollo(e.target.value)}>
            <option value="">Todos los desarrollos</option>
            {DESARROLLOS.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
          </select>
        </div>
        <div className="campo">
          <label htmlFor="g-sem">Repetir</label>
          <select id="g-sem" className="entrada" value={semanas} onChange={(e) => setSemanas(Number(e.target.value))}>
            <option value={1}>Solo esta semana</option>
            {[2, 4, 8, 12].map((n) => <option key={n} value={n}>{n} semanas</option>)}
          </select>
        </div>
        {error && <div className="error-caja">{error}</div>}
      </div>
    </Ventana>
  );
}

function AltaAsesor({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [f, setF] = useState({ nombre: "", email: "", telefono: "", password: "", rol: "asesor" });
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    setError(null);
    setGuardando(true);
    const r = await fetch("/api/asesores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const d = await r.json().catch(() => ({}));
    setGuardando(false);
    if (!r.ok) return setError(d.error ?? "No se pudo dar de alta.");
    onListo();
  }

  return (
    <Ventana titulo="Nuevo asesor" onCerrar={onCerrar} pie={
      <>
        <button className="boton" onClick={onCerrar}>Cancelar</button>
        <button className="boton primario" onClick={guardar} disabled={guardando}>{guardando ? "Creando…" : "Dar de alta"}</button>
      </>
    }>
      <div className="formulario">
        <div className="campo"><label htmlFor="a-nom">Nombre</label><input id="a-nom" className="entrada" value={f.nombre} onChange={set("nombre")} /></div>
        <div className="campo"><label htmlFor="a-mail">Correo (con este entra al CRM)</label><input id="a-mail" type="email" className="entrada" value={f.email} onChange={set("email")} /></div>
        <div className="campo"><label htmlFor="a-tel">Teléfono</label><input id="a-tel" className="entrada" inputMode="tel" value={f.telefono} onChange={set("telefono")} /></div>
        <div className="campo"><label htmlFor="a-pass">Contraseña temporal (mínimo 8)</label><input id="a-pass" className="entrada" value={f.password} onChange={set("password")} autoComplete="new-password" /></div>
        <div className="campo">
          <label htmlFor="a-rol">Permisos</label>
          <select id="a-rol" className="entrada" value={f.rol} onChange={set("rol")}>
            <option value="asesor">Asesor</option>
            <option value="admin">Administrador</option>
          </select>
        </div>
        {error && <div className="error-caja">{error}</div>}
      </div>
    </Ventana>
  );
}
