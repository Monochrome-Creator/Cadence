import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import "./globals.css";
import { MobileNav, Sidebar } from "@/components/sidebar";
import { CloudSyncProvider } from "@/components/cloud-sync-provider";
import { ConnectionStatus } from "@/components/connection-status";
import { DebugPanel } from "@/components/debug-panel";
import { NotificationManager } from "@/components/notification-manager";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { QuickAddModal } from "@/components/quick-add-modal";
import { Toaster } from "@/components/toaster";

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
      suppressHydrationWarning
    >
      <head>
        {/* Set the theme class before paint to avoid a light→dark flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(localStorage.getItem('cadence-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="flex min-h-full overflow-x-clip bg-[var(--c-cream)] p-2 text-[var(--c-ink)] md:p-3">
        <CloudSyncProvider />
        <NotificationManager />
        <ConnectionStatus />
        <DebugPanel />
        <PwaInstallPrompt />
        <QuickAddModal />
        <Sidebar />
        <main className="h-[calc(100vh-1rem)] min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 md:h-[calc(100vh-1.5rem)] md:pb-0">
          {children}
        </main>
        <MobileNav />
        <Toaster />
      </body>
    </html>
  );
}
