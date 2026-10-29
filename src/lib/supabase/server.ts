import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/** Cliente de Supabase en el servidor con la sesión del usuario que hizo la petición. */
export async function supabaseServidor() {
  const almacen = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return almacen.getAll();
        },
        setAll(lista) {
          try {
            lista.forEach(({ name, value, options }) => almacen.set(name, value, options));
          } catch {
            // Llamado desde un Server Component: el middleware ya refresca la sesión.
          }
        },
      },
    }
  );
}

/** Devuelve el usuario con sesión, o null. */
export async function usuarioActual() {
  const supabase = await supabaseServidor();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
}
