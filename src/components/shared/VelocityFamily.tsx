import { Mail, UsersRound } from "lucide-react";

export type AccountFamily = {
  id: string;
  preview: boolean;
  accounts: { name: string; email: string; role: string }[];
};

// Keep the existing membership gate while the family account backend is built.
// Replace this adapter with the family response when that endpoint is available.
export function familyPreview(
  familyId: string | null,
  email: string | null,
): AccountFamily | null {
  if (!familyId || !email) return null;
  return {
    id: familyId,
    preview: true,
    accounts: [
      { name: "Your account", email, role: "You" },
      {
        name: "Family member",
        email: "parent@example.com",
        role: "Parent / guardian",
      },
      {
        name: "Athlete account",
        email: "swimmer@example.com",
        role: "Athlete",
      },
    ],
  };
}

export default function VelocityFamily({
  family,
}: {
  family: AccountFamily | null;
}) {
  if (!family) return null;
  return (
    <section
      aria-labelledby="velocity-family-heading"
      className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <UsersRound className="size-5 text-accent" aria-hidden="true" />
        <h2 id="velocity-family-heading" className="text-xl font-semibold">
          Velocity Family
        </h2>
        {family.preview && (
          <span className="rounded-full bg-hover-bg px-2.5 py-1 text-xs font-medium text-text-secondary">
            Sample content
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
        {family.preview
          ? "A preview of the emails and accounts in your family. Family details are coming soon."
          : "The emails and accounts connected to your Velocity family."}
      </p>
      <ul className="mt-5 divide-y divide-border">
        {family.accounts.map((account) => (
          <li
            key={account.email}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-4 first:pt-0 last:pb-0"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-hover-bg text-text-secondary">
              <Mail className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{account.name}</p>
              <p className="break-all text-sm text-text-secondary">
                {account.email}
              </p>
            </div>
            <span className="text-xs text-text-secondary">{account.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
