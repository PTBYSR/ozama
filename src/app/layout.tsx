import type { Metadata } from "next";
import { Fredoka, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const fredoka = Fredoka({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-fredoka",
});

const plusJakartaSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
});

const FIRE_EMOJI_SVG =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔥</text></svg>";

export const metadata: Metadata = {
  title: "Ozama 🔥 — Lagos Life Minting",
  description: "Official Lagos Life automated funding portal.",
  icons: {
    icon: [
      {
        url: FIRE_EMOJI_SVG,
        type: "image/svg+xml",
      },
      {
        url: "/favicon.ico",
        sizes: "any",
      },
    ],
    shortcut: FIRE_EMOJI_SVG,
    apple: [
      {
        url: FIRE_EMOJI_SVG,
        type: "image/svg+xml",
      },
    ],
  },
  openGraph: {
    title: "Ozama 🔥 — Lagos Life Minting",
    description: "Official Lagos Life automated funding portal.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${fredoka.variable} ${plusJakartaSans.variable} h-full antialiased`}
    >
      <head>
        <link rel="icon" href={FIRE_EMOJI_SVG} type="image/svg+xml" />
        <link rel="apple-touch-icon" href={FIRE_EMOJI_SVG} />
      </head>
      <body className="min-h-dvh overflow-x-hidden antialiased">{children}</body>
    </html>
  );
}
