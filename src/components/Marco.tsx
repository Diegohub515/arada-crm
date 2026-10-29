"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, Columns3, MessageCircle, Handshake, Truck, ClipboardList,
  Receipt, FolderOpen, Settings, LogOut, Menu, Bot, Building2, FileText, BadgeDollarSign, ListChecks, Moon, Sun,
} from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { iniciales } from "@/lib/formato";

const MenuCtx = createContext<() => void>(() => {});

const SECCIONES = [
  {
    titulo: "Ventas",
    items: [
      { href: "/", nombre: "Dashboard", icono: LayoutDashboard },
      { href: "/leads", nombre: "Leads", icono: Users },
      { href: "/pipeline", nombre: "Pipeline", icono: Columns3 },
      { href: "/bandeja", nombre: "Bandeja", icono: MessageCircle, contador: true },
      { href: "/agente", nombre: "Agente IA", icono: Bot },
      { href: "/brokers", nombre: "Brokers", icono: Handshake },
    ],
  },
  {
    titulo: "Comercialización",
    items: [
      { href: "/inventario", nombre: "Inventario", icono: Building2 },
      { href: "/cotizaciones", nombre: "Cotizaciones", icono: FileText },
      { href: "/separaciones", nombre: "Separaciones", icono: Handshake },
      { href: "/ventas", nombre: "Ventas", icono: BadgeDollarSign },
    ],
  },
  {
    titulo: "Administración",
    items: [
      { href: "/proveedores", nombre: "Proveedores", icono: Truck },
      { href: "/ordenes", nombre: "Órdenes de compra", icono: ClipboardList },
      { href: "/facturas", nombre: "Facturas", icono: Receipt },
      { href: "/documentos", nombre: "Documentos", icono: FolderOpen },
    ],
  },
];

export default function Marco({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [noLeidos, setNoLeidos] = useState(0);
  const [tema, setTema] = useState<"claro" | "oscuro">("claro");
  useEffect(() => {
    try { if (localStorage.getItem("arada-tema") === "oscuro") setTema("oscuro"); } catch { /* sin almacenamiento */ }
  }, []);
  function cambiarTema() {
    const nuevo = tema === "claro" ? "oscuro" : "claro";
    setTema(nuevo);
    document.documentElement.dataset.tema = nuevo;
    try { localStorage.setItem("arada-tema", nuevo); } catch { /* sin almacenamiento */ }
  }

  useEffect(() => {
    const db = supabaseNavegador();
    db.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ""));

    const contar = async () => {
      const { data } = await db.from("conversaciones").select("no_leidos").gt("no_leidos", 0);
      setNoLeidos((data ?? []).reduce((s: number, c: { no_leidos: number }) => s + c.no_leidos, 0));
    };
    contar();
    const canal = db
      .channel("marco-conversaciones")
      .on("postgres_changes", { event: "*", schema: "public", table: "conversaciones" }, contar)
      .subscribe();
    return () => { db.removeChannel(canal); };
  }, []);

  useEffect(() => setAbierto(false), [ruta]);

  async function salir() {
    await supabaseNavegador().auth.signOut();
    window.location.href = "/login";
  }

  const activo = (href: string) => (href === "/" ? ruta === "/" : ruta.startsWith(href));

  return (
    <MenuCtx.Provider value={() => setAbierto((a) => !a)}>
      <div className="app">
        <aside className={`lateral ${abierto ? "abierto" : ""}`}>
          <div className="marca">
            <img className="marca-logo" src="/logo.png" alt="Arada" />
            <div><b>Arada CRM</b><small>Preventa · Monterrey</small></div>
          </div>
          {SECCIONES.map((s) => (
            <nav className="menu" key={s.titulo}>
              <div className="menu-titulo">{s.titulo}</div>
              {s.items.map((i) => (
                <Link key={i.href} href={i.href} className={activo(i.href) ? "activo" : ""}>
                  <i.icono size={17} strokeWidth={1.8} />
                  {i.nombre}
                  {"contador" in i && i.contador && noLeidos > 0 && <span className="contador">{noLeidos}</span>}
                </Link>
              ))}
            </nav>
          ))}
          <div className="lateral-pie">
            <nav className="menu">
              <Link href="/configuracion" className={activo("/configuracion") ? "activo" : ""}>
                <Settings size={17} strokeWidth={1.8} /> Conexiones
              </Link>
              <Link href="/listas" className={activo("/listas") ? "activo" : ""}>
                <ListChecks size={17} strokeWidth={1.8} /> Listas desplegables
              </Link>
              <a href="#" onClick={(e) => { e.preventDefault(); cambiarTema(); }}>
                {tema === "claro" ? <Moon size={17} strokeWidth={1.8} /> : <Sun size={17} strokeWidth={1.8} />} {tema === "claro" ? "Modo oscuro" : "Modo claro"}
              </a>
              <a href="#" onClick={(e) => { e.preventDefault(); salir(); }}>
                <LogOut size={17} strokeWidth={1.8} /> Cerrar sesión
              </a>
            </nav>
            <div className="usuario">
              <div className="avatar">{iniciales(email)}</div>
              <div><b>{email || "…"}</b><small>Equipo Arada</small></div>
            </div>
          </div>
        </aside>
        <div className="principal">{children}</div>
      </div>
    </MenuCtx.Provider>
  );
}

/** Barra superior de cada página. */
export function Barra({ titulo, icono, children }: { titulo: string; icono?: React.ReactNode; children?: React.ReactNode }) {
  const alternar = useContext(MenuCtx);
  return (
    <header className="barra">
      <button className="boton icono boton-menu" onClick={alternar} aria-label="Abrir menú"><Menu size={18} /></button>
      <h1>{icono}{titulo}</h1>
      <div className="espacio" />
      {children}
    </header>
  );
}
