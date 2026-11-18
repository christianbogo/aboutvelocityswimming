import Link from "next/link";
import ImportsReview from "@/components/collection/ImportsReview";
import styles from "@/components/collection/ImportsInventory.module.css";
import { heldUuid } from "@/lib/collection/held-observations";

export const metadata = { title: "Import | Velocity Imports" };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ batchId?: string | string[] }>;
}) {
  const { batchId } = await searchParams;
  const batch = typeof batchId === "string" && heldUuid.test(batchId) ? batchId : "";
  return (
    <main className={styles.page} aria-label="Velocity Imports">
      <header className={styles.intro}>
        <p><Link href="/tools/review/batches">Batch review and history</Link></p>
      </header>
      <ImportsReview key={batch} initialSwimsBatchId={batch} />
    </main>
  );
}
