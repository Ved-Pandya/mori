import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mori | Manga library control room",
  description: "A private web library for Mihon backups and source updates.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
