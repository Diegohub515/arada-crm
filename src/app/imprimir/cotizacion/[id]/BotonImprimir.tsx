"use client";
import { Printer } from "lucide-react";

export default function BotonImprimir() {
  return (
    <button className="boton primario" onClick={() => window.print()}>
      <Printer size={15} /> Imprimir o guardar PDF
    </button>
  );
}
