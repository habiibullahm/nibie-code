import Link from "next/link";
import { githubRepoUrl, signupPath } from "@/lib/routes";

export function DemoBanner() {
  return (
    <div className="demo-banner" role="status" data-testid="demo-banner">
      <p><strong>Demo mode</strong> Recorded replies. Nothing is saved.</p>
      <nav className="demo-banner-actions" aria-label="Demo actions">
        <Link className="demo-banner-signup" href={signupPath}>Create account</Link>
        <a href={githubRepoUrl} target="_blank" rel="noopener noreferrer">Source on GitHub</a>
      </nav>
    </div>
  );
}
