import type { Metadata } from "next";
import { Archivo, Fragment_Mono } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const fragmentMono = Fragment_Mono({
  variable: "--font-fragment",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Taper — Adaptive Endurance Training",
  description:
    "Taper builds your season from your race goal, your training history, and your life; then re-plans it every morning. Swim, bike, run: trained on years of real racing data.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${archivo.variable} ${fragmentMono.variable}`}>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
