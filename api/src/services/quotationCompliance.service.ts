import { Quotation } from '../models/index.js';
import type { IRFQ } from '../models/RFQ.model.js';
import { MIN_QUOTATIONS_REQUIRED } from '@fossil/shared';

export async function countSubmittedQuotations(rfqId: string): Promise<number> {
  return Quotation.countDocuments({
    rfq: rfqId,
    isDeleted: false,
    status: { $in: ['submitted', 'under_review', 'accepted', 'rejected'] }
  });
}

/** The id of a user reference, whether populated or not. */
export function refId(ref: unknown): string | null {
  if (!ref) return null;
  const id = (ref as { _id?: unknown })._id ?? ref;
  return String(id);
}

/**
 * Whether the RFQ's selection may still change: not once the Head of
 * Procurement has authorized a quotation, and not once it is awarded.
 */
export function selectionLocked(rfq: IRFQ): boolean {
  return Boolean(rfq.pmAuthorization?.quotation) || (rfq as any).status === 'awarded';
}

export function hasValidQuotationWaiver(rfq: IRFQ): boolean {
  const w = (rfq as any).quotationWaiver;
  return Boolean(w?.waived && w?.reason && w?.approvedBy);
}

export async function meetsMinimumQuotations(rfqId: string, rfq?: IRFQ): Promise<{
  met: boolean;
  count: number;
  waived: boolean;
}> {
  return minimumQuotationsFrom(await countSubmittedQuotations(rfqId), rfq);
}

/** meetsMinimumQuotations for a count already taken with countSubmittedQuotations. */
export function minimumQuotationsFrom(count: number, rfq?: IRFQ): {
  met: boolean;
  count: number;
  waived: boolean;
} {
  const waived = rfq ? hasValidQuotationWaiver(rfq) : false;
  return {
    met: count >= MIN_QUOTATIONS_REQUIRED || waived,
    count,
    waived
  };
}

export function quotationFullyAuthorized(rfq: IRFQ, quotationId: string): boolean {
  const qid = String(quotationId);
  // With an approved waiver, competitive sourcing is already excepted, so the
  // selection step is not required — Procurement Manager authorization alone
  // is sufficient. Without a waiver, both the selection and PM authorization must
  // reference this quotation.
  const waived = hasValidQuotationWaiver(rfq);
  const hodOk =
    waived ||
    (rfq.hodSelection?.quotation &&
      String(rfq.hodSelection.quotation) === qid &&
      Boolean(rfq.hodSelection.justification));
  const pmOk =
    rfq.pmAuthorization?.quotation &&
    String(rfq.pmAuthorization.quotation) === qid;
  // Two people: whoever selected cannot be the one who authorized. The
  // authorize step refuses that, and a selection cannot change once
  // authorized; this holds for any record made before either rule.
  const selector = refId(rfq.hodSelection?.approvedBy);
  const authorizer = refId(rfq.pmAuthorization?.authorizedBy);
  const twoPeople = !selector || !authorizer || selector !== authorizer;
  return Boolean(hodOk && pmOk && twoPeople);
}
