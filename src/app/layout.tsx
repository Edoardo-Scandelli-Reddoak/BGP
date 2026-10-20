import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Campionature BGP", template: "%s · Campionature BGP" },
  description: "Gestione richieste e spedizioni campioni — BGP Group",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#132345",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="it" className={`${inter.variable} ${mono.variable} h-full`}>
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
