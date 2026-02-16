// app/[am]/page.tsx
import { notFound } from "next/navigation";
import ClientTable from "./ClientTable";

const AM_LIST = ["BKO", "CFR", "FKE", "MSC"] as const;
type AM = (typeof AM_LIST)[number];

export default async function AMPage({ params }: { params: Promise<{ am: string }> }) {
  const { am } = await params;
  const amSlugRaw = (am || "").toUpperCase();
  const isNoAM = amSlugRaw === "NO-AM";
  const valid = isNoAM || (AM_LIST as readonly string[]).includes(amSlugRaw);
  if (!valid) notFound();

  return <ClientTable amSlug={amSlugRaw} />;
}