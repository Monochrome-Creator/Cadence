import type { MetadataRoute } from "next";

// basePath is /omniprod on GitHub Pages, empty on Vercel.
const base = process.env.GITHUB_PAGES === "true" ? "/omniprod" : "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: `${base}/`,
    name: "Cadence",
    short_name: "Cadence",
    description: "Your productivity board, flashcards, and focus timer.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    orientation: "portrait",
    background_color: "#fdfbf7",
    theme_color: "#fdfbf7",
    icons: [
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: `${base}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: `${base}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
