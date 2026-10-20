import "server-only";
import { and, asc, count, eq, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { contacts, products, requestItems, sampleRequests, type RequestStatus } from "@/db/schema";
import { parseRequestCode } from "@/lib/format";
import { likePattern } from "@/lib/search";
import { OPEN_STATUSES } from "@/lib/status";

export const OPEN_LIST_PAGE_SIZE = 50;

export type OpenListFilters = {
  status: RequestStatus | null;
  q: string;
  publicOnly: boolean;
  page: number;
};

export type OpenListRow = {
  id: number;
  status: RequestStatus;
  receivedAt: Date;
  source: "INTERNO" | "MODULO_PUBBLICO";
  destinationAddress: string;
  deliveryFormRequired: boolean;
  deliveryFormReady: boolean;
  contactId: number;
  contactName: string;
  contactNeedsReview: boolean;
  agentName: string | null;
  itemsCount: number;
  firstCodes: string[];
};

const agents = alias(contacts, "agents");

/** Condizioni comuni (tutte le aperte + ricerca + origine), senza il filtro di stato. */
function baseConditions(f: OpenListFilters): SQL[] {
  const conds: SQL[] = [ne(sampleRequests.status, "COMPLETATA")];
  if (f.publicOnly) conds.push(eq(sampleRequests.source, "MODULO_PUBBLICO"));
  const q = f.q.trim().slice(0, 100);
  if (q) {
    const pattern = likePattern(q);
    const ors: SQL[] = [
      ilike(contacts.name, pattern),
      ilike(contacts.company, pattern),
      sql`exists (select 1 from ${requestItems} ri join ${products} p on p.id = ri.product_id
        where ri.request_id = ${sampleRequests.id} and p.code ilike ${pattern})`,
    ];
    const id = parseRequestCode(q);
    if (id) ors.push(eq(sampleRequests.id, id));
    conds.push(or(...ors)!);
  }
  return conds;
}

/**
 * Vista "Back office — tutte le aperte": richieste non completate, dalla più vecchia.
 * Due query per la pagina (righe + prodotti delle sole righe mostrate) e una per i conteggi per stato.
 */
export async function getOpenRequests(f: OpenListFilters) {
  const base = baseConditions(f);

  const countRows = await db
    .select({ status: sampleRequests.status, n: count() })
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .where(and(...base))
    .groupBy(sampleRequests.status);
  const counts = Object.fromEntries(OPEN_STATUSES.map((s) => [s, 0])) as Record<RequestStatus, number>;
  for (const r of countRows) counts[r.status] = r.n;
  const totalOpen = OPEN_STATUSES.reduce((sum, s) => sum + counts[s], 0);
  const total = f.status ? counts[f.status] : totalOpen;

  const where = f.status ? and(...base, eq(sampleRequests.status, f.status)) : and(...base);
  const rows = await db
    .select({
      id: sampleRequests.id,
      status: sampleRequests.status,
      receivedAt: sampleRequests.receivedAt,
      source: sampleRequests.source,
      destinationAddress: sampleRequests.destinationAddress,
      deliveryFormRequired: sampleRequests.deliveryFormRequired,
      deliveryFormReady: sampleRequests.deliveryFormReady,
      contactId: contacts.id,
      contactName: contacts.name,
      contactNeedsReview: contacts.needsReview,
      agentName: agents.name,
    })
    .from(sampleRequests)
    .innerJoin(contacts, eq(contacts.id, sampleRequests.contactId))
    .leftJoin(agents, eq(agents.id, contacts.agentId))
    .where(where)
    .orderBy(asc(sampleRequests.receivedAt), asc(sampleRequests.id))
    .limit(OPEN_LIST_PAGE_SIZE)
    .offset((f.page - 1) * OPEN_LIST_PAGE_SIZE);

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db
        .select({ requestId: requestItems.requestId, code: products.code })
        .from(requestItems)
        .innerJoin(products, eq(products.id, requestItems.productId))
        .where(inArray(requestItems.requestId, ids))
        .orderBy(asc(requestItems.requestId), asc(requestItems.id))
    : [];
  const codesByRequest = new Map<number, string[]>();
  for (const it of items) {
    const list = codesByRequest.get(it.requestId) ?? [];
    list.push(it.code);
    codesByRequest.set(it.requestId, list);
  }

  const list: OpenListRow[] = rows.map((r) => {
    const codes = codesByRequest.get(r.id) ?? [];
    return { ...r, itemsCount: codes.length, firstCodes: codes.slice(0, 2) };
  });

  return { rows: list, counts, totalOpen, total };
}
