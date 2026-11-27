import type { Metadata } from "next";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import Footer from "@/components/Footer";
import ProductForm from "./ProductForm";
import ProductDetailGallery from "@/components/ProductDetailGallery";
import Link from "next/link";
import { getProductMockupImages } from "@/lib/mockups";
import styles from "../Store.module.css";
import { scopedClasses } from "@/lib/styles";
import { getStoreProduct } from "@/lib/store-catalog";

export const metadata: Metadata = {
  title: "Shop the Collection | Velocity Swimming",
  description: "Explore the Velocity Swimming collection and select your size.",
};

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await connection();
  const resolvedParams = await params;
  const productData = await getStoreProduct(resolvedParams.id);
  if (productData.status === "not-found") notFound();

  if (productData.status === "unavailable") {
    return (
      <main
        className={scopedClasses(styles, "product-detail-page")}
        style={{ position: "relative" }}
      >
        <div
          className={scopedClasses(styles, "section container text-center")}
          style={{ paddingTop: "3rem" }}
        >
          <h1 style={{ color: "var(--primary)" }}>
            Product temporarily unavailable
          </h1>
          <p>Please try again shortly or browse the rest of the collection.</p>
          <Link
            href="/store"
            className={scopedClasses(styles, "btn btn-secondary")}
            style={{ marginTop: "2rem" }}
          >
            Back to Store
          </Link>
        </div>
        <Footer />
      </main>
    );
  }

  const { product } = productData;

  // Only mockup photos, no design/artwork files
  const localMockups = getProductMockupImages(product.name);
  const imagesArray =
    localMockups.length > 0
      ? localMockups
      : product.thumbnailUrl
        ? [product.thumbnailUrl]
        : [];

  return (
    <main
      className={scopedClasses(styles, "product-detail-page")}
      style={{ position: "relative" }}
    >
      <div
        className={scopedClasses(styles, "section")}
        style={{ padding: "0 1.5rem" }}
      >
        <div className={scopedClasses(styles, "product-detail-grid")}>
          <div className={scopedClasses(styles, "product-detail-images")}>
            <ProductDetailGallery
              images={imagesArray}
              productName={product.name}
            />
          </div>

          <div className={scopedClasses(styles, "product-detail-info")}>
            <Link
              href="/store"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                marginBottom: "1.25rem",
                color: "var(--text-muted)",
                fontSize: "0.85rem",
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              &larr; Back to Collection
            </Link>

            <h1>{product.name}</h1>

            <ProductForm
              productId={product.id}
              productName={product.name}
              variants={product.variants}
            />

            <div
              className={scopedClasses(styles, "product-description")}
              style={{ marginTop: "2.25rem", color: "var(--text-muted)" }}
            >
              <p>
                Part of Velocity&apos;s 2026-2027 Caden Ankrom Collection. Each
                purchase supports Velocity Swimming and the artist.
              </p>
            </div>
          </div>
        </div>
      </div>

      <Footer />
    </main>
  );
}
