// Geometry for the Nibie mark: a cream ribbon "n" with the terracotta fold showing between the stems.
// The in-app mark uses these paths with theme tokens; icon.svg and apple-icon.tsx use the same outlines.
import { darkPalette } from "@/lib/theme/palette";

export const logoViewBox = "24 8 460 340";

export const logoFoldPath =
  "M90 175 C170 145 260 165 345 220 C405 262 440 296 404 318 C348 348 260 318 190 268 C130 226 70 196 90 175Z";

export const logoBodyPath =
  "M108 332 A60 60 0 0 1 48 272 L48 128 C48 66 82 32 132 30 C196 28 252 62 310 122 C356 170 392 202 366 228 C336 258 296 242 248 206 C206 174 176 182 166 206 C160 224 164 250 168 272 A60 60 0 0 1 108 332Z";

export const logoCap = { x: 330, y: 104, width: 130, height: 190, rx: 65 };

export const logoBodyColor = darkPalette.logoBody;
export const logoFoldColor = darkPalette.terracotta;
export const logoBodyOnLight = darkPalette.logoBodyOnLight;
