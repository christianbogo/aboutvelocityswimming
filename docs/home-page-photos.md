# Home page photos

Selected original photos live in `assets/photos/` as build inputs. The home page serves
pre-generated WebP derivatives through the site's CDN, with responsive widths
and a separate larger version fetched only when a visitor opens a lightbox.
There is no image resizing service in the request path.

## Replacing photos

1. Add or replace the original in `assets/photos/`.
2. If the filename changes, update `src/data/site-photo-sources.json`. This file
   controls the hero, feature photos, coaches, and youth carousel. Its
   `/assets/photos/...` values are source IDs, not public original-image URLs.
3. Run `npm run images:generate` with Node 24, then review the page on desktop
   and mobile. Commit the originals, source list, generated JSON manifest, and
   generated WebP files together.
4. Build and deploy through the normal release process. `npm run dev` and
   `npm run build` also regenerate the derivatives automatically.

Unchanged sources and intact derivatives are reused, so routine starts and builds
do not re-encode the collection. Missing or corrupted derivatives are regenerated.

The generator uses Sharp to apply camera orientation, remove metadata, and
export WebP at quality 80 in widths from 480 to 1440 pixels (up to 2560 for the
hero, bounded by the original width). Lightboxes use quality 85 and fit within
2400 × 2400 pixels without enlargement. Original aspect ratios are preserved;
the existing page CSS still controls how each frame crops its photo.

Generated filenames contain a hash of the actual output bytes. Only
`/assets/photos/optimized/` receives `Cache-Control: public,
max-age=31536000, immutable`. Replacing a photo produces new URLs automatically,
so a browser can cache the old file for a year without hiding the replacement.
The generator removes obsolete derivatives after a successful run and leaves
selected originals untouched. Unused original photos and videos were removed
from the working tree; previous versions remain recoverable in Git history.
Only optimized derivatives belong under `public/assets/photos/`. Avoid manually
changing a generated file under its old URL.

The hero loads eagerly with high fetch priority. Other photos use native lazy
loading and intrinsic dimensions; carousels pause offscreen, while the page is
hidden, during lightbox use, and when reduced motion is requested.

## Verification

After `npm run build`, start the production server on an unused local port:

```sh
npm run start -- --hostname 127.0.0.1 --port 3014
```

In another terminal:

```sh
VELOCITY_BASE_URL=http://127.0.0.1:3014 npm run test:home:photos
```

The browser check exercises desktop and mobile loading, responsive sources,
offscreen carousel behavior, lightboxes, and cache headers. It prints the path
to temporary screenshots and a network report. Development-mode cache headers
may differ, so use a production build for that check.
