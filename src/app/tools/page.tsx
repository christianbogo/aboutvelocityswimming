import type { Metadata } from "next";
import AccountProfile from "@/components/shared/AccountProfile";

export const metadata: Metadata = {
  title: "Account | Velocity Swimming",
  description:
    "Manage sign-in options, your Velocity family, and the athletes you track.",
};

export default function AccountPage() {
  return (
    <main
      aria-labelledby="account-heading"
      className="mx-auto w-full max-w-4xl px-5 pt-5 pb-16 sm:px-8 sm:pt-8 lg:px-12 lg:pt-12"
    >
      <h1
        id="account-heading"
        className="text-3xl font-bold tracking-tight sm:text-4xl"
      >
        Account
      </h1>
      <p className="mt-2 mb-7 text-sm text-text-secondary">
        Your sign-in options, family, and athletes in one place.
      </p>
      <AccountProfile />
      <section
        aria-labelledby="community-project-heading"
        className="mt-8 border-t border-border pt-6"
      >
        <h2 id="community-project-heading" className="text-lg font-semibold">
          A community project
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text-secondary">
          This website, database, and data viewer are a community project, made
          better with your help. If you find missing or incorrect data, please
          reach out to{" "}
          <a
            href="mailto:coachchristian@velocity-swimming.com"
            className="underline underline-offset-2"
          >
            Coach Christian
          </a>{" "}
          so we can improve it together.
        </p>
      </section>
    </main>
  );
}
