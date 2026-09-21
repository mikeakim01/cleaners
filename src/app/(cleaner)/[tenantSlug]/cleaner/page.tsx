import { redirect } from "next/navigation";

export default async function CleanerIndex({
  params,
}: {
  params: Promise<{ tenantSlug: string }>;
}) {
  const { tenantSlug } = await params;
  redirect(`/${tenantSlug}/cleaner/jobs`);
}
