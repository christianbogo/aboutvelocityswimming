// Run against an already-running production build to check immutable headers:
// VELOCITY_BASE_URL=http://127.0.0.1:3014 node scripts/media/home-photos-browser-check.mjs
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, devices } from "playwright";
import { artifactPath } from "../verification-artifacts.mjs";

const baseURL = new URL(
  process.env.VELOCITY_BASE_URL ?? "http://127.0.0.1:3014",
);
const artifactDir = process.env.VELOCITY_PHOTO_ARTIFACT_DIR
  ? resolve(process.env.VELOCITY_PHOTO_ARTIFACT_DIR)
  : artifactPath("home-photos");
await mkdir(artifactDir, { recursive: true, mode: 0o700 });

const isPhoto = (url) => new URL(url).pathname.startsWith("/assets/photos/");
const isOptimizedPhoto = (url) =>
  /^\/assets\/photos\/optimized\/.+\.webp$/.test(new URL(url).pathname);
const waitForImage = async (image) => {
  await image.waitFor({ state: "visible" });
  await image.evaluate(async (element) => {
    // decode() waits for the resource selected from srcset, not just the img node.
    await element.decode();
    if (!element.naturalWidth || !element.naturalHeight) {
      throw new Error(`Photo did not decode: ${element.currentSrc}`);
    }
  });
};

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const [name, options] of [
    ["desktop", { viewport: { width: 1440, height: 1000 } }],
    ["mobile", devices["Pixel 7"]],
  ]) {
    const context = await browser.newContext({
      ...options,
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    const photoRequests = [];
    const photoResponses = [];
    const completedRequests = [];
    const errors = [];
    const failedAssets = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("requestfailed", (request) => {
      if (
        new URL(request.url()).origin === baseURL.origin &&
        ["script", "stylesheet"].includes(request.resourceType())
      ) {
        failedAssets.push({
          url: request.url(),
          error: request.failure()?.errorText,
        });
      }
    });
    page.on("response", (response) => {
      if (
        response.status() >= 400 &&
        new URL(response.url()).origin === baseURL.origin &&
        ["script", "stylesheet"].includes(response.request().resourceType())
      ) {
        failedAssets.push({ url: response.url(), status: response.status() });
      }
    });
    page.on("request", (request) => {
      if (isPhoto(request.url())) photoRequests.push(request.url());
    });
    page.on("requestfinished", (request) => {
      if (!isPhoto(request.url())) return;
      completedRequests.push(
        (async () => {
          const response = await request.response();
          const sizes = await request.sizes();
          photoResponses.push({
            url: request.url(),
            status: response.status(),
            bodyBytes: sizes.responseBodySize,
            cacheControl: response.headers()["cache-control"],
          });
        })(),
      );
    });
    // This check needs only public, same-origin resources, never external auth.
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === baseURL.origin
        ? route.continue()
        : route.abort(),
    );

    try {
      // Background route prefetches can stay open; wait for each image below.
      await page.goto(baseURL.href, { waitUntil: "domcontentloaded" });
      const hero = page.getByAltText("Velocity Swimming Practice", {
        exact: true,
      });
      await waitForImage(hero);
      assert.equal(await hero.getAttribute("loading"), "eager");
      assert.equal(await hero.getAttribute("fetchpriority"), "high");
      const heroSrc = await hero.evaluate((image) => image.currentSrc);
      assert.ok(isOptimizedPhoto(heroSrc), "Hero uses a pregenerated WebP");
      assert.ok(
        await hero.getAttribute("srcset"),
        "Hero has responsive sources",
      );
      assert.ok(
        await hero.getAttribute("sizes"),
        "Hero declares its display size",
      );

      const inlinePhotos = page.locator('main img[src*="/assets/photos/"]');
      assert.equal(
        await inlinePhotos.count(),
        7,
        "Seven starting photos remain",
      );
      const inlineAttributes = await inlinePhotos.evaluateAll((images) =>
        images.map((image) => ({
          alt: image.alt,
          src: image.getAttribute("src"),
          loading: image.loading,
          srcset: image.srcset,
          sizes: image.sizes,
          width: image.getAttribute("width"),
          height: image.getAttribute("height"),
        })),
      );
      for (const photo of inlineAttributes) {
        assert.ok(photo.srcset && photo.sizes, `${photo.alt} is responsive`);
        assert.ok(Number(photo.width) > 0 && Number(photo.height) > 0);
        if (photo.alt !== "Velocity Swimming Practice") {
          assert.equal(photo.loading, "lazy", `${photo.alt} is lazy-loaded`);
        }
      }
      const photoPreloads = await page
        .locator('link[rel="preload"][as="image"]')
        .evaluateAll((links) =>
          links
            .filter((link) =>
              [link.href, link.imageSrcset].some((value) =>
                value.includes("/assets/photos/"),
              ),
            )
            .map((link) => ({ href: link.href, srcset: link.imageSrcset })),
        );
      assert.ok(photoPreloads.length <= 1, "Only the hero may be preloaded");

      const carouselPhotos = page.locator(
        '#about img[role="button"], #coaches img[role="button"]',
      );
      const startingSlides = await carouselPhotos.evaluateAll((images) =>
        images.map((image) => image.getAttribute("src")),
      );
      // More than one autoplay interval: offscreen galleries must remain idle.
      await page.waitForTimeout(5000);
      assert.deepEqual(
        await carouselPhotos.evaluateAll((images) =>
          images.map((image) => image.getAttribute("src")),
        ),
        startingSlides,
        "Offscreen carousels did not advance during initial viewing",
      );
      const distantCandidates = await page
        .locator('#coaches img[role="button"], #masters img[role="button"]')
        .evaluateAll((images) =>
          images.flatMap((image) => [
            image.src,
            ...image.srcset
              .split(",")
              .map(
                (entry) =>
                  new URL(entry.trim().split(/\s+/)[0], location.href).href,
              ),
          ]),
        );
      assert.ok(
        photoRequests.every((url) => !distantCandidates.includes(url)),
        "Far-offscreen coach and masters photos were not fetched initially",
      );
      assert.ok(
        photoRequests.every(isOptimizedPhoto),
        "Initial page did not download original photographs",
      );
      await Promise.all(completedRequests);
      const initial = {
        requests: [...photoRequests],
        bodyBytes: photoResponses.reduce(
          (sum, photo) => sum + photo.bodyBytes,
          0,
        ),
        heroSrc,
      };
      await page.screenshot({ path: `${artifactDir}/${name}-initial.png` });

      const heroResponse = await context.request.get(heroSrc);
      assert.equal(heroResponse.status(), 200);
      const cacheControl = heroResponse.headers()["cache-control"] ?? "";
      assert.match(cacheControl, /(?:^|,)\s*public(?:,|$)/);
      assert.match(cacheControl, /max-age=31536000(?:,|$)/);
      assert.match(cacheControl, /(?:^|,)\s*immutable(?:,|$)/);

      const youth = page.locator('#about img[role="button"]');
      await youth.scrollIntoViewIfNeeded();
      await waitForImage(youth);
      const beforeAutoplay = await youth.getAttribute("src");
      await page.waitForFunction(
        (src) =>
          document
            .querySelector('#about img[role="button"]')
            ?.getAttribute("src") !== src,
        beforeAutoplay,
        { timeout: 10_000 },
      );
      // Use the large original portrait, since some later slides are tiny originals.
      await page
        .locator("#about")
        .getByRole("button", { name: "Go to slide 1", exact: true })
        .click();
      await waitForImage(youth);
      const thumbnail = await youth.evaluate((image) => ({
        src: image.currentSrc,
        alt: image.alt,
        naturalWidth: image.naturalWidth,
      }));
      const beforeLightboxRequests = new Set(photoRequests);
      await youth.click();
      const lightbox = page.getByRole("dialog", {
        name: `Enlarged ${thumbnail.alt}`,
      });
      const enlarged = lightbox.locator("img");
      await waitForImage(enlarged);
      const enlargedPhoto = await enlarged.evaluate((image) => ({
        src: image.currentSrc,
        naturalWidth: image.naturalWidth,
      }));
      assert.ok(isOptimizedPhoto(enlargedPhoto.src));
      assert.notEqual(
        enlargedPhoto.src,
        thumbnail.src,
        "Lightbox selects a larger export",
      );
      assert.ok(
        !beforeLightboxRequests.has(enlargedPhoto.src),
        "Enlarged photo was deferred until opening the lightbox",
      );
      assert.ok(enlargedPhoto.naturalWidth >= thumbnail.naturalWidth);
      await page.screenshot({ path: `${artifactDir}/${name}-lightbox.png` });
      await page.waitForTimeout(4500);
      assert.equal(
        await youth.getAttribute("alt"),
        thumbnail.alt,
        "Lightbox pauses autoplay",
      );
      assert.equal(
        await enlarged.evaluate((image) => image.currentSrc),
        enlargedPhoto.src,
      );
      await page.keyboard.press("Escape");
      await lightbox.waitFor({ state: "detached" });

      await page.evaluate(() =>
        window.scrollTo({ top: 0, behavior: "instant" }),
      );
      await page.waitForTimeout(250); // Let IntersectionObserver apply visibility.
      const beforeOffscreen = await youth.getAttribute("src");
      await page.waitForTimeout(4500);
      assert.equal(
        await youth.getAttribute("src"),
        beforeOffscreen,
        "Autoplay stops offscreen",
      );

      // Check that deferred images still appear when reached, without loading embeds.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await youth.scrollIntoViewIfNeeded();
      await waitForImage(youth);
      const beforeReducedMotion = await youth.getAttribute("src");
      await page.waitForTimeout(4500);
      assert.equal(
        await youth.getAttribute("src"),
        beforeReducedMotion,
        "Reduced motion pauses autoplay while the carousel is visible",
      );
      for (const photo of await inlinePhotos.all()) {
        await photo.scrollIntoViewIfNeeded();
        await waitForImage(photo);
      }
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
        "Images do not cause horizontal overflow",
      );
      await page.screenshot({
        path: `${artifactDir}/${name}-page.png`,
        fullPage: true,
      });
      assert.ok(
        photoRequests.every(isOptimizedPhoto),
        "All photo requests use optimized exports",
      );
      await Promise.all(completedRequests);
      assert.ok(
        photoResponses.every((photo) => photo.status === 200),
        "All photographs loaded successfully",
      );
      assert.deepEqual(errors, [], "No uncaught browser errors");
      assert.deepEqual(
        failedAssets,
        [],
        "All application scripts and styles loaded",
      );
      const result = {
        name,
        initial,
        thumbnail,
        enlargedPhoto,
        cacheControl,
        photoResponses,
      };
      results.push(result);
      console.log(
        JSON.stringify({
          profile: name,
          initialPhotoBytes: initial.bodyBytes,
          initialPhotoRequests: initial.requests.length,
          passed: true,
        }),
      );
    } catch (error) {
      await page
        .screenshot({ path: `${artifactDir}/${name}-failure.png` })
        .catch(() => {});
      await writeFile(
        `${artifactDir}/${name}-failure.json`,
        JSON.stringify(
          {
            message: error.message,
            errors,
            failedAssets,
            photoRequests,
            photoResponses,
          },
          null,
          2,
        ),
      );
      throw error;
    } finally {
      await context.close();
    }
  }
  await writeFile(
    `${artifactDir}/report.json`,
    JSON.stringify(results, null, 2),
  );
  console.log(`Home photo verification passed. Evidence: ${artifactDir}`);
} finally {
  await browser.close();
}
