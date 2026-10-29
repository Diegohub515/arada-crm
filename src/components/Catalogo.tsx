"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Paperclip, Trash2 } from "lucide-react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { Barra } from "./Marco";
import { Ventana, useOpciones, useToast, abrirArchivo, subirArchivo } from "./ui";

export type Campo = {
  nombre: string;
  etiqueta: string;
  tipo?: "texto" | "numero" | "fecha" | "lista" | "notas" | "archivo" | "booleano" | "brokers" | "proveedores" | "ordenes";
  opciones?: { id: string; nombre: string }[];
  ancho?: boolean;
  requerido?: boolean;
  porDefecto?: unknown;
};

export type Columna<T> = { titulo: string; render: (fila: T) => React.ReactNode; der?: boolean };

type Props<T> = {
  tabla: string;
  titulo: string;
  singular: string;
  icono?: React.ReactNode;
  seleccion?: string;
  orden?: { campo: string; asc?: boolean };
  columnas: Columna<T>[];
  campos: Campo[];
  buscarEn: (fila: T) => string;
  filtros?: { campo: string; opciones: { id: string; nombre: string }[] };
  resumen?: (filas: T[]) => React.ReactNode;
  extra?: React.ReactNode;
  carpetaArchivos?: string;
  vacio: string;
};

export default function Catalogo<T extends { id: string; archivo_path?: string | null }>(p: Props<T>) {
  const db = supabaseNavegador();
  const [filas, setFilas] = useState<T[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [editando, setEditando] = useState<Partial<T> | null>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const [toast, avisar] = useToast();

  const brokers = useOpciones("brokers");
  const proveedores = useOpciones("proveedores");
  const ordenes = useOpciones("ordenes_compra");

  const campoOrden = p.orden?.campo ?? "created_at";
  const ascendente = !!p.orden?.asc;
  const cargar = useCallback(async () => {
    const { data, error } = await db.from(p.tabla).select(p.seleccion ?? "*").order(campoOrden, { ascending: ascendente });
    if (error) setError(error.message);
    else setFilas((data ?? []) as unknown as T[]);
  }, [db, p.tabla, p.seleccion, campoOrden, ascendente]);

  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (filas ?? []).filter((f) => {
      if (p.filtros && filtro !== "todos" && (f as any)[p.filtros.campo] !== filtro) return false;
      return !t || p.buscarEn(f).toLowerCase().includes(t);
    });
  }, [filas, q, filtro, p]);

  function nuevo() {
    const base: Record<string, unknown> = {};
    p.campos.forEach((c) => { if (c.porDefecto !== undefined) base[c.nombre] = c.porDefecto; });
    setArchivo(null);
    setConfirmarBorrar(false);
    setEditando(base as Partial<T>);
  }

  function abrir(f: T) {
    setArchivo(null);
    setConfirmarBorrar(false);
    setEditando({ ...f });
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!editando) return;
    setGuardando(true);
    try {
      const datos: Record<string, unknown> = {};
      for (const c of p.campos) {
        if (c.tipo === "archivo") continue;
        let v = (editando as any)[c.nombre];
        if (v === "") v = null;
        if (c.tipo === "numero" && v != null) v = Number(v);
        datos[c.nombre] = v ?? (c.tipo === "booleano" ? false : null);
      }
      if (archivo && p.carpetaArchivos) datos.archivo_path = await subirArchivo(p.carpetaArchivos, archivo);
      const id = (editando as any).id as string | undefined;
      const { error } = id
        ? await db.from(p.tabla).update(datos).eq("id", id)
        : await db.from(p.tabla).insert(datos);
      if (error) throw new Error(error.message);
      setEditando(null);
      avisar(id ? "Cambios guardados" : `${p.singular} agregado`);
      cargar();
    } catch (err: any) {
      avisar(err.message ?? "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  async function borrar() {
    const id = (editando as any)?.id;
    if (!id) return;
    const { error } = await db.from(p.tabla).delete().eq("id", id);
    if (error) return avisar(error.message);
    setEditando(null);
    avisar(`${p.singular} eliminado`);
    cargar();
  }

  const opcionesDe = (c: Campo) =>
    c.tipo === "brokers" ? brokers : c.tipo === "proveedores" ? proveedores : c.tipo === "ordenes" ? ordenes : c.opciones ?? [];

  const valor = (c: Campo) => {
    const v = (editando as any)?.[c.nombre];
    return v == null ? "" : String(v);
  };
  const poner = (nombre: string, v: unknown) => setEditando((e) => ({ ...(e ?? {}), [nombre]: v }) as Partial<T>);

  return (
    <>
      <Barra titulo={p.titulo} icono={p.icono}>
        {p.extra}
        <button className="boton primario" onClick={nuevo}><Plus size={16} /> Agregar</button>
      </Barra>
      <div className="contenido">
        {p.resumen && filas && p.resumen(filas)}
        <div className="tarjeta">
          <div className="herramientas" style={{ padding: 14 }}>
            <div className="buscador" style={{ width: "min(320px, 100%)" }}>
              <Search size={15} />
              <input id={`buscar-${p.tabla}`} className="entrada" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            {p.filtros && (
              <div className="segmentos">
                {[{ id: "todos", nombre: "Todos" }, ...p.filtros.opciones].map((o) => (
                  <button key={o.id} className={filtro === o.id ? "activo" : ""} onClick={() => setFiltro(o.id)}>{o.nombre}</button>
                ))}
              </div>
            )}
            <div className="espacio" />
            <small style={{ color: "var(--texto-3)" }}>{visibles.length} de {filas?.length ?? 0}</small>
          </div>
          {error && <div className="error-caja" style={{ margin: 14 }}>No pude leer la tabla: {error}. ¿Ya corriste el archivo supabase/schema.sql?</div>}
          <div className="tabla-caja">
            <table className="tabla">
              <thead>
                <tr>
                  {p.columnas.map((c) => <th key={c.titulo} className={c.der ? "der" : ""}>{c.titulo}</th>)}
                  {p.carpetaArchivos && <th>Archivo</th>}
                </tr>
              </thead>
              <tbody>
                {visibles.map((f) => (
                  <tr key={f.id} onClick={() => abrir(f)}>
                    {p.columnas.map((c) => <td key={c.titulo} className={c.der ? "der num" : ""}>{c.render(f)}</td>)}
                    {p.carpetaArchivos && (
                      <td>
                        {f.archivo_path ? (
                          <button className="boton chico" onClick={(e) => { e.stopPropagation(); abrirArchivo(f.archivo_path!).catch((er) => avisar(er.message)); }}>
                            <Paperclip size={13} /> Ver
                          </button>
                        ) : <span style={{ color: "var(--texto-3)" }}>—</span>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {filas && visibles.length === 0 && (
              <div className="vacio"><b>{filas.length ? "Sin resultados" : `Aún no hay ${p.titulo.toLowerCase()}`}</b>{filas.length ? "Prueba con otra búsqueda." : p.vacio}</div>
            )}
            {!filas && !error && <div className="vacio">Cargando…</div>}
          </div>
        </div>
      </div>

      {editando && (
        <Ventana
          titulo={(editando as any).id ? `Editar ${p.singular.toLowerCase()}` : `Nuevo ${p.singular.toLowerCase()}`}
          onCerrar={() => setEditando(null)}
        >
          <form className="formulario" onSubmit={guardar} id="form-catalogo">
            {p.campos.map((c) => (
              <div key={c.nombre} className={`campo ${c.ancho || c.tipo === "notas" ? "ancho" : ""}`}>
                <label htmlFor={`c-${c.nombre}`}>{c.etiqueta}{c.requerido ? " *" : ""}</label>
                {c.tipo === "notas" ? (
                  <textarea id={`c-${c.nombre}`} className="entrada" value={valor(c)} onChange={(e) => poner(c.nombre, e.target.value)} />
                ) : c.tipo === "archivo" ? (
                  <>
                    <input id={`c-${c.nombre}`} className="entrada" type="file" style={{ paddingTop: 6 }}
                      accept=".pdf,.xml,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx,.zip"
                      onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} />
                    {(editando as any).archivo_path && !archivo && (
                      <small style={{ color: "var(--texto-3)" }}>Ya tiene archivo. Sube otro solo si quieres reemplazarlo.</small>
                    )}
                  </>
                ) : c.tipo === "booleano" ? (
                  <select id={`c-${c.nombre}`} className="entrada" value={valor(c) === "false" ? "false" : "true"} onChange={(e) => poner(c.nombre, e.target.value === "true")}>
                    <option value="true">Sí</option><option value="false">No</option>
                  </select>
                ) : c.tipo && ["lista", "brokers", "proveedores", "ordenes"].includes(c.tipo) ? (
                  <select id={`c-${c.nombre}`} className="entrada" value={valor(c)} required={c.requerido} onChange={(e) => poner(c.nombre, e.target.value)}>
                    <option value="">—</option>
                    {opcionesDe(c).map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </select>
                ) : (
                  <input id={`c-${c.nombre}`} className="entrada" required={c.requerido}
                    type={c.tipo === "numero" ? "number" : c.tipo === "fecha" ? "date" : "text"}
                    step={c.tipo === "numero" ? "any" : undefined}
                    value={valor(c)} onChange={(e) => poner(c.nombre, e.target.value)} />
                )}
              </div>
            ))}
          </form>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(editando as any).id && (
              confirmarBorrar ? (
                <>
                  <button className="boton peligro" onClick={borrar}><Trash2 size={15} /> Sí, eliminar</button>
                  <button className="boton" onClick={() => setConfirmarBorrar(false)}>No</button>
                </>
              ) : (
                <button className="boton peligro" onClick={() => setConfirmarBorrar(true)}><Trash2 size={15} /> Eliminar</button>
              )
            )}
            <div style={{ flex: 1 }} />
            <button className="boton" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="boton primario" form="form-catalogo" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </Ventana>
      )}
      {toast}
    </>
  );
}
