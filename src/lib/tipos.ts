export type Etapa = "nuevo" | "contactado" | "cita" | "apartado" | "cerrado" | "perdido";
export type Origen =
  | "meta_formulario" | "whatsapp" | "instagram" | "facebook" | "google_ads"
  | "landing" | "broker" | "referido" | "manual" | "otro";

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  origen: Origen;
  desarrollo: string | null;
  etapa: Etapa;
  asesor_id: string | null;
  broker_id: string | null;
  tipologia: string | null;
  presupuesto: number | null;
  valor_operacion: number | null;
  campana: string | null;
  proximo_seguimiento: string | null;
  motivo_perdida: string | null;
  notas: string | null;
  external_id: string | null;
}

export interface Actividad {
  id: string;
  lead_id: string;
  tipo: string;
  texto: string;
  creado_por: string | null;
  created_at: string;
}

export interface Conversacion {
  id: string;
  zernio_conversation_id: string;
  zernio_account_id: string | null;
  plataforma: string | null;
  contacto_nombre: string | null;
  contacto_id: string | null;
  lead_id: string | null;
  ultimo_mensaje: string | null;
  ultimo_mensaje_at: string | null;
  no_leidos: number;
}

export interface Mensaje {
  id: string;
  conversacion_id: string;
  zernio_message_id: string | null;
  direccion: "entrante" | "saliente";
  texto: string | null;
  adjuntos: { url?: string; type?: string }[] | null;
  estado: string | null;
  created_at: string;
}

export interface Perfil {
  id: string;
  nombre: string | null;
  email: string | null;
  rol: string;
}

export const ETAPAS: { id: Etapa; nombre: string; tono: string }[] = [
  { id: "nuevo", nombre: "Nuevo", tono: "info" },
  { id: "contactado", nombre: "Contactado", tono: "neutro" },
  { id: "cita", nombre: "Cita en showroom", tono: "acento" },
  { id: "apartado", nombre: "Apartado", tono: "aviso" },
  { id: "cerrado", nombre: "Cerrado", tono: "bien" },
  { id: "perdido", nombre: "Perdido", tono: "mal" },
];

export const ORIGENES: { id: Origen; nombre: string }[] = [
  { id: "meta_formulario", nombre: "Formulario Meta" },
  { id: "whatsapp", nombre: "WhatsApp" },
  { id: "instagram", nombre: "Instagram" },
  { id: "facebook", nombre: "Messenger" },
  { id: "google_ads", nombre: "Google Ads" },
  { id: "landing", nombre: "Landing page" },
  { id: "broker", nombre: "Broker" },
  { id: "referido", nombre: "Referido" },
  { id: "manual", nombre: "Captura manual" },
  { id: "otro", nombre: "Otro" },
];

export const DESARROLLOS = [
  { id: "VRO", nombre: "Vivia Roma" },
  { id: "VSC", nombre: "Vivia Santa Catarina" },
];

export const nombreEtapa = (e: string) => ETAPAS.find((x) => x.id === e)?.nombre ?? e;
export const tonoEtapa = (e: string) => ETAPAS.find((x) => x.id === e)?.tono ?? "neutro";
export const nombreOrigen = (o: string) => ORIGENES.find((x) => x.id === o)?.nombre ?? o;

export const CATEGORIAS_GASTO = [
  "Publicidad digital", "Producción de contenido", "Renders y diseño", "Agencia / freelance",
  "Software y suscripciones", "Showroom", "Impresión y lonas", "Eventos", "Comisiones", "Construcción", "Legal y notaría", "Otro",
].map((c) => ({ id: c, nombre: c }));
