"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui";
import { t } from "@/i18n";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const signOut = async () => {
    setPending(true);
    setError(null);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/login");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("common.errorGeneric"),
      );
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="secondary"
        size="lg"
        onClick={signOut}
        loading={pending}
        className="w-full"
      >
        <LogOut size={18} aria-hidden="true" />
        {t("cleaner.signOut")}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
