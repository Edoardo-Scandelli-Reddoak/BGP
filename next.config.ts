import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gestionale interno: ogni pagina dipende dalla sessione, quindi rendering dinamico classico.
  cacheComponents: false,
  output: "standalone",
  serverExternalPackages: ["exceljs", "pdf-lib", "nodemailer", "postgres", "bcryptjs"],
  experimental: {
    serverActions: {
      // upload del DDT in PDF dalla logistica e import anagrafiche (xlsx/csv)
      bodySizeLimit: "15mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
