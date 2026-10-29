"use client";
import { useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";

export default function Login() {
  const [email, setEmail] = useState("");
  const [clave, setClave] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCargando(true);
    setError(null);
    const { error } = await supabaseNavegador().auth.signInWithPassword({ email: email.trim(), password: clave });
    if (error) {
      setError(error.message === "Invalid login credentials" ? "Correo o contraseña incorrectos." : error.message);
      setCargando(false);
      return;
    }
    window.location.href = "/";
  }

  return (
    <main className="login">
      <form className="tarjeta" onSubmit={entrar}>
        <div className="marca">
          <img className="marca-logo" src="/logo.png" alt="Arada" />
          <div><b>Arada CRM</b><small>Vivia Roma · Vivia Santa Catarina</small></div>
        </div>
        <div>
          <h1>Inicia sesión</h1>
          <p>Usa el correo con el que te invitaron.</p>
        </div>
        <div className="campo">
          <label htmlFor="email">Correo</label>
          <input id="email" className="entrada" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="campo">
          <label htmlFor="clave">Contraseña</label>
          <input id="clave" className="entrada" type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
        </div>
        {error && <div className="error-caja">{error}</div>}
        <button className="boton primario" disabled={cargando} style={{ justifyContent: "center", height: 40 }}>
          {cargando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
