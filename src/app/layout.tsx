import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { CloudSyncProvider } from "@/components/cloud-sync-provider";
import { NotificationManager } from "@/components/notification-manager";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Cadence",
  description: "Your productivity board, flashcards, and focus timer.",
  appleWebApp: {
    capable: true,
    title: "Cadence",
    statusBarStyle: "default",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#fdfbf7",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="flex min-h-full overflow-x-clip bg-[#fdfbf7] p-2 text-[#3a322a] md:p-3">
        <CloudSyncProvider />
        <NotificationManager />
        <PwaInstallPrompt />
        <Sidebar />
        <main className="h-[calc(100vh-1rem)] min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:h-[calc(100vh-1.5rem)] md:pb-0">
          {children}
        </main>
        <MobileNav />
      </body>
    </html>
  );
}
