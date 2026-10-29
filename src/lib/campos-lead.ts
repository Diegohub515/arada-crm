/**
 * Todos los campos del lead, en el orden en que aparecen en la ficha.
 * "lista" = desplegable cuyas opciones se editan desde el CRM (tabla opciones_campo).
 * Para agregar un campo nuevo: 1) agrega la columna en supabase/schema.sql, 2) agrégalo aquí.
 */
export type TipoCampo = "texto" | "lista" | "fecha" | "numero" | "notas" | "telefono" | "email" | "broker" | "asesor" | "etapa" | "origen" | "desarrollo";

export type CampoLead = { k: string; n: string; tipo: TipoCampo; ancho?: boolean; requerido?: boolean };

export const SECCIONES_LEAD: { titulo: string; campos: CampoLead[] }[] = [
  {
    titulo: "Prospecto",
    campos: [
      { k: "nombre", n: "Prospecto", tipo: "texto", requerido: true },
      { k: "asesor_id", n: "Asesor", tipo: "asesor" },
      { k: "created_at", n: "Fecha alta", tipo: "fecha" },
      { k: "desarrollo", n: "Desarrollo", tipo: "desarrollo" },
      { k: "etapa", n: "Etapa", tipo: "etapa" },
      { k: "origen", n: "Origen (cómo llegó al CRM)", tipo: "origen" },
      { k: "notas", n: "Información adicional del prospecto", tipo: "notas", ancho: true },
    ],
  },
  {
    titulo: "Información de contacto",
    campos: [
      { k: "telefono", n: "Teléfono", tipo: "telefono" },
      { k: "tipo_telefono", n: "Tipo teléfono", tipo: "lista" },
      { k: "email", n: "Correo electrónico", tipo: "email" },
      { k: "tipo_correo", n: "Tipo correo", tipo: "lista" },
      { k: "domicilio", n: "Domicilio", tipo: "texto" },
      { k: "pais", n: "País", tipo: "lista" },
      { k: "estado_geo", n: "Estado", tipo: "lista" },
      { k: "municipio", n: "Municipio", tipo: "lista" },
      { k: "sexo", n: "Sexo", tipo: "lista" },
      { k: "estado_civil", n: "Estado civil", tipo: "lista" },
      { k: "rango_edad", n: "Rango edad", tipo: "lista" },
      { k: "nacionalidad", n: "Nacionalidad", tipo: "lista" },
      { k: "fecha_nacimiento", n: "Fecha de nacimiento", tipo: "fecha" },
    ],
  },
  {
    titulo: "Información adicional del proyecto",
    campos: [
      { k: "broker_id", n: "Broker", tipo: "broker" },
      { k: "referido", n: "Referido", tipo: "texto" },
      { k: "como_se_entero", n: "¿Cómo se enteró de nosotros?", tipo: "lista" },
      { k: "primer_contacto", n: "Primer contacto", tipo: "lista" },
      { k: "fecha_visita", n: "Fecha de visita", tipo: "fecha" },
      { k: "visita_showroom", n: "Visita showroom", tipo: "lista" },
      { k: "nivel_interes", n: "Nivel de interés", tipo: "lista" },
      { k: "perfil_cliente", n: "Perfil del cliente", tipo: "lista" },
      { k: "ocupacion", n: "Ocupación", tipo: "texto" },
      { k: "etapa_vida", n: "Etapa de vida", tipo: "lista" },
      { k: "tipo_pago", n: "Tipo de pago", tipo: "lista" },
      { k: "motivo_compra", n: "Motivo de compra", tipo: "lista" },
      { k: "tipologia", n: "Tipología de interés", tipo: "texto" },
      { k: "rango_presupuesto", n: "Rango de presupuesto", tipo: "lista" },
      { k: "presupuesto", n: "Presupuesto (MXN)", tipo: "numero" },
      { k: "tiempo_compra", n: "Tiempo de compra", tipo: "lista" },
      { k: "ranking", n: "Ranking", tipo: "lista" },
      { k: "campana", n: "Campaña", tipo: "texto" },
      { k: "conjunto_anuncios", n: "Conjunto de anuncios", tipo: "texto" },
      { k: "anuncio", n: "Anuncio", tipo: "texto" },
      { k: "proximo_seguimiento", n: "Próximo seguimiento", tipo: "fecha" },
    ],
  },
];

export const TODOS_CAMPOS: CampoLead[] = SECCIONES_LEAD.flatMap((s) => s.campos);

/** Nombres bonitos de las listas para la pantalla de configuración. */
export const LISTAS_EDITABLES = TODOS_CAMPOS.filter((c) => c.tipo === "lista").map((c) => ({ campo: c.k, nombre: c.n }));
