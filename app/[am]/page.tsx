// app/[am]/page.tsx
import { notFound } from "next/navigation";
import ClientTable from "./ClientTable";

const AM_LIST = ["BKO", "CFR", "FKE", "MSC"] as const;
type AM = typeof AM_LIST[number];

export default function AMPage({ params }: { params: { am: string } }) {
  const amSlugRaw = (params.am || "").toUpperCase();
  const isNoAM = amSlugRaw === "NO-AM";
  const valid = isNoAM || (AM_LIST as readonly string[]).includes(amSlugRaw);
  if (!valid) notFound();

  // ClientTable attend une string: on passe telle quelle
  return <ClientTable amSlug={amSlugRaw} />;
}
