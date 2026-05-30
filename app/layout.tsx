import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Automattic — WordPress Block Theme Generator",
  description:
    "Describe your site and generate a complete, valid WordPress Full Site Editing block theme — packaged as an installable .zip.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
