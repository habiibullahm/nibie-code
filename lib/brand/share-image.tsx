import { ImageResponse } from "next/og";
import { shareImageSize } from "@/lib/brand/share-image-meta";
import { getWordmark } from "@/lib/config/branding";
import { logoBodyColor, logoBodyPath, logoFoldColor, logoFoldPath, logoViewBox } from "@/lib/config/logo-mark";
import { darkPalette } from "@/lib/theme/palette";

// Dedicated share artwork. Same mark as the favicon, on the default dark ground, with the landing line.
export function nibieShareImage() {
  const name = getWordmark();
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: darkPalette.bgApp, color: darkPalette.logoBody, padding: "76px 84px" }}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ display: "flex", width: 92, height: 92, alignItems: "center", justifyContent: "center", background: darkPalette.bgRaised, borderRadius: 24 }}>
          <svg width="72" height="48" viewBox={logoViewBox}>
            <path d={logoFoldPath} fill={logoFoldColor} />
            <path d={logoBodyPath} fill={logoBodyColor} />
          </svg>
        </div>
        <div style={{ display: "flex", marginLeft: 28, fontSize: 44, letterSpacing: "-0.04em" }}>{name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", width: 980 }}>
        <div style={{ display: "flex", width: 980, fontSize: 64, lineHeight: 1.08, letterSpacing: "-0.04em" }}>A quieter place to think with AI.</div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 28, color: darkPalette.textMuted }}>Personal AI workspace</div>
      </div>
    </div>,
    shareImageSize,
  );
}
