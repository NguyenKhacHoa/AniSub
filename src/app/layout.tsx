import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { PwaRegister } from "@/components/providers/PwaRegister";
import "./globals.css";

const interSans = Inter({
  variable: "--font-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#E11D48",
};

export const metadata: Metadata = {
  title: "AniSub — Cinema & Anime Workspace",
  applicationName: "AniSub",
  description:
    "Rạp chiếu Anime & Phim điện ảnh cá nhân tích hợp AI Cinema Insight",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "AniSub",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      data-theme="midnight-void"
      suppressHydrationWarning
      className={`${interSans.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-dvh bg-[var(--bg-canvas)] text-[var(--text-primary)]">
        <NextTopLoader
          color="#14b8a6"
          initialPosition={0.12}
          crawlSpeed={180}
          height={3}
          crawl={true}
          showSpinner={false}
          easing="ease"
          speed={220}
          shadow="0 0 10px #14b8a6,0 0 5px #10b981"
        />
        <ThemeProvider>
          <PwaRegister />
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
