import Link from "next/link";
import Footer from "@/components/Footer";
import { scopedClasses } from "@/lib/styles";
import styles from "../Store.module.css";

export default function ProductNotFound() {
  return (
    <main className={scopedClasses(styles, "product-detail-page")}>
      <div className={scopedClasses(styles, "section container text-center")}>
        <h1>Product not found</h1>
        <p>This product is no longer in the collection.</p>
        <Link
          href="/store"
          className={scopedClasses(styles, "btn btn-secondary")}
        >
          Back to Store
        </Link>
      </div>
      <Footer />
    </main>
  );
}
