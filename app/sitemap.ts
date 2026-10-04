import type { MetadataRoute } from "next";
import { absolutePublicUrl } from "@/lib/config/public-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [absolutePublicUrl("/"), absolutePublicUrl("/privacy"), absolutePublicUrl("/docs"), absolutePublicUrl("/changelog")].flatMap((url) => (url ? [{ url }] : []));
}
