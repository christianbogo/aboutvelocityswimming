import Link from "next/link";
import ImportsReview from "@/components/collection/ImportsReview";
import { InventoryPage } from "@/components/collection/ImportsInventory";
import styles from "@/components/collection/ImportsInventory.module.css";

export const metadata = { title: "Import | Velocity Imports" };

export default function Page() {
  return (
    <InventoryPage title="Import" description="Review newly collected meets and swims before publishing them.">
      <p className={styles.notice}>
        <Link href="/tools/review/batches">Batch review and history</Link>
        {" · "}
        <Link href="/tools/review/overview">Imports overview</Link>
      </p>
      <ImportsReview />
    </InventoryPage>
  );
}
