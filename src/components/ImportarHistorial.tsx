"use client";
import { useState } from "react";
import { History } from "lucide-react";

/** Trae al CRM los chats de WhatsApp que Zernio sincronizó (hasta 6 meses). Llama a la API por tandas. */
export default function ImportarHistorial() {
  const [estado, setEstado] = useState<string | null>(null);
  const [corriendo, setCorriendo] = useState(false);

  async function importar() {
    setCorriendo(true);
    let cursor: string | null = null;
    let chats = 0, mensajes = 0;
    try {
      for (let vuelta = 0; vuelta < 30; vuelta++) {
        setEstado(`Importando… ${chats} chats y ${mensajes} mensajes hasta ahora`);
        const r = await fetch("/api/zernio/importar", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor }),
        });
        const d = await r.json().catch(() => ({}));
        chats += d.chats ?? 0;
        mensajes += d.mensajes ?? 0;
        if (!r.ok) throw new Error(d.error ?? "No se pudo importar");
        cursor = d.cursor ?? null;
        if (d.terminado || !cursor) break;
      }
      setEstado(`Listo: ${chats} chats revisados y ${mensajes} mensajes nuevos en la Bandeja.`);
    } catch (e: any) {
      setEstado(`${e.message}. Llevaba ${chats} chats; puedes volver a darle y sigue sin duplicar.`);
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
      <button className="boton" onClick={importar} disabled={corriendo}><History size={15} /> {corriendo ? "Importando…" : "Importar historial de WhatsApp"}</button>
      {estado && <small style={{ color: "var(--texto-2)" }}>{estado}</small>}
    </div>
  );
}
