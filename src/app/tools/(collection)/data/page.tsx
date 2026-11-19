import { redirect } from "next/navigation";
import { dataOwner } from "@/lib/results/server";
import DataManager from "@/components/data/DataManager";
export const metadata = { title: "Data | Velocity Swimming" };
export default async function Page() {
  const auth = await dataOwner();
  if (auth.denied) redirect("/login");
  return <DataManager />;
}
