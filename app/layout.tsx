import type { Metadata } from "next";
import { Fraunces, Space_Grotesk } from "next/font/google";
import "./globals.css";

// Fraunces — the literary "memory" voice (wordmark, headers, italic notes).
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  style: ["normal", "italic"],
});

// Space Grotesk — the interface voice (titles, labels, data).
const grotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-grotesk",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Working Memory",
  description: "What's on your mind — now, and everything it used to be.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${grotesk.variable}`}>
      <body>{children}</body>
    </html>
  );
}
