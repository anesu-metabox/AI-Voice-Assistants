import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Voice Bot — Executive Assistant",
  description: "Low-latency WebRTC Voice Assistant with LiveKit & Gemini Live",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Inter:wght@400;500;600;700;800&display=swap"
        />
      </head>
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-sky-500 selection:text-white">
        {children}
      </body>
    </html>
  );
}
