import type { Metadata, Viewport } from "next";
import { Cinzel, EB_Garamond } from "next/font/google";
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

const description =
  "One foe. Five strikes. Tap at the instant of impact. A daily parry-timing duel scored to the millisecond.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Deflect: the daily parry",
  description,
  applicationName: "Deflect",
  openGraph: {
    title: "Deflect: the daily parry",
    description,
    siteName: "Deflect",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "Deflect: the daily parry",
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
