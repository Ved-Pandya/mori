import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mori — Your manga library",
    short_name: "Mori",
    description: "A private manga library for Mihon backups, reading history, and manual updates.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f8f5",
    theme_color: "#f7f8f5",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
