// app/page.tsx
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen w-full bg-gray-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md text-center space-y-6">

        <h1 className="text-3xl font-semibold text-gray-900">
          Indexation Dashboard
        </h1>

        <p className="text-sm text-gray-700">
          Access and manage all rent indexations in one place.
        </p>

        <Link
          href="/NO-AM"
          className="block w-full rounded-xl bg-white border border-gray-300 px-6 py-4 text-base font-medium text-gray-900 shadow-sm hover:bg-gray-50 transition"
        >
          Access indexations →
        </Link>

      </div>
    </main>
  );
}
