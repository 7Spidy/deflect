import type { Metadata, Viewport } from "next";
import { Cinzel, EB_Garamond } from "next/font/google";
import { GAME_NAME } from "@/game/config";
import { pitch } from "@/game/copy";
import "./globals.css";

const cinzel = Cinzel({
  variable: "--font-cinzel",
  subsets: ["latin"],
  weight: ["400", "600", "700", "900"],
  display: "swap",
});

const garamond = EB_Garamond({
  variable: "--font-garamond",
  subsets: ["latin"],
  style: ["normal", "italic"],
  display: "swap",
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

const description = pitch();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: `${GAME_NAME}: the daily parry`,
  description,
  applicationName: GAME_NAME,
  openGraph: {
    title: `${GAME_NAME}: the daily parry`,
    description,
    siteName: GAME_NAME,
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: `${GAME_NAME}: the daily parry`,
    description,
    creator: "@avi21b",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060508",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${cinzel.variable} ${garamond.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
