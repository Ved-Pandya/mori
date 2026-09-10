import type { Metadata, Viewport } from "next";
import "./globals.css";
import { InstallHint } from "./install-hint";

export const metadata: Metadata = {
  title: "Mori | Your manga library",
  description: "A private manga library for Mihon backups, reading history, and manual updates.",
  applicationName: "Mori",
  appleWebApp: {
    capable: true,
    title: "Mori",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#f7f8f5",
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body><InstallHint />{children}</body>
    </html>
  );
}
