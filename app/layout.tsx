import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MAÑANA · 日出沙画画台",
  description: "用金黄、橙红和奶油色光影，画下你的日出与明天。",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
