import type { Offer } from "@autovoyage/shared";
import type { Sql } from "./db.js";
import { list } from "./db.js";
interface ArchivedOffer extends Offer {
  offerId: string;
}
/** Overlapping windows on one logical service resolve to the highest valid version for the service day. */
export async function effectiveOffers(
  sql: Sql,
  date: string,
  headers?: Offer[],
): Promise<Offer[]> {
  const current = headers || (await list<Offer>(sql, "offers"));
  const history = await list<ArchivedOffer>(sql, "offer_versions");
  const result: Offer[] = [];
  for (const header of current) {
    if (!header.active) continue;
    const candidates = history
      .filter(
        (v) =>
          v.offerId === header.id &&
          (v.active || v.version === header.version) &&
          v.validFrom <= date &&
          v.validTo >= date,
      )
      .sort((a, b) => b.version - a.version);
    const chosen =
      candidates[0] ||
      (header.validFrom <= date && header.validTo >= date ? header : null);
    if (chosen)
      result.push({ ...chosen, id: header.id, active: header.active });
  }
  return result;
}
