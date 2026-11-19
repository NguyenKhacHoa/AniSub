import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
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

export const metadata: Metadata = {
  title: "AniSub — Cinema Workspace",
  description:
    "Không gian xem phim cá nhân hóa hợp nhất, đồng bộ kênh YouTube theo thời gian thực.",
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
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
