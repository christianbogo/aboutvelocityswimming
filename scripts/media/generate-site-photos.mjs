import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outputUrl = "/assets/photos/optimized";
const outputDir = path.join(root, "public", outputUrl);
const manifestPath = path.join(root, "src/data/site-photos.generated.json");
// Keep every encoding option in the recipe so changing an export invalidates it.
const recipe = {
  version: 1,
  autoOrient: true,
  stripMetadata: true,
  heroWidths: [480, 768, 1024, 1440, 1920, 2560],
  widths: [480, 768, 1024, 1440],
  previewWidth: 768,
  resize: { withoutEnlargement: true },
  webp: { quality: 80, effort: 5 },
  lightbox: {
    resize: { width: 2400, height: 2400, fit: "inside" },
    webp: { quality: 85, effort: 5 },
  },
  sharpVersions: sharp.versions,
};
const sources = JSON.parse(
  await readFile(path.join(root, "src/data/site-photo-sources.json"), "utf8"),
);
const photos = [...new Set(Object.values(sources).flat())];
const manifest = {};
const outputFiles = new Set();
let previousManifest = {};
try {
  previousManifest = JSON.parse(await readFile(manifestPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
let originalBytes = 0;
let previewBytes = 0;
let generatedBytes = 0;
let reusedPhotos = 0;

function outputHash(data) {
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

function recordOutput(name, bytes) {
  if (!outputFiles.has(name)) generatedBytes += bytes;
  outputFiles.add(name);
}

async function reusePhoto(source, generationKey) {
  const previous = previousManifest[source];
  if (
    previous?.generationKey !== generationKey ||
    typeof previous.srcSet !== "string" ||
    typeof previous.src !== "string" ||
    typeof previous.lightbox?.src !== "string"
  ) {
    return false;
  }

  const variants = previous.srcSet.split(", ").map((candidate) => {
    const match = candidate.match(/^(\S+) (\d+)w$/);
    return match ? { src: match[1], width: Number(match[2]) } : null;
  });
  if (
    variants.some((variant) => !variant) ||
    !variants.some((variant) => variant?.src === previous.src)
  ) {
    return false;
  }

  const files = new Map();
  for (const variant of [...variants, previous.lightbox]) {
    const name = path.basename(variant.src);
    const match = name.match(/^([\w-]+)\.([a-f0-9]{16})-(\d+)\.webp$/);
    if (
      variant.src !== `${outputUrl}/${name}` ||
      !match ||
      match[1] !== path.parse(source).name ||
      Number(match[3]) !== variant.width
    ) {
      return false;
    }
    if (files.has(name)) continue;
    try {
      const data = await readFile(path.join(outputDir, name));
      // Existence alone is insufficient: immutable URLs must keep their bytes.
      if (outputHash(data) !== match[2]) return false;
      files.set(name, data.length);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return false;
    }
  }

  for (const [name, bytes] of files) recordOutput(name, bytes);
  previewBytes += files.get(path.basename(previous.src));
  manifest[source] = previous;
  reusedPhotos += 1;
  return true;
}

async function writeIfChanged(filename, data) {
  try {
    if ((await readFile(filename)).equals(Buffer.from(data))) return;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(filename, data);
}

await mkdir(outputDir, { recursive: true });

for (const source of photos) {
  if (!/^\/assets\/photos\/[\w-]+\.(?:jpe?g|png)$/i.test(source)) {
    throw new Error(`Unsupported site photo path: ${source}`);
  }
  const input = await readFile(path.join(root, "public", source));
  originalBytes += input.length;
  const widths = source === sources.hero ? recipe.heroWidths : recipe.widths;
  const generationKey = createHash("sha256")
    .update(input)
    .update(JSON.stringify({ recipe, widths }))
    .digest("hex");
  if (await reusePhoto(source, generationKey)) continue;
  // Rotate before resizing and strip camera metadata from published derivatives.
  const metadata = await sharp(input).metadata();
  const rotated = (metadata.orientation ?? 1) >= 5;
  const sourceWidth = rotated ? metadata.height : metadata.width;
  const sourceHeight = rotated ? metadata.width : metadata.height;
  if (!sourceWidth || !sourceHeight)
    throw new Error(`No dimensions: ${source}`);

  async function exportPhoto(resize, webpOptions) {
    const { data, info } = await sharp(input)
      .rotate()
      .resize({ ...resize, ...recipe.resize })
      .webp(webpOptions)
      .toBuffer({ resolveWithObject: true });
    // Hash the actual output bytes, so an existing URL can never change contents.
    const hash = outputHash(data);
    const name = `${path.parse(source).name}.${hash}-${info.width}.webp`;
    recordOutput(name, data.length);
    await writeIfChanged(path.join(outputDir, name), data);
    return {
      src: `${outputUrl}/${name}`,
      width: info.width,
      height: info.height,
      bytes: data.length,
    };
  }

  const variants = [];
  for (const width of [
    ...new Set(widths.map((value) => Math.min(value, sourceWidth))),
  ]) {
    variants.push(await exportPhoto({ width }, recipe.webp));
  }
  const preview =
    variants.find((variant) => variant.width >= recipe.previewWidth) ??
    variants.at(-1);
  previewBytes += preview.bytes;
  const lightbox = await exportPhoto(
    recipe.lightbox.resize,
    recipe.lightbox.webp,
  );
  manifest[source] = {
    generationKey,
    src: preview.src,
    srcSet: variants.map(({ src, width }) => `${src} ${width}w`).join(", "),
    width: sourceWidth,
    height: sourceHeight,
    lightbox: {
      src: lightbox.src,
      width: lightbox.width,
      height: lightbox.height,
    },
  };
}

await writeIfChanged(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
// Only remove our generated files, after every source has been exported successfully.
for (const name of await readdir(outputDir)) {
  if (/\.[a-f0-9]{16}-\d+\.webp$/.test(name) && !outputFiles.has(name)) {
    await unlink(path.join(outputDir, name));
  }
}
console.log(
  `Generated ${outputFiles.size} WebP variants for ${photos.length} site photos. ` +
    `Reused ${reusedPhotos} unchanged photos. ` +
    `Originals: ${(originalBytes / 1e6).toFixed(2)} MB; ` +
    `768px previews: ${(previewBytes / 1e6).toFixed(2)} MB; ` +
    `all variants: ${(generatedBytes / 1e6).toFixed(2)} MB.`,
);
