import Link from "next/link";
import ReviewQueue from "@/components/collection/ReviewQueue";
import { heldUuid } from "@/lib/collection/held-observations";
import styles from "../review.module.css";

export const metadata = { title: "Batch review and history | Velocity Imports" };

export default async function Page({ searchParams }: {
  searchParams: Promise<{ batchId?: string | string[] }>;
}) {
  const { batchId } = await searchParams;
  const batch = typeof batchId === "string" && heldUuid.test(batchId) ? batchId : "";
  return (
    <main className={styles.page}>
      <header className={styles.intro}>
        <h1>Batch review and history</h1>
        <p><Link href="/tools/review">Back to Import</Link></p>
      </header>
      <ReviewQueue key={batch} initialBatchSearch={batch} />
    </main>
  );
}
