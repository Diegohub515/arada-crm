"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarCheck, Handshake, MessageCircle, Users, Wallet } from "lucide-react";
import { Barra } from "@/components/Marco";
import { FichaLead, PastillaEtapa, useLeads } from "@/components/leads";
import { supabaseNavegador } from "@/lib/supabase/client";
import { ETAPAS, ORIGENES, type Lead } from "@/lib/tipos";
import { dinero, dineroCorto, fecha, hoyISO, iniciales } from "@/lib/formato";

const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export default function Dashboard() {
  const { leads, error } = useLeads();
  const [gasto, setGasto] = useState<{ mes: number; anterior: number } | null>(null);
  const [noLeidos, setNoLeidos] = useState(0);
  const [abierto, setAbierto] = useState<string | null>(null);
  const hoy = hoyISO();

  useEffect(() => {
    const db = supabaseNavegador();
    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1).toISOString().slice(0, 10);
    const inicioAnterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1).toISOString().slice(0, 10);
    db.from("facturas").select("total, fecha_emision, estado").gte("fecha_emision", inicioAnterior).neq("estado", "cancelada")
      .then(({ data }) => {
        const filas = (data ?? []) as { total: number; fecha_emision: string }[];
        setGasto({
          mes: filas.filter((f) => f.fecha_emision >= inicioMes).reduce((s, f) => s + Number(f.total), 0),
          anterior: filas.filter((f) => f.fecha_emision < inicioMes).reduce((s, f) => s + Number(f.total), 0),
        });
      });
    db.from("conversaciones").select("no_leidos").gt("no_leidos", 0)
      .then(({ data }) => setNoLeidos((data ?? []).reduce((s: number, c: { no_leidos: number }) => s + c.no_leidos, 0)));
  }, []);

  const m = useMemo(() => calcular(leads ?? [], hoy), [leads, hoy]);

  return (
    <>
      <Barra titulo="Dashboard">
        <Link className="boton" href="/leads?seguimiento=1"><CalendarCheck size={15} /> Seguimientos de hoy</Link>
      </Barra>
      <div className="contenido">
        {error && <div className="error-caja">No pude leer los datos: {error}. Revisa que hayas corrido supabase/schema.sql.</div>}

        <div className="rejilla rejilla-4">
          <Kpi icono={<Users size={15} />} titulo="Leads del mes" valor={String(m.leadsMes)} delta={m.deltaLeads} nota="vs mes pasado" />
          <Kpi icono={<CalendarCheck size={15} />} titulo="Tasa de cita" valor={`${m.tasaCita}%`} nota={`${m.citasMes} citas este mes`} />
          <Kpi icono={<Handshake size={15} />} titulo="Apartados + cierres" valor={String(m.ventasMes)} nota={m.valorMes ? dineroCorto(m.valorMes) : "este mes"} />
          <Kpi icono={<Wallet size={15} />} titulo="Gasto del mes" valor={gasto ? dineroCorto(gasto.mes) : "—"}
            delta={gasto && gasto.anterior ? Math.round(((gasto.mes - gasto.anterior) / gasto.anterior) * 100) : null} invertir nota="facturas" />
        </div>

        <div className="rejilla rejilla-2-1">
          <div className="tarjeta">
            <div className="tarjeta-cabeza"><h2>Leads por mes</h2><div className="espacio" /><small style={{ color: "var(--texto-3)" }}>Últimos 12 meses · línea = citas</small></div>
            <div className="tarjeta-cuerpo"><GraficaMeses datos={m.porMes} /></div>
          </div>
          <div className="tarjeta">
            <div className="tarjeta-cabeza">
              <h2>Seguimientos</h2><div className="espacio" />
              {noLeidos > 0 && <Link className="boton chico" href="/bandeja"><MessageCircle size={13} /> {noLeidos} sin leer</Link>}
            </div>
            <div className="tarjeta-cuerpo" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {m.seguimientos.length === 0 && <div className="vacio" style={{ padding: 20 }}><b>Al día</b>No hay seguimientos vencidos ni para hoy.</div>}
              {m.seguimientos.slice(0, 7).map((l) => (
                <button key={l.id} className="chat-item" style={{ borderRadius: 8, padding: "8px 6px" }} onClick={() => setAbierto(l.id)}>
                  <span className="avatar">{iniciales(l.nombre)}</span>
                  <div>
                    <div className="arriba"><b>{l.nombre}</b><small className={l.proximo_seguimiento! < hoy ? "atrasado" : ""}>{fecha(l.proximo_seguimiento)}</small></div>
                    <p><PastillaEtapa etapa={l.etapa} /></p>
                  </div>
                </button>
              ))}
              {m.seguimientos.length > 7 && <Link className="boton chico" href="/leads?seguimiento=1" style={{ alignSelf: "flex-start" }}>Ver los {m.seguimientos.length}</Link>}
            </div>
          </div>
        </div>

        <div className="rejilla rejilla-3">
          <div className="tarjeta">
            <div className="tarjeta-cabeza"><h2>Embudo</h2></div>
            <div className="tarjeta-cuerpo"><Barras filas={m.porEtapa} /></div>
          </div>
          <div className="tarjeta">
            <div className="tarjeta-cabeza"><h2>Leads por origen</h2><div className="espacio" /><small style={{ color: "var(--texto-3)" }}>90 días</small></div>
            <div className="tarjeta-cuerpo"><Barras filas={m.porOrigen} /></div>
          </div>
          <div className="tarjeta">
            <div className="tarjeta-cabeza"><h2>Citas por origen</h2><div className="espacio" /><small style={{ color: "var(--texto-3)" }}>90 días</small></div>
            <div className="tarjeta-cuerpo">
              <Barras filas={m.citasPorOrigen} sufijo="%" />
              <small style={{ color: "var(--texto-3)", display: "block", marginTop: 10 }}>% de leads de cada origen que llegaron a cita o más.</small>
            </div>
          </div>
        </div>
        {gasto && gasto.mes > 0 && m.leadsMes > 0 && (
          <small style={{ color: "var(--texto-2)" }}>Costo aproximado por lead este mes (facturas ÷ leads): <b>{dinero(gasto.mes / m.leadsMes)}</b></small>
        )}
      </div>
      {abierto && <FichaLead id={abierto} onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function Kpi({ icono, titulo, valor, delta, nota, invertir }: {
  icono: React.ReactNode; titulo: string; valor: string; delta?: number | null; nota?: string; invertir?: boolean;
}) {
  const bueno = delta != null && (invertir ? delta <= 0 : delta >= 0);
  return (
    <div className="tarjeta kpi">
      <div className="kpi-titulo"><span className="kpi-icono">{icono}</span>{titulo}</div>
      <div className="kpi-fila">
        <span className="kpi-valor">{valor}</span>
        {delta != null && Number.isFinite(delta) && <span className={`delta ${bueno ? "sube" : "baja"}`}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta)}%</span>}
        {nota && <span className="kpi-nota">{nota}</span>}
      </div>
    </div>
  );
}

function Barras({ filas, sufijo = "" }: { filas: { nombre: string; valor: number }[]; sufijo?: string }) {
  const max = Math.max(1, ...filas.map((f) => f.valor));
  if (filas.every((f) => f.valor === 0)) return <div className="vacio" style={{ padding: 20 }}>Sin datos todavía.</div>;
  return (
    <div className="barras">
      {filas.map((f) => (
        <div className="barra-fila" key={f.nombre}>
          <span title={f.nombre}>{f.nombre}</span>
          <div className="pista"><div className="relleno" style={{ width: `${(f.valor / max) * 100}%` }} /></div>
          <span className="num">{f.valor}{sufijo}</span>
        </div>
      ))}
    </div>
  );
}

function GraficaMeses({ datos }: { datos: { mes: string; leads: number; citas: number }[] }) {
  const W = 640, H = 220, izq = 34, abajo = 24, arriba = 10;
  const max = Math.max(4, ...datos.map((d) => d.leads));
  const paso = Math.ceil(max / 4);
  const tope = paso * 4;
  const y = (v: number) => arriba + (H - arriba - abajo) * (1 - v / tope);
  const ancho = (W - izq) / datos.length;
  const puntos = datos.map((d, i) => `${izq + ancho * i + ancho / 2},${y(d.citas)}`).join(" ");
  return (
    <div className="grafica">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Leads y citas por mes">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={izq} x2={W} y1={y(paso * i)} y2={y(paso * i)} stroke="var(--borde)" strokeDasharray={i ? "3 4" : undefined} />
            <text x={izq - 8} y={y(paso * i) + 4} textAnchor="end">{paso * i}</text>
          </g>
        ))}
        {datos.map((d, i) => {
          const x = izq + ancho * i + ancho * 0.18;
          const w = ancho * 0.64;
          return (
            <g key={d.mes}>
              <rect x={x} y={y(d.leads)} width={w} height={Math.max(0, y(0) - y(d.leads))} rx={5} fill="var(--superficie-2)" stroke="var(--borde)" />
              <rect x={x} y={y(d.leads)} width={w} height={2.5} rx={1} fill="var(--acento)" />
              <text x={x + w / 2} y={H - 6} textAnchor="middle">{d.mes}</text>
              <title>{`${d.mes}: ${d.leads} leads, ${d.citas} citas`}</title>
            </g>
          );
        })}
        <polyline points={puntos} fill="none" stroke="var(--acento)" strokeWidth={1.6} strokeDasharray="4 4" opacity={0.75} />
      </svg>
    </div>
  );
}

function calcular(leads: Lead[], hoy: string) {
  const ahora = new Date();
  const claveMes = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const mesActual = claveMes(ahora);
  const mesPasado = claveMes(new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1));
  const hace90 = Date.now() - 90 * 86400000;
  const llegoACita = (l: Lead) => ["cita", "apartado", "cerrado"].includes(l.etapa);

  const delMes = leads.filter((l) => claveMes(new Date(l.created_at)) === mesActual);
  const delPasado = leads.filter((l) => claveMes(new Date(l.created_at)) === mesPasado);
  const citasMes = delMes.filter(llegoACita).length;
  const ventas = delMes.filter((l) => ["apartado", "cerrado"].includes(l.etapa));

  const porMes = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(ahora.getFullYear(), ahora.getMonth() - 11 + i, 1);
    const k = claveMes(d);
    const del = leads.filter((l) => claveMes(new Date(l.created_at)) === k);
    return { mes: MESES[d.getMonth()], leads: del.length, citas: del.filter(llegoACita).length };
  });

  const recientes = leads.filter((l) => new Date(l.created_at).getTime() >= hace90);
  const porOrigen = ORIGENES.map((o) => ({ nombre: o.nombre, valor: recientes.filter((l) => l.origen === o.id).length }))
    .filter((x) => x.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, 6);
  const citasPorOrigen = ORIGENES.map((o) => {
    const del = recientes.filter((l) => l.origen === o.id);
    return { nombre: o.nombre, valor: del.length ? Math.round((del.filter(llegoACita).length / del.length) * 100) : -1 };
  }).filter((x) => x.valor >= 0).sort((a, b) => b.valor - a.valor).slice(0, 6);

  return {
    leadsMes: delMes.length,
    deltaLeads: delPasado.length ? Math.round(((delMes.length - delPasado.length) / delPasado.length) * 100) : null,
    citasMes,
    tasaCita: delMes.length ? Math.round((citasMes / delMes.length) * 100) : 0,
    ventasMes: ventas.length,
    valorMes: ventas.reduce((s, l) => s + Number(l.valor_operacion ?? 0), 0),
    porMes,
    porEtapa: ETAPAS.map((e) => ({ nombre: e.nombre, valor: leads.filter((l) => l.etapa === e.id).length })),
    porOrigen: porOrigen.length ? porOrigen : [{ nombre: "Sin datos", valor: 0 }],
    citasPorOrigen: citasPorOrigen.length ? citasPorOrigen : [{ nombre: "Sin datos", valor: 0 }],
    seguimientos: leads
      .filter((l) => l.proximo_seguimiento && l.proximo_seguimiento <= hoy && !["cerrado", "perdido"].includes(l.etapa))
      .sort((a, b) => (a.proximo_seguimiento! < b.proximo_seguimiento! ? -1 : 1)),
  };
}
