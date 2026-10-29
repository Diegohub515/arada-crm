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
    <html lang="es-MX" className={fuente.variable}>
      <body>{children}</body>
    </html>
  );
}
