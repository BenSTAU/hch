import type { Metadata } from "next";
import { Manrope, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// ADR-012 §D4 — polices self-hébergées par next/font, jamais un <link> Google
// Fonts : la dépendance DNS est explicitement écartée. Les deux familles sont
// des fontes variables, tous les weights sont donc disponibles sans les
// énumérer (700-800 titres, 400-600 corps).
const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HomeCycl'Home",
  description:
    "Réparation de vélo à domicile — le technicien se déplace, vous réservez en ligne.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="fr"
      className={`${plusJakartaSans.variable} ${manrope.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
