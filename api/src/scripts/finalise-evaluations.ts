/**
 * Record the supplier evaluations left waiting for a review that no longer exists.
 *
 * Until 2026-11-16 a saved evaluation waited at `pending_hod` for a department
 * head's review and a COO sign-off that no screen offered, so it never counted
 * towards the rankings and the supplier was never marked as evaluated. Saving
 * is now final. This brings the ones already saved into line: each becomes
 * `approved` (shown as "Recorded"), and its supplier gets the evaluation date
 * and next review date that recording would have given it.
 *
 *   npm run finalise:evaluations -- --dry-run
 *   npm run finalise:evaluations
 *   npm run finalise:evaluations -- --only DOKUMA,FOSSIL
 *   npm run finalise:evaluations:prod -- --dry-run
 *
 * Safe to run again: it only touches evaluations still waiting.
 */
import mongoose from 'mongoose';
import { loadEnvFiles } from '../config/loadEnv.js';

loadEnvFiles();

import { getNextReviewDate } from '@fossil/shared';
import { activeSbus } from '../tenancy/registry.js';
import { connectionForSbu } from '../tenancy/connections.js';
import type { SbuRef } from '../tenancy/sbuContext.js';

const WAITING = ['pending_hod', 'pending_sec'];

function arg(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : null;
}

async function finaliseSbu(sbu: SbuRef, dryRun: boolean): Promise<number> {
  const connection = connectionForSbu(sbu);
  const SupplierEvaluation = connection.model('SupplierEvaluation');
  const SupplierProfile = connection.model('SupplierProfile');

  const waiting = await SupplierEvaluation.find({ status: { $in: WAITING }, isDeleted: { $ne: true } })
    .select('supplier createdAt')
    .lean<Array<{ _id: unknown; supplier?: unknown; createdAt: Date }>>();

  console.log(`\n${sbu.code}  (${sbu.dbName})  ${waiting.length} evaluation(s) waiting`);
  if (waiting.length === 0) return 0;

  // The newest waiting evaluation per supplier is the one that dates them.
  const newest = new Map<string, Date>();
  for (const evaluation of waiting) {
    if (!evaluation.supplier) continue;
    const key = String(evaluation.supplier);
    const at = new Date(evaluation.createdAt);
    if (!newest.has(key) || at > newest.get(key)!) newest.set(key, at);
  }

  if (!dryRun) {
    await SupplierEvaluation.updateMany(
      { _id: { $in: waiting.map((e) => e._id) } },
      { $set: { status: 'approved' } }
    );
  }

  for (const [supplierId, evaluatedAt] of newest) {
    const supplier = await SupplierProfile.findById(supplierId)
      .select('companyName tier lastEvaluationAt')
      .lean<{ companyName?: string; tier?: string; lastEvaluationAt?: Date } | null>();
    if (!supplier) continue;

    // A later evaluation already on record keeps its dates.
    if (supplier.lastEvaluationAt && new Date(supplier.lastEvaluationAt) >= evaluatedAt) {
      console.log(`  = ${String(supplier.companyName).padEnd(36)} already dated ${new Date(supplier.lastEvaluationAt).toISOString().slice(0, 10)}`);
      continue;
    }

    const due = getNextReviewDate(supplier.tier, evaluatedAt);
    console.log(
      `  ${dryRun ? '~' : '+'} ${String(supplier.companyName).padEnd(36)} evaluated ${evaluatedAt.toISOString().slice(0, 10)}, ` +
        `next review ${due.toISOString().slice(0, 10)}${dryRun ? '  (dry run)' : ''}`
    );
    if (!dryRun) {
      await SupplierProfile.updateOne(
        { _id: supplierId },
        { $set: { lastEvaluationAt: evaluatedAt, nextEvaluationDue: due } }
      );
    }
  }
  return waiting.length;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is not set');
  await mongoose.connect(uri);
  if (dryRun) console.log('DRY RUN - nothing will be written');

  let sbus = await activeSbus();
  if (sbus.length === 0) throw new Error('The SBU registry is empty. Run seed:sbu-registry first.');

  const only = arg('only');
  if (only) {
    const wanted = new Set(only.split(',').map((code) => code.trim().toUpperCase()).filter(Boolean));
    sbus = sbus.filter((sbu) => wanted.has(sbu.code));
  }

  let total = 0;
  for (const sbu of sbus) total += await finaliseSbu(sbu, dryRun);

  console.log(`\n${total} evaluation(s) ${dryRun ? 'would be' : 'were'} recorded.`);
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error('Finalising evaluations failed:', error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
