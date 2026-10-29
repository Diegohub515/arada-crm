const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
const mxnCorto = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });

export function dinero(n: number | null | undefined) {
  return n == null ? "—" : mxn.format(Number(n));
}

export function dineroCorto(n: number | null | undefined) {
  return n == null ? "—" : "$" + mxnCorto.format(Number(n));
}

export function fecha(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}

export function hora(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
}

/** "hace 5 min", "ayer", "12 oct" */
export function relativo(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const seg = (Date.now() - d.getTime()) / 1000;
  if (seg < 60) return "ahora";
  if (seg < 3600) return `hace ${Math.floor(seg / 60)} min`;
  if (seg < 86400) return hora(iso);
  if (seg < 172800) return "ayer";
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

/** Deja solo dígitos y quita prefijos de México para comparar teléfonos: 52 1 81... → 81... */
export function normalizarTelefono(t: string | null | undefined) {
  if (!t) return null;
  let d = String(t).replace(/\D/g, "");
  if (d.length > 10 && d.startsWith("521")) d = d.slice(3);
  else if (d.length > 10 && d.startsWith("52")) d = d.slice(2);
  return d || null;
}

/** Número listo para la API de WhatsApp: los de México (10 dígitos) llevan 52 al frente. */
export function telefonoWhatsApp(t: string | null | undefined) {
  if (!t) return null;
  const d = String(t).replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10) return `52${d}`;
  if (d.length === 13 && d.startsWith("521")) return `52${d.slice(3)}`;
  return d;
}

export function hoyISO() {
  const d = new Date();
  const z = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

export function iniciales(nombre: string | null | undefined) {
  if (!nombre) return "?";
  return nombre.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
