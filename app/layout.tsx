import type { Metadata, Viewport } from "next";
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

// A single colour, not a light/dark media pair: the app renders dark whatever
// the device prefers unless "light" was explicitly stored (see THEME_INIT).
export const viewport: Viewport = {
  themeColor: "#0b0e1a",
};

// Applies the saved theme before anything paints (inline + synchronous at the
// top of <body>, so there's no dark→light flash). Dark is the default; only
// "light" is ever stored. Keep in sync with components/ThemeToggle.tsx.
const THEME_INIT = `try{if(localStorage.getItem("wm-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${grotesk.variable}`}
      suppressHydrationWarning
    >
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
        {children}
      </body>
    </html>
  );
}
