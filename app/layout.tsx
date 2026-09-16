import type { Metadata } from "next";
import "./globals.css";
import { siteConfig } from "@/config/site";
import { BackToHome } from "@/components/back-to-home";

export const metadata: Metadata = {
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: siteConfig.description,
  applicationName: siteConfig.name,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <BackToHome />
        {children}
      </body>
    </html>
  );
}
