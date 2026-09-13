/** Next.js Node deployment; native image/PDF dependencies remain on the server. */
import type { NextConfig } from "next";
const config: NextConfig = {
  serverExternalPackages: ["sharp", "pdfkit", "archiver"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};
export default config;
