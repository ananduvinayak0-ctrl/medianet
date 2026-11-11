import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Media.net Campaigns: Self-serve retention ads",
  description: "Launch and optimise retention campaigns with guided setup and explainable AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
