import { headers } from "next/headers";
import { Barra } from "@/components/Marco";

export const dynamic = "force-dynamic";

export default async function Configuracion() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "tu-dominio.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const estado = [
    { nombre: "Supabase", ok: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY, falta: "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY" },
    { nombre: "Zernio (enviar mensajes)", ok: !!process.env.ZERNIO_API_KEY, falta: "ZERNIO_API_KEY" },
    { nombre: "Zernio (recibir mensajes y leads)", ok: !!process.env.ZERNIO_WEBHOOK_SECRET, falta: "ZERNIO_WEBHOOK_SECRET" },
    { nombre: "Entrada de leads (Zapier, Google, landings)", ok: !!process.env.LEADS_WEBHOOK_TOKEN, falta: "LEADS_WEBHOOK_TOKEN" },
    { nombre: "IA (agente que contesta, sugerencias y análisis)", ok: !!process.env.ANTHROPIC_API_KEY, falta: "ANTHROPIC_API_KEY" },
  ];

  return (
    <>
      <Barra titulo="Conexiones" />
      <div className="contenido" style={{ maxWidth: 900 }}>
        <div className="tarjeta">
          <div className="tarjeta-cabeza"><h2>Estado</h2></div>
          <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {estado.map((e) => (
              <div key={e.nombre} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span className={`pastilla ${e.ok ? "bien" : "aviso"}`}>{e.ok ? "Conectado" : "Falta configurar"}</span>
                <b>{e.nombre}</b>
                {!e.ok && <small style={{ color: "var(--texto-3)" }}>Agrega en Vercel: {e.falta}</small>}
              </div>
            ))}
          </div>
        </div>

        <div className="tarjeta">
          <div className="tarjeta-cabeza"><h2>1. Zernio: WhatsApp, Instagram, Messenger y formularios de Meta</h2></div>
          <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ol className="pasos">
              <li>En zernio.com conecta tus cuentas: WhatsApp Business, Instagram y la página de Facebook de Vivia Roma.</li>
              <li>Ve a <b>Webhooks</b> → nuevo webhook y pega esta URL:</li>
            </ol>
            <div className="codigo">{base}/api/webhooks/zernio</div>
            <ol className="pasos" start={3}>
              <li>En <b>Secret</b> pega la misma frase que pusiste en <code>ZERNIO_WEBHOOK_SECRET</code>.</li>
              <li>Marca los eventos <b>message.received</b>, <b>message.sent</b> y <b>lead.received</b>.</li>
              <li>Usa el botón de prueba de Zernio: debe responder “OK”.</li>
            </ol>
          </div>
        </div>

        <div className="tarjeta">
          <div className="tarjeta-cabeza"><h2>2. Google Ads: formularios de cliente potencial</h2></div>
          <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <ol className="pasos">
              <li>En Google Ads abre tu recurso de formulario → <b>Opciones de exportación de clientes potenciales</b> → Webhook.</li>
              <li>URL del webhook:</li>
            </ol>
            <div className="codigo">{base}/api/webhooks/leads</div>
            <ol className="pasos" start={3}>
              <li>En <b>Clave</b> pega tu <code>LEADS_WEBHOOK_TOKEN</code> y presiona “Enviar datos de prueba”.</li>
            </ol>
          </div>
        </div>

        <div className="tarjeta">
          <div className="tarjeta-cabeza"><h2>3. Zapier, landing pages y cualquier otra fuente</h2></div>
          <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, color: "var(--texto-2)" }}>
              Manda un POST (JSON o formulario) a esta URL. Entiende campos como nombre, telefono, email, origen, desarrollo, campana, tipologia, presupuesto y notas, en español o inglés.
            </p>
            <div className="codigo">{base}/api/webhooks/leads?token=TU_LEADS_WEBHOOK_TOKEN</div>
            <small style={{ color: "var(--texto-3)" }}>
              Si ya tienes Zaps que mandan leads a CAPI, puedes agregar un paso extra “Webhooks by Zapier → POST” con esta URL para que también lleguen aquí. Revisa primero que no dispare otros Zaps en cadena.
            </small>
          </div>
        </div>

        <div className="tarjeta">
          <div className="tarjeta-cabeza"><h2>4. Tu equipo</h2></div>
          <div className="tarjeta-cuerpo">
            <ol className="pasos">
              <li>En Supabase → <b>Authentication → Users → Add user → Create new user</b>.</li>
              <li>Escribe su correo y una contraseña temporal, y deja marcado <b>Auto Confirm User</b>.</li>
              <li>Pásale el correo y la contraseña; ya puede entrar aquí.</li>
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}
