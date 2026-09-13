/** Shared App Router document metadata and global styling. */
import type { Metadata, Viewport } from "next";
import "../styles.css";
export const metadata: Metadata = {
  title: "MapleTally · Receipts, sorted.",
  description: "Capture, review and export your business receipts.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};
export const viewport: Viewport = { themeColor: "#214d3c" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
