import { notFound } from "next/navigation";
import { supabaseServidor } from "@/lib/supabase/server";
import { APARTADO, calcular, nombreDepto, planDePagos } from "@/lib/cotizacion";
import { dinero, dineroExacto, fecha } from "@/lib/formato";
import { DESARROLLOS } from "@/lib/tipos";
import BotonImprimir from "./BotonImprimir";

export const dynamic = "force-dynamic";

/** Cotización con esquema y desglose de pagos, lista para imprimir o guardar como PDF. */
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
  const pagos = planDePagos(c as any, String(c.created_at).slice(0, 10));
  const des = DESARROLLOS.find((d) => d.id === u?.desarrollo)?.nombre ?? u?.desarrollo;
  const m2 = Number(u?.m2_interior ?? 0) + Number(u?.m2_terraza ?? 0);
  const esquema = c.esquema || `${c.enganche_pct}-${c.mensualidades_pct}-${c.escrituracion_pct}`;
  const pe = pagos.filter((p) => p.concepto === "Enganche").length;
  const asesor = (c as any).asesor?.nombre as string | undefined;
  const cliente = (c.leads as any)?.nombre as string | undefined;
  const total = pagos.reduce((s, p) => s + p.importe, 0);
  // Tabla en dos columnas cuando hay muchos pagos, para que quepa en una hoja
  const mitad = pagos.length > 14 ? Math.ceil(pagos.length / 2) : pagos.length;
  const columnas = mitad < pagos.length ? [pagos.slice(0, mitad), pagos.slice(mitad)] : [pagos];

  return (
    <main className="cot">
      <style>{`
        body { background: #eef1ef; }
        .cot { --verde: #2f7a45; --verde-osc: #1d4f2c; --verde-suave: #e7f3ea; --tinta: #17211c; --gris: #5d6b63; --linea: #dfe6e1;
          width: 210mm; min-height: 297mm; margin: 24px auto; background: #fff; color: var(--tinta); box-shadow: 0 10px 40px rgba(0,0,0,.12);
          display: flex; flex-direction: column; font-size: 12.5px; }
        .cot * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .cot-barra { display: flex; justify-content: flex-end; padding: 12px 16px 0; }
        .cot-cab { background: var(--verde-osc); color: #fff; padding: 22px 34px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
        .cot-cab .logo { display: flex; align-items: center; gap: 12px; }
        .cot-cab img { width: 44px; height: 44px; object-fit: contain; background: #fff; border-radius: 10px; padding: 4px; }
        .cot-cab .des { font-size: 20px; font-weight: 800; letter-spacing: -0.01em; }
        .cot-cab small { display: block; opacity: .8; font-size: 11.5px; }
        .cot-cab .folio { text-align: right; }
        .cot-cab .folio b { font-size: 17px; display: block; }
        .cot-cuerpo { padding: 24px 34px; display: flex; flex-direction: column; gap: 18px; flex: 1; }
        .cot-para { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; border-bottom: 1px solid var(--linea); padding-bottom: 14px; }
        .cot-para small { color: var(--gris); display: block; text-transform: uppercase; letter-spacing: .06em; font-size: 10px; }
        .cot-para b { font-size: 17px; }
        .cot-depa { display: grid; grid-template-columns: auto 1fr auto; gap: 18px; align-items: center; }
        .cot-letra { width: 78px; height: 78px; border-radius: 16px; background: var(--verde); color: #fff; display: grid; place-items: center; text-align: center; line-height: 1; }
        .cot-letra b { font-size: 40px; display: block; } .cot-letra small { font-size: 10px; opacity: .85; }
        .cot-datos { display: grid; grid-template-columns: repeat(3, auto); gap: 6px 22px; justify-content: start; }
        .cot-datos small { color: var(--gris); font-size: 10.5px; display: block; }
        .cot-datos b { font-size: 13.5px; }
        .cot-precio { text-align: right; background: var(--verde-suave); border-radius: 14px; padding: 12px 16px; min-width: 200px; }
        .cot-precio small { color: var(--gris); display: block; font-size: 11px; }
        .cot-precio .lista { text-decoration: line-through; color: var(--gris); font-size: 12.5px; }
        .cot-precio .ahorro { color: var(--verde); font-weight: 700; font-size: 11.5px; }
        .cot-precio .final { font-size: 25px; font-weight: 800; color: var(--verde-osc); letter-spacing: -0.02em; }
        .cot-titulo { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; color: var(--verde-osc); display: flex; align-items: center; gap: 10px; }
        .cot-titulo::after { content: ""; flex: 1; height: 1px; background: var(--linea); }
        .cot-barra-esq { display: flex; height: 12px; border-radius: 99px; overflow: hidden; }
        .cot-barra-esq span:nth-child(1) { background: var(--verde-osc); } .cot-barra-esq span:nth-child(2) { background: #6fae80; } .cot-barra-esq span:nth-child(3) { background: #c3dccb; }
        .cot-esq { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
        .cot-esq > div { border: 1px solid var(--linea); border-radius: 12px; padding: 12px 14px; position: relative; }
        .cot-esq > div::before { content: ""; position: absolute; left: 0; top: 12px; bottom: 12px; width: 4px; border-radius: 0 4px 4px 0; }
        .cot-esq > div:nth-child(1)::before { background: var(--verde-osc); } .cot-esq > div:nth-child(2)::before { background: #6fae80; } .cot-esq > div:nth-child(3)::before { background: #c3dccb; }
        .cot-esq .pct { font-size: 22px; font-weight: 800; color: var(--verde-osc); }
        .cot-esq .nom { font-weight: 700; }
        .cot-esq .monto { font-size: 15px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
        .cot-esq small { color: var(--gris); display: block; font-size: 11px; }
        .cot-tablas { display: grid; grid-template-columns: repeat(${columnas.length}, minmax(0, 1fr)); gap: 14px; align-items: start; }
        .cot table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
        .cot th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--gris); padding: 6px 8px; border-bottom: 1.5px solid var(--verde-osc); }
        .cot td { padding: 5px 8px; border-bottom: 1px solid var(--linea); font-size: 11.5px; }
        .cot .der { text-align: right; }
        .cot tr.eng td { background: var(--verde-suave); font-weight: 600; }
        .cot tr.esc td { background: var(--verde-osc); color: #fff; font-weight: 700; }
        .cot-total { display: flex; justify-content: flex-end; gap: 14px; align-items: baseline; padding: 8px 10px; border-top: 2px solid var(--verde-osc); font-weight: 700; }
        .cot-total span:last-child { font-size: 15px; }
        .cot-notas { color: var(--gris); font-size: 10.5px; line-height: 1.55; }
        .cot-pie { background: var(--verde-suave); color: var(--verde-osc); padding: 14px 34px; display: flex; justify-content: space-between; gap: 16px; font-size: 11px; flex-wrap: wrap; }
        .cot-pie b { display: block; font-size: 12px; }
        @page { size: A4; margin: 0; }
        @media print {
          body { background: #fff; }
          .cot { margin: 0; box-shadow: none; width: 210mm; min-height: 297mm; }
          .no-imprimir { display: none !important; }
        }
        @media screen and (max-width: 820px) {
          .cot { width: auto; min-height: 0; margin: 0; box-shadow: none; }
          .cot-cab, .cot-cuerpo, .cot-pie { padding-left: 18px; padding-right: 18px; }
          .cot-depa { grid-template-columns: auto 1fr; } .cot-precio { grid-column: 1 / -1; text-align: left; }
          .cot-datos { grid-template-columns: repeat(2, auto); }
          .cot-esq, .cot-tablas { grid-template-columns: minmax(0, 1fr); }
        }
      `}</style>

      <div className="cot-barra no-imprimir"><BotonImprimir /></div>

      <header className="cot-cab">
        <div className="logo">
          <img src="/logo.png" alt="Arada" />
          <div><div className="des">{des}</div><small>Arada Desarrollos · Preventa</small></div>
        </div>
        <div className="folio">
          <small>Cotización</small>
          <b>{c.folio}</b>
          <small>{fecha(c.created_at)}</small>
        </div>
      </header>

      <div className="cot-cuerpo">
        <div className="cot-para">
          <div><small>Preparada para</small><b>{cliente ?? "Cliente"}</b></div>
          <div style={{ textAlign: "right" }}>
            {c.vigencia && <><small>Precio vigente hasta</small><b style={{ fontSize: 14 }}>{fecha(c.vigencia)}</b></>}
          </div>
        </div>

        <section className="cot-depa">
          <div className="cot-letra"><div><small>TIPO</small><b>{u?.tipologia ?? "—"}</b></div></div>
          <div>
            <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 8 }}>Departamento {nombreDepto(u)}</div>
            <div className="cot-datos">
              <div><small>Superficie</small><b>{m2 ? `${m2} m²` : "—"}</b></div>
              <div><small>Recámaras</small><b>{u?.recamaras ?? "—"}</b></div>
              <div><small>Baños</small><b>{u?.banos ?? "—"}</b></div>
              <div><small>Nivel</small><b>{u?.nivel ?? "—"}</b></div>
              <div><small>Vista</small><b>{u?.vista ?? u?.torre ?? "—"}</b></div>
              <div><small>Cajones</small><b>{u?.cajones ?? "—"}</b></div>
            </div>
          </div>
          <div className="cot-precio">
            {r.ahorro > 0 && <>
              <small>Precio de lista</small>
              <div className="lista">{dinero(c.precio_lista)}</div>
              <div className="ahorro">Descuento −{dinero(r.ahorro)}</div>
            </>}
            <small style={{ marginTop: r.ahorro > 0 ? 4 : 0 }}>Precio final</small>
            <div className="final">{dinero(r.precioFinal)}</div>
          </div>
        </section>

        <div className="cot-titulo">Esquema de pago {esquema}</div>
        <div className="cot-barra-esq">
          <span style={{ width: `${c.enganche_pct}%` }} /><span style={{ width: `${c.mensualidades_pct}%` }} /><span style={{ width: `${c.escrituracion_pct}%` }} />
        </div>
        <div className="cot-esq">
          <div>
            <span className="pct">{c.enganche_pct}%</span> <span className="nom">Enganche</span>
            <div className="monto">{dineroExacto(r.enganche)}</div>
            <small>{pe > 1 ? `${pe} pagos de ${dineroExacto(pagos[0].importe)}` : "En una sola exhibición"}</small>
          </div>
          <div>
            <span className="pct">{c.mensualidades_pct}%</span> <span className="nom">Construcción</span>
            <div className="monto">{dineroExacto(r.mensualidad)} <small style={{ display: "inline" }}>/ mes</small></div>
            <small>{r.n} mensualidades · total {dinero(r.totalMensual)}</small>
          </div>
          <div>
            <span className="pct">{c.escrituracion_pct}%</span> <span className="nom">Escrituración</span>
            <div className="monto">{dineroExacto(r.escrituracion)}</div>
            <small>{c.fecha_escrituracion ? `Estimada ${fecha(c.fecha_escrituracion)}` : "A la entrega"} · con crédito o recursos propios</small>
          </div>
        </div>

        <div className="cot-titulo">Desglose de pagos</div>
        <div>
          <div className="cot-tablas">
            {columnas.map((col, i) => (
              <table key={i}>
                <thead><tr><th>#</th><th>Concepto</th><th>Fecha</th><th className="der">Importe</th></tr></thead>
                <tbody>
                  {col.map((p) => (
                    <tr key={p.num} className={p.concepto === "Enganche" ? "eng" : p.concepto === "Escrituración" ? "esc" : ""}>
                      <td>{p.num}</td><td>{p.concepto}</td><td>{p.fecha ? fecha(p.fecha) : "—"}</td><td className="der">{dineroExacto(p.importe)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ))}
          </div>
          <div className="cot-total"><span>Total</span><span>{dineroExacto(total)}</span></div>
        </div>

        <div className="cot-notas">
          Apartas tu departamento con {dinero(Number(c.apartado ?? APARTADO))}, que se descuenta del enganche.
          {" "}Precios en pesos mexicanos{c.vigencia ? `, vigentes hasta el ${fecha(c.vigencia)}` : ""}. Las fechas de pago son estimadas y se ajustan a la firma del contrato.
          {" "}Cotización informativa sujeta a disponibilidad; no constituye apartado ni contrato.
          {c.notas && <><br /><b>Notas:</b> {c.notas}</>}
        </div>
      </div>

      <footer className="cot-pie">
        <div><b>{asesor ? `Te atiende: ${asesor}` : "Arada Desarrollos"}</b>WhatsApp 81 2032 1583</div>
        {u?.desarrollo === "VRO" && <div style={{ textAlign: "right" }}><b>Showroom Vivia Roma</b>Santos Cantú Salinas, Jardines Roma, 64740 Monterrey, N.L.</div>}
      </footer>
    </main>
  );
}
