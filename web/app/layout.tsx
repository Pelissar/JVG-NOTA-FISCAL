import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JVG Nota Fiscal | Gestão empresarial e emissão fiscal",
  description: "Plataforma web de gestão empresarial, cadastros, estoque e preparação para emissão de documentos fiscais.",
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
