import type { Document, Model } from 'mongoose';
import type { ICounter } from '../models/Counter.model.js';
import { getSbu } from '../tenancy/sbuContext.js';

/**
 * Numbers already issued for one sequence, so the counter can be brought up
 * to them: the field holding the number, and the part before the year as a
 * regular expression (`PR`, or `ST-[A-Z]{3}` for the stock ledger).
 */
export interface IssuedNumbers {
  field: string;
  pattern: string;
}

/** Counters already caught up in this process, by database and key. */
const caughtUp = new Set<string>();

function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === 11000;
}

/**
 * Raise a counter to the highest number already issued, once per process.
 *
 * Several documents (requisitions, RFQs, store requisitions, the stock ledger,
 * issue notes) used to be numbered as "how many exist + 1" by their
 * controllers, bypassing this counter. That issued the same number twice to
 * two saves at the same moment. They now number here; this makes the counter
 * carry on after the numbers those controllers issued, instead of starting
 * again from 1 beside them. `$max` never lowers a counter, so running it again,
 * or from two processes at once, is harmless.
 */
async function catchUpWithIssued(
  doc: Document,
  Counter: Model<ICounter>,
  key: string,
  year: number,
  issued: IssuedNumbers
): Promise<void> {
  const cacheKey = `${doc.db.name}/${key}/${issued.field}`;
  if (caughtUp.has(cacheKey)) return;

  // The document's own model, bound to the same SBU database as the counter.
  const Owner = doc.constructor as Model<unknown>;
  const [row] = await Owner.aggregate<{ highest: number }>([
    { $match: { [issued.field]: { $regex: `(^|-)${issued.pattern}-${year}-\\d+$` } } },
    {
      $group: {
        _id: null,
        highest: { $max: { $toLong: { $arrayElemAt: [{ $split: [`$${issued.field}`, '-'] }, -1] } } }
      }
    }
  ]);

  const highest = Number(row?.highest) || 0;
  if (highest > 0) {
    try {
      await Counter.updateOne({ _id: key }, { $max: { seq: highest } }, { upsert: true });
    } catch (error) {
      // Another save created the counter in the same instant; raise that one.
      if (!isDuplicateKey(error)) throw error;
      await Counter.updateOne({ _id: key }, { $max: { seq: highest } });
    }
  }
  caughtUp.add(cacheKey);
}

/**
 * Reserve the next number in a sequence.
 *
 * The counter is read off `doc.db` — the connection the document is being
 * saved on — so it always lands in the same SBU database as the document, with
 * no dependency on the request context being set.
 */
export async function nextSequence(
  doc: Document,
  type: string,
  year: number,
  issued?: IssuedNumbers
): Promise<number> {
  const Counter = doc.db.model<ICounter>('Counter');
  const key = counterKey(type, year);

  if (issued) await catchUpWithIssued(doc, Counter, key, year, issued);

  const increment = () =>
    Counter.findOneAndUpdate(
      { _id: key },
      { $inc: { seq: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean<{ seq: number }>();

  let counter: { seq: number } | null;
  try {
    counter = await increment();
  } catch (error) {
    // Two first-ever saves of a type in a year can both try to create the
    // counter; the one that loses gets a duplicate key, and the counter now
    // exists, so it simply increments.
    if (!isDuplicateKey(error)) throw error;
    counter = await increment();
  }

  // `new: true` guarantees a document; the non-null assertion documents that.
  return counter!.seq;
}

export function counterKey(type: string, year: number): string {
  return `${type}:${year}`;
}

/**
 * The issuing SBU's code, leading every document number. Each SBU numbers in
 * its own database, so without it two units issue the same `PO-2026-00001`
 * and one supplier can hold two different orders under one number.
 */
export function sbuNumberPrefix(): string {
  const code = getSbu()?.code;
  return code ? `${code}-` : '';
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Reserve the next number and render it in this system's house format,
 * `<SBU>-<PREFIX>-<year>-<zero-padded sequence>`, e.g. `KHAYAH_CEMENT-PO-2026-00001`.
 *
 * The counter key is unchanged by the SBU prefix, so sequences carry on from
 * the numbers issued before it was added. Pass `field` (where the number is
 * stored) for a sequence that was once numbered elsewhere, so the counter
 * first catches up with the numbers already issued.
 */
export async function nextNumber(
  doc: Document,
  options: { type: string; prefix: string; pad?: number; year?: number; field?: string }
): Promise<string> {
  const year = options.year ?? new Date().getFullYear();
  const issued = options.field ? { field: options.field, pattern: escapeRegex(options.prefix) } : undefined;
  const seq = await nextSequence(doc, options.type, year, issued);
  return `${sbuNumberPrefix()}${options.prefix}-${year}-${String(seq).padStart(options.pad ?? 5, '0')}`;
}
