import "server-only";
import { unstable_cache } from "next/cache";

export interface StoreVariant {
  id: number;
  name: string;
  retailPrice: string;
}

export interface StoreProduct {
  id: number;
  name: string;
  thumbnailUrl: string | null;
  variants: [StoreVariant, ...StoreVariant[]];
}

export type StoreProductResult =
  | { status: "available"; product: StoreProduct }
  | { status: "not-found" }
  | { status: "unavailable" };

export interface StoreCatalog {
  products: StoreProduct[];
  unavailable: boolean;
}

class CatalogError extends Error {
  constructor(readonly status: "not-found" | "unavailable" = "unavailable") {
    super("The store catalog could not be loaded.");
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function imageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

// Mirror checkout's server-enforced eligibility. Only display variants that can
// be bought; checkout still rereads the provider and decides the final price.
function variant(value: unknown): StoreVariant | null {
  const item = record(value);
  if (
    !item ||
    !isId(item.id) ||
    item.synced !== true ||
    item.is_ignored ||
    item.currency !== "USD" ||
    typeof item.name !== "string" ||
    !item.name.trim() ||
    typeof item.retail_price !== "string" ||
    !/^\d+(\.\d{1,2})?$/.test(item.retail_price)
  )
    return null;
  const cents = Math.round(Number(item.retail_price) * 100);
  if (!Number.isSafeInteger(cents) || cents < 50) return null;
  return {
    id: item.id,
    name: item.name,
    retailPrice: (cents / 100).toFixed(2),
  };
}

async function request(path: string, key: string): Promise<unknown> {
  const response = await fetch(
    `https://api.printful.com/store/products${path}`,
    {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (response.status === 404) throw new CatalogError("not-found");
  if (!response.ok) throw new CatalogError();
  const body = record(await response.json());
  if (body?.code === 404) throw new CatalogError("not-found");
  if (body?.code !== 200 || body.result === undefined) throw new CatalogError();
  return body.result;
}

// Cache validated values, not raw provider responses. Failed requests and invalid
// payloads throw before returning, so they do not become hour-long cache entries.
const readProductIds = unstable_cache(
  async (key: string) => {
    const result = await request("", key);
    if (!Array.isArray(result)) throw new CatalogError();
    const ids = new Set<number>();
    let unavailable = false;
    for (const item of result) {
      const row = record(item);
      if (row && isId(row.id)) ids.add(row.id);
      else unavailable = true;
    }
    return { ids: [...ids], unavailable };
  },
  ["velocity-store-product-ids-v1"],
  { revalidate: 3600 },
);

const readProduct = unstable_cache(
  async (id: number, key: string): Promise<StoreProductResult> => {
    const result = record(await request(`/${id}`, key));
    const product = record(result?.sync_product);
    if (
      !product ||
      product.id !== id ||
      typeof product.name !== "string" ||
      !product.name.trim() ||
      !Array.isArray(result?.sync_variants)
    )
      throw new CatalogError();
    if (product.is_ignored) return { status: "unavailable" };
    const variants = result.sync_variants
      .map(variant)
      .filter((item) => item !== null);
    const [first, ...rest] = variants;
    if (!first) return { status: "unavailable" };
    return {
      status: "available",
      product: {
        id,
        name: product.name,
        thumbnailUrl: imageUrl(product.thumbnail_url),
        variants: [first, ...rest],
      },
    };
  },
  ["velocity-store-product-v1"],
  { revalidate: 3600 },
);

export async function getStoreProduct(id: string): Promise<StoreProductResult> {
  if (!/^[1-9]\d*$/.test(id) || !isId(Number(id)))
    return { status: "not-found" };
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) return { status: "unavailable" };
  try {
    return await readProduct(Number(id), key);
  } catch (error) {
    return {
      status: error instanceof CatalogError ? error.status : "unavailable",
    };
  }
}

export async function getStoreProducts(): Promise<StoreCatalog> {
  const key = process.env.PRINTFUL_API_KEY;
  if (!key) return { products: [], unavailable: true };
  try {
    const list = await readProductIds(key);
    const products: StoreProduct[] = [];
    let unavailable = list.unavailable;
    // Bound provider concurrency. A failing detail only hides that product.
    for (let start = 0; start < list.ids.length; start += 4) {
      const results = await Promise.allSettled(
        list.ids.slice(start, start + 4).map((id) => readProduct(id, key)),
      );
      for (const result of results) {
        if (
          result.status === "fulfilled" &&
          result.value.status === "available"
        ) {
          products.push(result.value.product);
        } else unavailable = true;
      }
    }
    return { products, unavailable };
  } catch {
    return { products: [], unavailable: true };
  }
}
