import type { Metadata } from "next";
import { Outfit, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/components/AuthProvider";
import { themeBootstrapScript } from "@/lib/client/theme";
import "./globals.css";

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

export const metadata: Metadata = {
  title: "Duksoo Code (DS Code) — 덕수고등학교 코딩 에이전트",
  description: "Claude API 기반 덕수고등학교 학생용 코딩 에이전트",
  icons: {
    icon: `${basePath}/duksoo-emblem.svg`,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className={`${outfit.variable} ${jetbrains.variable} h-full antialiased`}>
      <head>
        {/* FOUC 방지: localStorage 의 theme 선호를 페인트 직전에 <html data-theme> 으로 반영 */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
