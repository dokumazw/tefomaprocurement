import type { Request, Response } from 'express';
import {
  SUPPLIER_EVALUATION_CRITERIA,
  getNextReviewDate,
  getReviewIntervalMonths,
  validateSupplierEvaluation
} from '@fossil/shared';
import { SupplierProfile, SupplierEvaluation } from '../../models/index.js';
import { createAuditLog } from '../../middleware/index.js';
import { refuseInvalid } from '../../lib/validation.js';

const createSupplierEvaluation = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { scores, recommendation, evaluationType, otherNotes } = req.body;

    const supplier = await SupplierProfile.findById(id);
    if (!supplier || supplier.isDeleted) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    // Every criterion scored 1 to 5, and a recommendation (see validateSupplierEvaluation).
    if (refuseInvalid(res, validateSupplierEvaluation(req.body))) return;

    // Range-check here rather than letting the schema throw a 500. The
    // validator allows a score sent as text ("4"); the record stores numbers.
    const badScores = SUPPLIER_EVALUATION_CRITERIA.map((c) => c.key).filter((key) => {
      const value = (scores as any)[key];
      if (value === undefined || value === null) return false;
      return typeof value !== 'number' || value < 1 || value > 5;
    });
    if (badScores.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Scores must be numbers between 1 and 5. Invalid: ${badScores.join(', ')}`,
        errors: Object.fromEntries(badScores.map((key) => [`scores.${key}`, 'Score must be a number from 1 to 5']))
      });
    }

    // Review cadence follows the supplier's tier rather than a flat quarter:
    // a transactional vendor does not warrant the same cycle as a sole-source
    // one, and a uniform cadence is what made the review backlog unworkable.
    const nextReviewDue = getNextReviewDate(supplier.tier);

    // The client sends notes inside `scores`; older callers sent them at the
    // top level. Spreading an undefined top-level value used to erase them.
    const notes = (scores as any).otherNotes ?? otherNotes;

    // An evaluation is final when saved: there is no review step (decided
    // 2026-11-16; the page and the user manual say so). It used to wait at
    // pending_hod for a review no screen offered, so no score ever reached
    // the rankings, which count recorded evaluations only. `approved` is the
    // recorded state the rankings and reports read.
    const evaluation = await SupplierEvaluation.create({
      supplier: supplier._id,
      evaluationType: evaluationType || 'initial',
      scores: { ...scores, otherNotes: notes },
      recommendation,
      evaluatedBy: req.user!._id,
      status: 'approved',
      secApproved: false,
      nextReviewDue
    });

    // The supplier's tier decides when they come round again. Set directly
    // rather than by saving the whole profile, so an older record that would
    // fail today's validation cannot stop the evaluation being recorded.
    await SupplierProfile.updateOne(
      { _id: supplier._id },
      { $set: { lastEvaluationAt: evaluation.createdAt, nextEvaluationDue: nextReviewDue } }
    );

    await createAuditLog({
      action: 'create',
      entity: 'SupplierEvaluation',
      entityId: evaluation._id,
      user: req.user,
      description: `Recorded supplier evaluation for ${supplier.companyName}`,
      newData: {
        status: 'approved',
        recommendation,
        tier: supplier.tier,
        reviewIntervalMonths: getReviewIntervalMonths(supplier.tier)
      },
      req
    });

    res.status(201).json({
      success: true,
      message: 'Evaluation recorded.',
      data: evaluation
    });
  } catch (error: any) {
    console.error('Create evaluation error:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error' });
  }
};

export default createSupplierEvaluation;
