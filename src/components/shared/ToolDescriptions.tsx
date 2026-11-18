"use client";

import { useAuth } from "@/features/workshare/contexts/auth";
import { getToolsCapabilities } from "@/lib/tools-access";
import { getAvailableTools } from "@/lib/tool-directory";

export default function ToolDescriptions() {
  const { user } = useAuth();

  return (
    <section
      aria-labelledby="about-tools-heading"
      className="mt-10 border-t border-border pt-8"
    >
      <h2 id="about-tools-heading" className="mb-5 text-xl font-semibold">
        About the tools
      </h2>
      <ul className="max-w-2xl space-y-5">
        {getAvailableTools(getToolsCapabilities(user)).map(
          ([id, { title, description }]) => (
            <li key={id}>
              <h3 className="text-sm font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-text-secondary">
                {description}
              </p>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}
