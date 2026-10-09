import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Onest } from "next/font/google";
import { ThemeSync } from "@/components/theme-switcher";
import { getProductName } from "@/lib/config/branding";
import { publicMetadataBase } from "@/lib/config/public-metadata";
import { themeInitScript } from "@/lib/theme";
import { darkPalette } from "@/lib/theme/palette";
import "./globals.css";

const productName = getProductName();
const metadataBase = publicMetadataBase();

// Display/brand headings. Variable font; latin only; self-hosted by next/font.
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

// UI, chat, Workbench. Variable font; latin only; self-hosted by next/font.
const onest = Onest({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  ...(metadataBase ? { metadataBase } : {}),
  title: { default: productName, template: `%s · ${productName}` },
  applicationName: productName,
  description: "A calm workspace for everyday thinking.",
};

// Dark is the default theme, so the browser chrome matches it; the theme itself is applied by the inline script below.
export const viewport: Viewport = { colorScheme: "dark light", themeColor: darkPalette.bgApp };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-theme is set before first paint by the script (it may change the attribute after the server rendered "dark").
    <html lang="en" data-theme="dark" className={`${bricolage.variable} ${onest.variable}`} suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: themeInitScript }} /></head>
      <body><ThemeSync />{children}</body>
    </html>
  );
}
