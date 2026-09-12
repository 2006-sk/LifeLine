import { CommandCenter } from "@/components/command/CommandCenter";

export const dynamic = "force-dynamic";

export default async function CommandPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const params = await searchParams;
  return <CommandCenter autoDemo={params?.demo === "1"} />;
}
