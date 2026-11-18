import WorkshareClient from "@/features/workshare/Client";

export const metadata = { title: "Admin | Velocity Swimming" };

export default function AdminPage() {
  return <WorkshareClient view="families" />;
}
