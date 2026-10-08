// Geometry for the Nibie mark: an abstract folded ribbon with a cream surface and terracotta underside.
// The shape is intentionally non-letterform so the mark reads as movement/continuity rather than an initial.
// In-app, favicon, Apple icon, and share art all use the same geometry.
import { darkPalette } from "@/lib/theme/palette";

export const logoViewBox = "31 19 93 62";

// The fold is drawn first and closes through the body's interior (the L back to the neck), so the body's
// lower edge always sits on terracotta with no seam.
export const logoFoldPath =
  "M90.5 48.7 C96 45 103 42 109.5 42.1 C117 42.2 122.5 46 123 52.5 C123.5 62 115 78.5 99 79.7 C92 80.2 85 76.5 77 71 C73 69.5 66 76.5 54.5 78 C43 78 35.5 68 34 60 C33.6 53 40 48.5 48 48.5 L48 40 Z";

export const logoBodyPath =
  "M56 20.2 C66 20.2 75 25 81 33 C85 38.5 88 44 90.5 48.7 C95 55.5 101 62.5 110 63 C118 63.4 122.5 58 122.8 52.5 C121 61 110 70.5 94 72.5 C84 72.5 76 66 69 60 C62 54 55 49.8 48 49.8 C41 49.8 34.5 53 34 58.5 C33 55 31.8 50 31.8 45 C31.8 31 42 20.2 56 20.2Z";

export const logoBodyColor = darkPalette.logoBody;
export const logoFoldColor = darkPalette.terracotta;
export const logoBodyOnLight = darkPalette.logoBodyOnLight;
