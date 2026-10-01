import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "GitScope — Honest GitHub Profile Audit",
  description: "An evidence-based GitHub portfolio audit with personalized scoring, strengths, weaknesses, and project recommendations."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
