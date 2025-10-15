// lib/odoo.ts
import "server-only";

/* ========= Config ========= */
export interface OdooConfig {
  url: string;
  db: string;
  user: string;
  /** Mot de passe OU API key (les deux sont supportés) */
  passwordOrKey: string;
}

/* ========= JSON-RPC infra ========= */
interface RpcError {
  code?: number;
  message: string;
  data?: { name?: string; message?: string; debug?: string };
}
interface RpcEnvelope<T> {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: T;
  error?: RpcError;
}

async function postJsonRpc<T>(endpoint: string, payload: unknown): Promise<T> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: payload }),
    cache: "no-store",
  });
  const data = (await res.json()) as RpcEnvelope<T>;
  if (data.error) {
    const dbg = data.error.data?.debug ? `\n${data.error.data.debug}` : "";
    throw new Error(`Odoo RPC error: ${data.error.message}${dbg}`);
  }
  if (typeof data.result === "undefined") throw new Error("Odoo RPC: result undefined");
  return data.result;
}

/* ========= Types utiles ========= */
export type OdooM2O<TId = number, TName = string> = [TId, TName];
export const m2oId = (v: OdooM2O | false | null | undefined): number | null =>
  Array.isArray(v) && typeof v[0] === "number" ? v[0] : null;

/* ========= Helpers ========= */
export function hasOdooEnv(cfg?: Partial<OdooConfig>): boolean {
  const url = cfg?.url ?? process.env.ODOO_URL ?? "";
  const db = cfg?.db ?? process.env.ODOO_DB ?? "";
  const user = cfg?.user ?? process.env.ODOO_USER ?? "";
  const pwdOrKey =
    cfg?.passwordOrKey ?? process.env.ODOO_API ?? process.env.ODOO_PWD ?? "";
  return Boolean(url && db && user && pwdOrKey);
}

/* ========= Client ========= */
export class OdooClient {
  private cfg: OdooConfig;

  constructor(cfg?: Partial<OdooConfig>) {
    const url = cfg?.url ?? process.env.ODOO_URL ?? "";
    const db = cfg?.db ?? process.env.ODOO_DB ?? "";
    const user = cfg?.user ?? process.env.ODOO_USER ?? "";
    const passwordOrKey =
    cfg?.passwordOrKey ?? process.env.ODOO_API ?? process.env.ODOO_PWD ?? "";
    this.cfg = { url, db, user, passwordOrKey };
    if (!hasOdooEnv(this.cfg)) {
      throw new Error("Odoo env vars manquantes (ODOO_URL/DB/USER/API ou PWD)");
    }
  }

  /** Auth simple → uid numérique (>0 si OK) */
  async authenticate(): Promise<number> {
    const uid = await postJsonRpc<number>(`${this.cfg.url}/jsonrpc`, {
      service: "common",
      method: "authenticate",
      args: [this.cfg.db, this.cfg.user, this.cfg.passwordOrKey, {}],
    });
    if (!uid || uid <= 0) throw new Error("Échec d'authentification Odoo");
    return uid;
  }

  async executeKw<T>(
    model: string,
    method: string,
    args: unknown[],
    kwargs?: Record<string, unknown>
  ): Promise<T> {
    const uid = await this.authenticate();
    return postJsonRpc<T>(`${this.cfg.url}/jsonrpc`, {
      service: "object",
      method: "execute_kw",
      args: [this.cfg.db, uid, this.cfg.passwordOrKey, model, method, args, kwargs ?? {}],
    });
  }

  async searchRead<T extends object>(
    model: string,
    domain: unknown[],
    fields: string[],
    limit = 5000,
    offset = 0
  ): Promise<T[]> {
    return this.executeKw<T[]>(model, "search_read", [domain], {
      fields,
      limit,
      offset,
    });
  }
}

/* ========= util: ping ========= */
export async function odooPing(): Promise<number> {
  const c = new OdooClient();
  return c.authenticate();
}
