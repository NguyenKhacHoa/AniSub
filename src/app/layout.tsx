import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
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
  title: "AniSub — Unified Cinema Workspace",
  description:
    "Không gian rạp chiếu phim cá nhân hóa hợp nhất, đồng bộ kênh YouTube theo thời gian thực và phân loại bằng Gemini AI.",
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
        <ThemeProvider>
          {children}
          <Toaster richColors position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
