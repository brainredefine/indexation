import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const user = process.env.BASIC_AUTH_USER || "";
const pass = process.env.BASIC_AUTH_PASS || "";

function unauthorized() {
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
  });
}

export function middleware(req: NextRequest) {
  // si pas configuré, on laisse passer
  if (!user || !pass) return NextResponse.next();

  // ne protège pas les assets/statics
  const { pathname } = req.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico|txt|map)$/)
  ) {
    return NextResponse.next();
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return unauthorized();

  const base64 = auth.slice(6);
  const [u, p] = Buffer.from(base64, "base64").toString().split(":");
  if (u !== user || p !== pass) return unauthorized();

  return NextResponse.next();
}

// protège tout sauf les assets ci-dessus
export const config = {
  matcher: ["/:path*"],
};
