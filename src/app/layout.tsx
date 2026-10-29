import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

const fuente = Figtree({ subsets: ["latin"], variable: "--fuente", display: "swap" });

export const metadata: Metadata = {
  title: "Arada CRM",
  description: "Leads, chats, brokers, compras y facturas de Arada en un solo lugar.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-MX" className={fuente.variable} suppressHydrationWarning>
      <head>
        {/* Aplica el tema guardado antes de pintar, para que no parpadee */}
        <script dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem("arada-tema")==="oscuro")document.documentElement.dataset.tema="oscuro"}catch(e){}` }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
