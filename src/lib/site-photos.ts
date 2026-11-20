import manifest from "@/data/site-photos.generated.json";

interface SitePhoto {
  src: string;
  srcSet: string;
  width: number;
  height: number;
  lightbox: { src: string; width: number; height: number };
}

export function getSitePhoto(src: unknown): SitePhoto | undefined {
  return typeof src === "string"
    ? (manifest as Record<string, SitePhoto>)[src]
    : undefined;
}

// The site's 1200px container becomes one column below 992px.
export const sitePhotoSizes =
  "(max-width: 992px) calc(100vw - 4rem), (max-width: 1264px) calc((100vw - 8rem) / 2), 568px";
