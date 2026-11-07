import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { Providers } from "./providers";

const grotesk = Space_Grotesk({ variable: "--font-grotesk", subsets: ["latin"] });
const jbmono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Leash · onchain spending limits for AI agents",
  description: "Give your AI agent a wallet without giving it your money.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${grotesk.variable} ${jbmono.variable} antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
