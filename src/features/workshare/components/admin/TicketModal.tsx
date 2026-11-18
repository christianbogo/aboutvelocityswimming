"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/shared/Button";
import { Dialog } from "@/components/shared/Dialog";

export function TicketModal({
  title,
  subtitle,
  children,
  onClose,
  closing = false,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  closing?: boolean;
}) {
  return (
    <Dialog
      label={title}
      onClose={onClose}
      className="overflow-y-auto bg-black/35"
    >
      <div className="flex min-h-full items-start justify-center p-4 sm:px-6 sm:py-10">
        <section className="w-full max-w-3xl space-y-5 rounded-2xl border border-border bg-surface p-4 shadow-xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{title}</h2>
              {subtitle && (
                <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={closing}
              aria-label={`Close ${title.toLowerCase()}`}
              onClick={onClose}
              className="size-8 shrink-0 px-0"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {children}
        </section>
      </div>
    </Dialog>
  );
}
