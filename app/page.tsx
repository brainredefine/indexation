// app/page.tsx
import Link from "next/link";

const AM_UID: Record<string, number> = {
  BKO: 8,
  CFR: 12,
  FKE: 7,
  MSC: 9,
};

const AM_ORDER = ["BKO", "CFR", "FKE", "MSC"] as const;

export default function Home() {
  return (
    <main className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Dashboards AM</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {AM_ORDER.map((code) => (
          <Link
            key={code}
            href={`/${code}`}
            className="rounded-2xl border p-4 hover:shadow transition"
          >
            <div className="text-xl font-medium">{code}</div>
            <div className="text-xs text-gray-500">See your indexations →</div>
          </Link>
        ))}

        {/* No AM = tout afficher */}
        <Link
          href="/no-am"
          className="rounded-2xl border p-4 hover:shadow transition"
        >
          <div className="text-xl font-medium">Everyone</div>
          <div className="text-xs text-gray-500">See all indexations →</div>
        </Link>
      </div>
    </main>
  );
}
