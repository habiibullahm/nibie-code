// Geometry for the Nibie mark: an abstract folded ribbon with a cream surface and terracotta underside.
// The shape is intentionally non-letterform so the mark reads as movement/continuity rather than an initial.
// In-app, favicon, Apple icon, and share art all use the same geometry.
import { darkPalette } from "@/lib/theme/palette";

export const logoViewBox = "0 0 120 84";

export const logoFoldPath =
  "M13 49 C23 42 34 42 46 47 C59 53 69 67 83 68 C94 69 101 61 108 57 C112 66 107 75 98 79 C85 85 70 80 58 70 C48 62 39 59 29 64 C20 69 12 63 12 55 C12 52 12 50 13 49Z";

export const logoBodyPath =
  "M13 45 C17 25 29 14 43 16 C58 18 67 36 79 41 C89 45 96 37 103 37 C111 38 114 47 110 55 C105 65 93 68 82 65 C66 61 57 48 44 44 C31 41 25 50 18 50 C14 50 12 48 13 45Z";

export const logoBodyColor = darkPalette.logoBody;
export const logoFoldColor = darkPalette.terracotta;
export const logoBodyOnLight = darkPalette.logoBodyOnLight;
