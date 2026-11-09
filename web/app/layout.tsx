import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SigmaFiscal | ERP Empresarial",
  description: "SigmaFiscal: gestão empresarial, clientes, produtos, estoque, orçamentos, pedidos, vendas e preparação fiscal.",
  icons: {
    icon: "/branding/sigmafiscal-icon.svg",
    shortcut: "/branding/sigmafiscal-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
