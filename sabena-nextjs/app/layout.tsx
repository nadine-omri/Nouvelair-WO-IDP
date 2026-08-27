import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IDP — Ordre Client Sabena Technics",
  description:
    "Traitement intelligent des ordres client Sabena Technics : préprocessing, OCR par zone, extraction, validation, export.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <body>
        <div className="bg-mesh" aria-hidden="true">
          <span className="orb orb-a" />
          <span className="orb orb-b" />
          <span className="orb orb-c" />
          <div className="grain" />
        </div>
        {children}
      </body>
    </html>
  );
}
