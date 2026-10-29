# Arada CRM

CRM de Arada para la preventa de Vivia Roma y Vivia Santa Catarina.

- **Leads** que llegan solos de formularios de Meta, WhatsApp, Instagram, Messenger, Google Ads, Zapier y landing pages.
- **Pipeline** por etapas (nuevo → contactado → cita en showroom → apartado → cerrado / perdido), arrastrando tarjetas.
- **Bandeja** para contestar WhatsApp, Instagram y Messenger desde el CRM (vía [Zernio](https://zernio.com)).
- **Brokers**, **proveedores**, **órdenes de compra**, **facturas** (con PDF/XML) y **documentos**.
- **Comercialización**: inventario de departamentos en tablero por torre y nivel (disponible, separado, vendido, bloqueado), importador de lista de precios desde Excel, cotizador con plan de pagos 15/15/70 (PDF y texto para WhatsApp), separaciones con comprobante y ventas con comisión de broker. El estado del departamento y la etapa del lead se actualizan solos.
- **Agente IA** que contesta solo los chats: califica al lead, guarda sus datos, ofrece visita al showroom y pasa el chat a una persona cuando hace falta. Su prompt se edita en el CRM (menú **Agente IA**) y se puede pausar en general o por chat.
- **IA de apoyo**: sugiere respuestas, propone el siguiente paso de cada lead y analiza tus gastos.

Hecho con Next.js (la app), Supabase (base de datos, usuarios y archivos), Vercel (lo publica en internet) y Zernio (redes y WhatsApp).

---

## Puesta en marcha (unos 30 minutos, sin programar)

### 1. Supabase: la base de datos

1. Crea una cuenta en [supabase.com](https://supabase.com) → **New project**. Nombre: `arada-crm`. Región: la más cercana (por ejemplo, East US). Guarda la contraseña que te pida.
2. Cuando termine de crearse, ve a **SQL Editor → New query**, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y presiona **Run**. Debe decir "Success".
3. Ve a **Project Settings → API** y copia tres datos:
   - **Project URL**
   - **anon public** key
   - **service_role** key (es secreta, no la compartas)
4. Crea tu usuario: **Authentication → Users → Add user → Create new user**, con tu correo y una contraseña, y deja marcado **Auto Confirm User**. Repite para cada persona del equipo.

### 2. Vercel: publicar el CRM

1. Entra a [vercel.com](https://vercel.com) → **Sign up → Continue with GitHub** (con tu cuenta Diegohub515).
2. **Add New → Project** → elige `arada-crm` → **Import**.
3. Antes de presionar Deploy, abre **Environment Variables** y agrega estas (los nombres exactos están en [`.env.example`](.env.example)):

   | Nombre | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL de Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public key |
   | `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
   | `ZERNIO_API_KEY` | tu API key de Zernio |
   | `ZERNIO_WEBHOOK_SECRET` | una frase larga que inventes |
   | `LEADS_WEBHOOK_TOKEN` | otra frase larga que inventes |
   | `ANTHROPIC_API_KEY` | para el agente y la IA, de console.anthropic.com (sin ella todo funciona menos la IA) |

4. Presiona **Deploy**. En 1–2 minutos te da una dirección tipo `arada-crm.vercel.app`. Entra con el usuario que creaste.

> Si Vercel marca un error al compilar, copia el mensaje y pásaselo a Claude.

### 3. Zernio: chats y formularios de Meta

1. En [zernio.com](https://zernio.com) conecta WhatsApp Business, Instagram y la página de Facebook.
2. En **API keys** crea una llave y ponla en Vercel como `ZERNIO_API_KEY`.
3. En **Webhooks** crea uno con:
   - URL: `https://TU-DOMINIO/api/webhooks/zernio`
   - Secret: la misma frase de `ZERNIO_WEBHOOK_SECRET`
   - Eventos: `message.received`, `message.sent`, `lead.received`
4. Manda un WhatsApp de prueba al número del negocio: debe aparecer en **Bandeja** y como lead nuevo.

Dentro del CRM, la página **Conexiones** te muestra qué falta y las URLs exactas.

### 3b. Agente IA

1. En el CRM entra a **Agente IA**, revisa el prompt (información de Vivia Roma, esquema de pago, horario) y guárdalo.
2. Pruébalo en el chat de prueba de la misma página, escribiendo como si fueras cliente.
3. Cuando te guste, enciéndelo con el interruptor de arriba. Arranca apagado.
4. **Si ya tienes otro bot contestando el mismo WhatsApp (por ejemplo, en Zapier), apágalo** para que el cliente no reciba dos respuestas.

### 4. Google Ads y Zapier

- **Google Ads** (formularios de cliente potencial): Webhook URL `https://TU-DOMINIO/api/webhooks/leads` y como Clave tu `LEADS_WEBHOOK_TOKEN`.
- **Zapier / landings**: POST a `https://TU-DOMINIO/api/webhooks/leads?token=TU_LEADS_WEBHOOK_TOKEN` con campos como `nombre`, `telefono`, `email`, `origen`, `desarrollo`, `campana`.

---

## Cosas que conviene saber

- **WhatsApp y la regla de 24 horas**: puedes contestar libremente durante 24 h después del último mensaje del cliente. Pasado eso, WhatsApp exige una plantilla aprobada; el CRM te avisa si un envío falla por eso.
- **Un número de WhatsApp solo puede estar en un proveedor de API a la vez.** Si "Ventas Arada" está conectado a otro sistema (CAPI, un bot de Zapier), conectarlo a Zernio puede desconectarlo de ahí. Decide antes cuál se queda.
- **Leads duplicados**: si alguien vuelve a escribir o llena otro formulario, se suma al lead existente (por teléfono o correo) en lugar de crear uno nuevo.
- **Seguridad**: solo entra quien tenga usuario en Supabase. Las llaves secretas viven en Vercel, nunca en el navegador.

## Trabajar el código

```bash
npm install
cp .env.example .env.local   # y llena los valores
npm run dev                  # abre http://localhost:3000
```

Estructura:

```
supabase/schema.sql          tablas, seguridad y bucket de archivos
src/app/(app)/               pantallas: dashboard, leads, pipeline, bandeja, agente, inventario, cotizaciones, separaciones, ventas, brokers, proveedores, ordenes, facturas, documentos, configuracion
src/app/api/webhooks/        entrada de Zernio y de leads (Meta, Google, Zapier, landings)
src/app/api/mensajes/enviar  envía respuestas por Zernio
src/app/api/ia               sugerencias y análisis con IA
src/lib/                     conexión a Supabase y Zernio, utilidades
```
