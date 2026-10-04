import Link from "next/link";
import { getProductName, getWordmark } from "@/lib/config/branding";
import { logoBodyPath, logoCap, logoFoldPath, logoViewBox } from "@/lib/config/logo-mark";

type Props = {
  variant?: "lockup" | "mark" | "wordmark";
  size?: "default" | "large";
  activity?: BrandActivity;
  // When set, the brand is a link and `label` is its accessible name (defaults to the product name).
  href?: string;
  label?: string;
};

export type BrandActivity = "idle" | "thinking" | "streaming";

// Inline so --logo-body can switch between cream (dark theme) and ink (light theme). An external image cannot see data-theme.
export function BrandMark({ activity = "idle" }: { activity?: BrandActivity }) {
  return <span className="brand-mark has-asset" data-activity={activity} aria-hidden="true"><LogoMark /></span>;
}

function LogoMark() {
  return <svg viewBox={logoViewBox}>
    <path fill="var(--logo-fold)" d={logoFoldPath} />
    <path fill="var(--logo-body)" d={logoBodyPath} />
    <rect fill="var(--logo-body)" x={logoCap.x} y={logoCap.y} width={logoCap.width} height={logoCap.height} rx={logoCap.rx} />
  </svg>;
}

export function Brand({ variant = "lockup", size = "default", href, label, activity = "idle" }: Props) {
  const className = `brand-lockup${size === "large" ? " is-large" : ""}`;
  const content = <>{variant !== "wordmark" && <BrandMark activity={activity} />}{variant !== "mark" && <span>{getWordmark()}</span>}</>;
  return href
    ? <Link href={href} className={className} aria-label={label ?? getProductName()}>{content}</Link>
    : <span className={className}>{content}</span>;
}
