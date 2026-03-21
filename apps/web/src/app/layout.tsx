import type { Metadata, Viewport } from "next";
import { Baskervville, Montserrat, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "@0ne/ui";
import { AppleSplashScreens } from "@/components/pwa/AppleSplashScreens";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { LoadingScreen } from "@/components/pwa/LoadingScreen";
import { ServiceWorkerRegistrar } from "@/components/pwa/ServiceWorkerRegistrar";
import "./globals.css";

const baskervville = Baskervville({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const montserrat = Montserrat({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "900"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const viewport: Viewport = {
  themeColor: "#FF692D",
};

export const metadata: Metadata = {
  title: "0ne - Everything App",
  description: "Your personal augmentation platform",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "0ne",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          <AppleSplashScreens />
        </head>
        <body
          className={`${baskervville.variable} ${montserrat.variable} ${jetbrainsMono.variable} font-body antialiased`}
        >
          <LoadingScreen />
          {children}
          <Toaster />
          <InstallPrompt />
          <ServiceWorkerRegistrar />
        </body>
      </html>
    </ClerkProvider>
  );
}
