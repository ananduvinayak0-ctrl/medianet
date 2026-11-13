import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Adbiz: Self-serve campaign tool",
  description: "A self-serve campaign tool with guided setup and explainable AI.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
