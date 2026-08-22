import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Das Repository hat eine eigene CLAUDE.md an der Wurzel; eine erzeugte
  // zweite hier wuerde ihr widersprechen.
  agentRules: false,

  // Die Platzhalterbilder unter public/fotos sind SVG. next/image lehnt SVG
  // sonst ab, weil fremdes SVG Skripte enthalten kann; hier stammen alle
  // Dateien aus dem Projekt selbst, und die Richtlinie unterbindet den Rest.
  images: {
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
};

export default nextConfig;
