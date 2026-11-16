import Link from "next/link";
import ImportsReview from "@/components/collection/ImportsReview";
import styles from "@/components/collection/ImportsInventory.module.css";

export const metadata = { title: "Import | Velocity Imports" };

export default function Page() {
  return (
    <main className={styles.page} aria-label="Velocity Imports">
      <header className={styles.intro}>
        <p><Link href="/tools/review/batches">Batch review and history</Link></p>
      </header>
      <ImportsReview />
    </main>
  );
}
