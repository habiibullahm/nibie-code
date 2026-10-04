import { ImageResponse } from "next/og";
import { logoBodyColor, logoBodyPath, logoCap, logoFoldColor, logoFoldPath, logoViewBox } from "@/lib/config/logo-mark";
import { darkPalette } from "@/lib/theme/palette";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: darkPalette.bgApp }}>
      <svg width="148" height="110" viewBox={logoViewBox}>
        <path d={logoFoldPath} fill={logoFoldColor} />
        <path d={logoBodyPath} fill={logoBodyColor} />
        <rect x={logoCap.x} y={logoCap.y} width={logoCap.width} height={logoCap.height} rx={logoCap.rx} fill={logoBodyColor} />
      </svg>
    </div>,
    size,
  );
}
