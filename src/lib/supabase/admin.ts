import { createClient } from "@supabase/supabase-js";

/**
 * Cliente con la llave de servicio. SOLO para el servidor (webhooks).
 * Se salta las reglas de seguridad, así que nunca lo importes en un componente del navegador.
 */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !llave) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, llave, { auth: { persistSession: false, autoRefreshToken: false } });
}
