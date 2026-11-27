import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  cache: new Map<string, unknown>(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  unstable_cache: (read: (...args: unknown[]) => Promise<unknown>, keys: string[]) =>
    async (...args: unknown[]) => {
      const key = JSON.stringify([keys, args]);
      if (!mocks.cache.has(key)) mocks.cache.set(key, await read(...args));
      return mocks.cache.get(key);
    },
}));
vi.mock("next/server", () => ({ connection: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NEXT_HTTP_ERROR_FALLBACK;404"); },
}));
vi.mock("@/lib/mockups", () => ({ getProductMockupImages: () => [] }));

import { getStoreProduct, getStoreProducts } from "@/lib/store-catalog";
import { checkoutParams } from "@/lib/commerce";
import StorePage from "@/app/(site)/store/page";
import ProductDetailPage from "@/app/(site)/store/[id]/page";

function response(result: unknown, code = 200, status = code) {
  return Response.json({ code, result }, { status });
}
function product(id = 123, variants: unknown[] = [variant()]) {
  return {
    sync_product: { id, name: "Velocity shirt", thumbnail_url: null, is_ignored: false },
    sync_variants: variants,
  };
}
function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: 456, name: "Velocity shirt / M", synced: true, is_ignored: false,
    retail_price: "29.99", currency: "USD", ...overrides,
  };
}
beforeEach(() => {
  mocks.cache.clear();
  mocks.fetch.mockReset();
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("PRINTFUL_API_KEY", "test-key");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("store catalog", () => {
  it("returns an unavailable state without credentials and never calls the provider", async () => {
    vi.stubEnv("PRINTFUL_API_KEY", "");
    expect(await getStoreProducts()).toEqual({ products: [], unavailable: true });
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "123x", "../orders", "9007199254740993"])(
    "rejects invalid product ID %s without requesting it", async (id) => {
      expect(await getStoreProduct(id)).toEqual({ status: "not-found" });
      expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    [503, 200], [200, 503], [200, 401],
  ])("does not trust an HTTP/body status mismatch (%s / %s)", async (status, code) => {
    mocks.fetch.mockResolvedValue(response(product(), code, status));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
  });

  it("separates a missing product from a provider outage", async () => {
    mocks.fetch.mockResolvedValueOnce(response(null, 404));
    expect(await getStoreProduct("123")).toEqual({ status: "not-found" });
    mocks.fetch.mockResolvedValueOnce(response(null, 503));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
  });

  it.each([null, {}, "upstream error", { sync_product: null }, product(999), {
    ...product(), sync_variants: {},
  }])("handles malformed detail payloads without crashing", async (result) => {
    mocks.fetch.mockResolvedValue(response(result));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
  });

  it("handles invalid JSON and network failures without caching them", async () => {
    mocks.fetch.mockResolvedValueOnce(new Response("<html>Gateway error</html>"));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
    mocks.fetch.mockRejectedValueOnce(new TypeError("Network failure"));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
    mocks.fetch.mockResolvedValueOnce(response(product()));
    expect((await getStoreProduct("123")).status).toBe("available");
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
  });

  it("cancels stalled provider requests and returns unavailable", async () => {
    const controller = new AbortController();
    const deadline = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    mocks.fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const pending = getStoreProduct("123");
    controller.abort(new DOMException("Provider timed out", "TimeoutError"));
    expect(await pending).toEqual({ status: "unavailable" });
    expect(deadline).toHaveBeenCalledWith(15_000);
  });

  it("retains good products when another detail fails or has no variants", async () => {
    mocks.fetch.mockImplementation(async (url) => {
      if (String(url).endsWith("/products")) return response([{ id: 123 }, { id: 124 }, { id: 125 }, null]);
      if (String(url).endsWith("/123")) return response(product());
      if (String(url).endsWith("/124")) return response(null, 503);
      return response(product(125, []));
    });
    const catalog = await getStoreProducts();
    expect(catalog.products.map(({ id }) => id)).toEqual([123]);
    expect(catalog.unavailable).toBe(true);
    const markup = renderToStaticMarkup(await StorePage());
    expect(markup).toContain("Velocity shirt");
    expect(markup).toContain("$29.99");
    expect(markup).toContain("Some products are temporarily unavailable");
  });

  it("handles malformed catalog responses and distinguishes an empty store", async () => {
    mocks.fetch.mockResolvedValueOnce(response({ products: [] }));
    expect(await getStoreProducts()).toEqual({ products: [], unavailable: true });
    mocks.fetch.mockResolvedValueOnce(response([]));
    expect(await getStoreProducts()).toEqual({ products: [], unavailable: false });
    expect(renderToStaticMarkup(await StorePage())).toContain("No products are currently available");
  });

  it("filters variants by the same eligibility rules used by checkout", async () => {
    const invalid = [
      null, variant({ synced: false }), variant({ is_ignored: true }),
      variant({ currency: "EUR" }), variant({ retail_price: "0.49" }),
      variant({ retail_price: "29.99junk" }), variant({ retail_price: "1.001" }),
      variant({ retail_price: "99999999999999999999" }), variant({ name: "" }),
      variant({ id: -1 }),
    ];
    mocks.fetch.mockResolvedValue(response(product(123, [...invalid, variant()])));
    const result = await getStoreProduct("123");
    expect(result.status).toBe("available");
    if (result.status !== "available") throw new Error("Expected an available product");
    expect(result.product.variants).toEqual([{ id: 456, name: "Velocity shirt / M", retailPrice: "29.99" }]);
    const form = new FormData();
    form.set("product_id", "123");
    form.set("sync_variant_id", String(result.product.variants[0].id));
    const checkout = await checkoutParams(form, "https://example.com", "key", async () => response(product()));
    expect(checkout.line_items?.[0].price_data?.unit_amount).toBe(2999);
  });

  it("renders unavailable instead of a checkout form when there are no purchasable variants", async () => {
    mocks.fetch.mockResolvedValue(response(product(123, [variant({ synced: false })])));
    const markup = renderToStaticMarkup(await ProductDetailPage({ params: Promise.resolve({ id: "123" }) }));
    expect(markup).toContain("Product temporarily unavailable");
    expect(markup).not.toContain("Checkout with Stripe");
  });

  it("uses a real not-found boundary only for missing products", async () => {
    mocks.fetch.mockResolvedValue(response(null, 404));
    await expect(ProductDetailPage({ params: Promise.resolve({ id: "123" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("never lists ignored products and falls back safely when thumbnails are absent", async () => {
    const ignored = product();
    ignored.sync_product.is_ignored = true;
    mocks.fetch.mockResolvedValueOnce(response(ignored));
    expect(await getStoreProduct("123")).toEqual({ status: "unavailable" });
    mocks.fetch.mockResolvedValueOnce(response(product(124)));
    const result = await getStoreProduct("124");
    expect(result.status === "available" && result.product.thumbnailUrl).toBe(null);
  });

  it("reuses validated detail values across listing and product reads", async () => {
    mocks.fetch.mockResolvedValueOnce(response([{ id: 123 }, { id: 123 }]))
      .mockResolvedValueOnce(response(product()));
    expect((await getStoreProducts()).products).toHaveLength(1);
    expect((await getStoreProduct("123")).status).toBe("available");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[1][1]).toMatchObject({ cache: "no-store", headers: { Authorization: "Bearer test-key" } });
  });
});
