import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Learner's Licence practice test",
  description:
    "Randomised Namibian Learner's Licence practice tests, assembled from verified past-paper questions.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Sign artwork is the point of several questions; pinch-zoom must keep working.
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased`}>{children}</body>
    </html>
  );
}
