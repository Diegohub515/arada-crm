"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { Ventana, useOpciones } from "@/components/ui";
import { supabaseNavegador } from "@/lib/supabase/client";
import { normalizarTelefono } from "@/lib/formato";

type Plantilla = { id: string; nombre: string; titulo: string | null; texto: string | null };

/**
 * Manda una plantilla aprobada a un lead para abrir (o reabrir) su chat de WhatsApp.
 * Usa el mismo envío que Remarketing; el mensaje queda en la Bandeja y sale por tu número.
 */
export function EnviarPlantilla({ leadId, onEnviado, compacto }: { leadId: string; onEnviado: (convId: string | null) => void; compacto?: boolean }) {
  const db = supabaseNavegador();
  const [plantillas, setPlantillas] = useState<Plantilla[] | null>(null);
  const [elegida, setElegida] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.from("plantillas").select("id, nombre, titulo, texto").order("titulo").then(({ data }) => {
      setPlantillas((data ?? []) as Plantilla[]);
      if (data?.length === 1) setElegida(data[0].id);
    });
  }, [db]);

  async function enviar() {
    if (!elegida) return setError("Elige una plantilla.");
    setEnviando(true);
    setError(null);
    const r = await fetch("/api/remarketing/enviar", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ plantillaId: elegida, leadIds: [leadId], nombre: "Chat iniciado desde la Bandeja" }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) {
      setEnviando(false);
      return setError(d.error ?? "No se pudo enviar la plantilla.");
    }
    const { data: lead } = await db.from("leads").select("telefono").eq("id", leadId).single();
    const corto = normalizarTelefono(lead?.telefono);
    const { data: conv } = await db.from("conversaciones").select("id")
      .eq("zernio_conversation_id", `wa:${corto}`).maybeSingle();
    setEnviando(false);
    onEnviado(conv?.id ?? null);
  }

  const p = plantillas?.find((x) => x.id === elegida);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!compacto && (
        <small style={{ color: "var(--texto-2)" }}>
          WhatsApp solo deja escribirle primero (o después de 24 h sin respuesta) con una plantilla aprobada por Meta.
          Cuando conteste, ya le puedes escribir normal desde aquí.
        </small>
      )}
      {plantillas && plantillas.length === 0 && (
        <div className="aviso-caja">No hay plantillas cargadas. Agrégalas en <Link href="/remarketing">Remarketing</Link>.</div>
      )}
      {plantillas && plantillas.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <select id={`plantilla-${leadId}`} aria-label="Plantilla" className="entrada" style={{ flex: 1, minWidth: 200 }} value={elegida} onChange={(e) => setElegida(e.target.value)}>
            <option value="">Elige la plantilla…</option>
            {plantillas.map((x) => <option key={x.id} value={x.id}>{x.titulo || x.nombre}</option>)}
          </select>
          <button className="boton primario" onClick={enviar} disabled={enviando || !elegida}>
            <Send size={15} /> {enviando ? "Enviando…" : "Mandar plantilla"}
          </button>
        </div>
      )}
      {p?.texto && <div className="codigo" style={{ whiteSpace: "pre-wrap", fontSize: 12.5 }}>{p.texto}</div>}
      {error && <div className="error-caja">{error}</div>}
    </div>
  );
}

/** "Nuevo chat": eliges un lead (o escribes un número nuevo) y le mandas una plantilla. */
export function NuevoChat({ lead, onCerrar, onListo }: {
  lead?: { id: string; nombre: string; telefono: string | null } | null;
  onCerrar: () => void;
  onListo: (convId: string | null) => void;
}) {
  const db = supabaseNavegador();
  const leads = useOpciones(lead ? null : "leads");
  const [modo, setModo] = useState<"lead" | "nuevo">("lead");
  const [leadId, setLeadId] = useState(lead?.id ?? "");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [listo, setListo] = useState<string | null>(lead?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const elegido = lead ?? (leads.find((l) => l.id === leadId)?.fila as { id: string; nombre: string; telefono: string | null } | undefined);
  const filtrados = leads.filter((l) => {
    const t = q.trim().toLowerCase();
    return !t || `${l.nombre} ${(l.fila as any)?.telefono ?? ""}`.toLowerCase().includes(t);
  }).slice(0, 200);

  async function continuar() {
    setError(null);
    if (modo === "lead") {
      if (!elegido) return setError("Elige un lead.");
      if (!normalizarTelefono(elegido.telefono)) return setError("Ese lead no tiene teléfono. Agrégalo en su ficha.");
      return setListo(elegido.id);
    }
    const tel = normalizarTelefono(telefono);
    if (!tel || tel.length < 10) return setError("Escribe un teléfono de 10 dígitos.");
    const { data: ya } = await db.from("leads").select("id").eq("telefono", tel).limit(1).maybeSingle();
    if (ya) return setListo(ya.id);
    const { data: auth } = await db.auth.getUser();
    const { data, error } = await db.from("leads").insert({
      nombre: nombre.trim() || "Sin nombre", telefono: tel, origen: "manual", asesor_id: auth.user?.id ?? null,
    }).select("id").single();
    if (error) return setError(error.message);
    setListo(data.id);
  }

  return (
    <Ventana titulo={lead ? `Escribirle a ${lead.nombre}` : "Nuevo chat de WhatsApp"} onCerrar={onCerrar}>
      {lead && (
        <div style={{ color: "var(--texto-2)" }}>
          {lead.telefono ?? "Sin teléfono"} · <Link href={`/leads/${lead.id}`}>Ver ficha</Link>
        </div>
      )}
      {!listo && !lead && (
        <>
          <div className="segmentos">
            <button className={modo === "lead" ? "activo" : ""} onClick={() => setModo("lead")}>Lead que ya existe</button>
            <button className={modo === "nuevo" ? "activo" : ""} onClick={() => setModo("nuevo")}>Número nuevo</button>
          </div>
          {modo === "lead" ? (
            <div className="campo">
              <label htmlFor="nc-buscar">Busca por nombre o teléfono</label>
              <input id="nc-buscar" className="entrada" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej. Oscar o 8112…" />
              <select id="nc-lead" aria-label="Lead" className="entrada" size={6} value={leadId} onChange={(e) => setLeadId(e.target.value)}>
                {filtrados.map((l) => <option key={l.id} value={l.id}>{l.nombre}{(l.fila as any)?.telefono ? ` · ${(l.fila as any).telefono}` : " · sin teléfono"}</option>)}
              </select>
            </div>
          ) : (
            <div className="formulario">
              <div className="campo"><label htmlFor="nc-nombre">Nombre</label><input id="nc-nombre" className="entrada" value={nombre} onChange={(e) => setNombre(e.target.value)} /></div>
              <div className="campo"><label htmlFor="nc-tel">Teléfono (10 dígitos)</label><input id="nc-tel" className="entrada" inputMode="tel" value={telefono} onChange={(e) => setTelefono(e.target.value)} placeholder="81 1234 5678" /></div>
            </div>
          )}
          {error && <div className="error-caja">{error}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button className="boton" onClick={onCerrar}>Cancelar</button>
            <button className="boton primario" onClick={continuar}>Siguiente</button>
          </div>
        </>
      )}
      {listo && <EnviarPlantilla leadId={listo} onEnviado={onListo} />}
    </Ventana>
  );
}
