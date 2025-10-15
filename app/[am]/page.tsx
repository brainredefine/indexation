// app/[am]/page.tsx
import { notFound } from "next/navigation";
import ClientTable from "./ClientTable";

const AM_LIST = ["BKO", "CFR", "FKE", "MSC"] as const;

export default function AMPage({ params }: { params: { am: string } }) {
  const amSlug = (params.am || "").toUpperCase();
  const isNoAM = amSlug === "NO-AM";
  const valid = isNoAM || AM_LIST.includes(amSlug as any);
  if (!valid) notFound();

  return <ClientTable amSlug={amSlug} />;
}
