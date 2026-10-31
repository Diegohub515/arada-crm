import { NextResponse } from "next/server";
import { supabaseServidor } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Da de alta un asesor: crea su usuario (correo + contraseña) y su perfil. Solo administradores. */
export async function POST(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const db = supabaseAdmin();
  const { data: yo } = await db.from("perfiles").select("rol").eq("id", auth.user.id).maybeSingle();
  if (yo?.rol !== "admin") return NextResponse.json({ error: "Solo un administrador puede dar de alta asesores." }, { status: 403 });

  const b = (await req.json().catch(() => ({}))) as { nombre?: string; email?: string; password?: string; telefono?: string; rol?: string };
  const email = b.email?.trim().toLowerCase();
  const nombre = b.nombre?.trim();
  if (!nombre || !email || !/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Escribe nombre y un correo válido." }, { status: 400 });
  if (!b.password || b.password.length < 8) return NextResponse.json({ error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });

  const { data: creado, error } = await db.auth.admin.createUser({ email, password: b.password, email_confirm: true, user_metadata: { nombre } });
  if (error || !creado.user) {
    const ya = /already|registered|exists/i.test(error?.message ?? "");
    return NextResponse.json({ error: ya ? "Ese correo ya tiene usuario." : `No se pudo crear: ${error?.message}` }, { status: 400 });
  }
  const { error: e2 } = await db.from("perfiles").upsert({
    id: creado.user.id, email, nombre, telefono: b.telefono?.trim() || null, rol: b.rol === "admin" ? "admin" : "asesor", activo: true,
  });
  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: creado.user.id });
}

/** Activa o desactiva a un asesor (desactivado ya no recibe leads por guardia). */
export async function PATCH(req: Request) {
  const sesion = await supabaseServidor();
  const { data: auth } = await sesion.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Inicia sesión" }, { status: 401 });
  const db = supabaseAdmin();
  const { data: yo } = await db.from("perfiles").select("rol").eq("id", auth.user.id).maybeSingle();
  if (yo?.rol !== "admin") return NextResponse.json({ error: "Solo un administrador." }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { id?: string; activo?: boolean };
  if (!b.id) return NextResponse.json({ error: "Falta el asesor" }, { status: 400 });
  await db.from("perfiles").update({ activo: !!b.activo }).eq("id", b.id);
  await db.auth.admin.updateUserById(b.id, { ban_duration: b.activo ? "none" : "876000h" });
  return NextResponse.json({ ok: true });
}
