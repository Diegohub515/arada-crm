import { notFound } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import { calcular } from "@/lib/cotizacion";
import { dinero, fecha } from "@/lib/formato";
import { DESARROLLOS } from "@/lib/tipos";
import BotonImprimir from "./BotonImprimir";

export const dynamic = "force-dynamic";

/** Cotización limpia para imprimir o guardar como PDF desde el navegador. */
export default async function ImprimirCotizacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await supabaseServidor();
  const { data: c } = await db
    .from("cotizaciones")
    .select("*, unidades(*), leads(nombre, telefono, email), asesor:perfiles(nombre, email)")
    .eq("id", id)
    .single();
  if (!c) notFound();

  const u = c.unidades as any;
  const r = calcular(c as any);
  const des = DESARROLLOS.find((d) => d.id === u?.desarrollo)?.nombre ?? u?.desarrollo;
  const m2 = Number(u?.m2_interior ?? 0) + Number(u?.m2_terraza ?? 0);

  return (
    <main className="hoja">
      <style>{`
        body { background: var(--fondo); }
        .hoja { max-width: 760px; margin: 24px auto; background: var(--superficie); border: 1px solid var(--borde); border-radius: 14px; padding: 40px; display: flex; flex-direction: column; gap: 22px; }
        .hoja-cab { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; flex-wrap: wrap; }
        .hoja h1 { font-size: 26px; letter-spacing: -0.02em; }
        .hoja .gris { color: var(--texto-2); }
        .hoja .ficha-depa { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
        .hoja .ficha-depa div { background: var(--superficie-2); border-radius: 8px; padding: 10px; }
        .hoja .ficha-depa small { display: block; color: var(--texto-3); font-size: 11.5px; }
        .hoja .total { font-size: 30px; font-weight: 800; color: var(--acento-texto); }
        @media print {
          body { background: #fff; }
          .hoja { border: 0; margin: 0; padding: 0; max-width: none; }
          .no-imprimir { display: none !important; }
        }
        @media (max-width: 600px) { .hoja { padding: 20px; margin: 0; border-radius: 0; } .hoja .ficha-depa { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      `}</style>
      <div className="no-imprimir" style={{ display: "flex", justifyContent: "flex-end" }}><BotonImprimir /></div>
      <div className="hoja-cab">
        <div className="marca"><img className="marca-logo" src="/logo.png" alt="Arada" /><div><b>{des}</b><small>Arada · Preventa</small></div></div>
        <div style={{ textAlign: "right" }}>
          <h1>Cotización</h1>
          <div className="gris">{c.folio} · {fecha(c.created_at)}</div>
        </div>
      </div>

      <div>
        <div className="gris">Preparada para</div>
        <b style={{ fontSize: 17 }}>{(c.leads as any)?.nombre ?? "Cliente"}</b>
      </div>

      <div className="ficha-depa">
        <div><small>Departamento</small><b>{u?.torre}-{u?.numero}</b></div>
        <div><small>Nivel</small><b>{u?.nivel}</b></div>
        <div><small>Tipología</small><b>{u?.tipologia ?? "—"}</b></div>
        <div><small>Superficie</small><b>{m2 ? `${m2} m²` : "—"}</b></div>
        <div><small>Recámaras</small><b>{u?.recamaras ?? "—"}</b></div>
        <div><small>Baños</small><b>{u?.banos ?? "—"}</b></div>
        <div><small>Cajones</small><b>{u?.cajones ?? "—"}</b></div>
        <div><small>Vista</small><b>{u?.vista ?? "—"}</b></div>
      </div>

      <div className="plan-pagos">
        <div><span>Precio de lista</span><span className="num">{dinero(c.precio_lista)}</span></div>
        {Number(c.descuento_pct) > 0 && <div><span>Descuento {c.descuento_pct}%</span><span className="num">−{dinero(r.ahorro)}</span></div>}
        <div><span>Enganche ({c.enganche_pct}%)</span><span className="num">{dinero(r.enganche)}</span></div>
        <div><span>{r.n} mensualidades ({c.mensualidades_pct}%)<small>Total {dinero(r.totalMensual)}</small></span><span className="num">{dinero(r.mensualidad)} c/u</span></div>
        <div><span>A la escrituración ({c.escrituracion_pct}%)</span><span className="num">{dinero(r.escrituracion)}</span></div>
        <div><span>Precio final</span><span className="num">{dinero(c.precio_final)}</span></div>
      </div>

      <div className="gris" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        {c.vigencia && <>Precio vigente hasta el {fecha(c.vigencia)}. </>}
        Precios en pesos mexicanos. Cotización informativa sujeta a disponibilidad; no constituye apartado ni contrato.
        {(c as any).asesor?.nombre && <><br />Asesor: {(c as any).asesor.nombre}</>}
        {c.notas && <><br />{c.notas}</>}
      </div>
    </main>
  );
}
