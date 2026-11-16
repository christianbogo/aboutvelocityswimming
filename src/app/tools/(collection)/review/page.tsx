import ImportsReview from "@/components/collection/ImportsReview";
import styles from "@/components/collection/ImportsInventory.module.css";

export const metadata = { title: "Import | Velocity Imports" };

export default function Page() {
  return (
    <main className={styles.page} aria-label="Velocity Imports">
      <ImportsReview />
    </main>
  );
}
