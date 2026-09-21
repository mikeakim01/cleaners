"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, CalendarDays, ClipboardList, User } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/cn";

export function CleanerTabs({ tenantSlug }: { tenantSlug: string }) {
  const pathname = usePathname();
  const base = `/${tenantSlug}/cleaner`;
  const tabs = [
    { href: `${base}/jobs`, label: t("cleaner.tabJobs"), icon: <ClipboardList size={18} aria-hidden="true" /> },
    { href: `${base}/schedule`, label: t("cleaner.tabSchedule"), icon: <CalendarDays size={18} aria-hidden="true" /> },
    { href: `${base}/earnings`, label: t("cleaner.tabEarnings"), icon: <Briefcase size={18} aria-hidden="true" /> },
    { href: `${base}/profile`, label: t("cleaner.tabProfile"), icon: <User size={18} aria-hidden="true" /> },
  ];
  return (
    <nav
      aria-label={t("cleaner.tabsLabel")}
      className="sticky bottom-0 z-10 border-t border-border bg-surface"
    >
      <ul className="mx-auto grid w-full max-w-md grid-cols-4">
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname?.startsWith(`${tab.href}/`);
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium",
                  active ? "text-primary" : "text-muted",
                )}
              >
                {tab.icon}
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
