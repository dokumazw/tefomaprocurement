import type { Request, Response } from 'express';
import { RFQ, Quotation, User } from '../../models/index.js';
import { isProcurementHead, validateQuotationSelection } from '@fossil/shared';
import { meetsMinimumQuotations, refId, selectionLocked } from '../../services/quotationCompliance.service.js';
import { createAuditLog } from '../../middleware/index.js';
import { createNotifications } from '../../services/notification.service.js';
import { refuseInvalid } from '../../lib/validation.js';

/**
 * Procurement selects the winning quotation, with a justification.
 *
 * This was the requesting department head's step (Rev 9 clause 5.2.1); it now
 * sits with procurement, who run the sourcing. The record keeps its
 * `hodSelection` name so existing RFQs read the same.
 *
 * A selection can be changed, by any procurement officer or the Head of
 * Procurement, until it is authorized. That is what keeps an award moving when
 * the Head of Procurement selects: they cannot authorize their own selection,
 * so an officer confirms it under their own name and the head authorizes.
 * Once authorized, or awarded, it is fixed: changing it then would let the
 * authorizer become the selector, or carry an authorization to a quotation it
 * was never given for.
 */
const selectQuotation = async (req: Request, res: Response): Promise<any> => {
  try {
    const { id } = req.params;
    const { quotationId, justification } = req.body;

    if (refuseInvalid(res, validateQuotationSelection(req.body))) return;

    const rfq = await RFQ.findById(id);
    if (!rfq || rfq.isDeleted) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }

    if (selectionLocked(rfq)) {
      return res.status(409).json({
        success: false,
        message:
          (rfq as any).status === 'awarded'
            ? 'This RFQ has been awarded, so its selection cannot change.'
            : 'The Head of Procurement has authorized this selection, so it cannot change.'
      });
    }

    const quotation = await Quotation.findOne({ _id: quotationId, rfq: id, isDeleted: false });
    if (!quotation) {
      return res.status(404).json({ success: false, message: 'Quotation not found for this RFQ' });
    }

    const previous = rfq.hodSelection?.quotation ? String(rfq.hodSelection.quotation) : null;
    const previousSelector = refId(rfq.hodSelection?.approvedBy);

    const { met, count } = await meetsMinimumQuotations(String(rfq._id), rfq);
    if (!met) {
      return res.status(400).json({
        success: false,
        message: `Minimum ${3} quotations required or an approved waiver (currently ${count})`,
        data: { quotationCount: count }
      });
    }

    rfq.hodSelection = {
      quotation: quotation._id,
      justification: justification.trim(),
      approvedBy: req.user!._id,
      approvedAt: new Date()
    };
    rfq.selectedQuotation = quotation._id;
    await rfq.save();

    await createAuditLog({
      action: 'approve',
      entity: 'RFQ',
      entityId: rfq._id,
      user: req.user,
      description: previous
        ? previous === String(quotation._id)
          ? `Procurement confirmed the selected quotation for RFQ ${rfq.rfqNumber}`
          : `Procurement changed the selected quotation for RFQ ${rfq.rfqNumber}`
        : `Procurement selected quotation for RFQ ${rfq.rfqNumber}`,
      previousData: previous ? { quotationId: previous, selectedBy: previousSelector } : undefined,
      newData: { quotationId, justification },
      req
    });

    // Authorization is the Head of Procurement's, so tell them, not the officers.
    // The notification points at the quotation: that page carries the
    // authorize control, the RFQ page does not.
    // Never the selector themselves: they cannot authorize their own choice.
    const heads = (
      await User.find({ role: 'department_head', status: 'active', isDeleted: false })
        .select('_id email firstName lastName role department')
        .populate('department', 'name code')
    ).filter((u: any) => isProcurementHead(u) && String(u._id) !== String(req.user!._id));
    if (heads.length) await createNotifications(heads, {
      type: 'quotation_submitted',
      title: 'Quotation selected — your authorization required',
      message: `RFQ ${rfq.rfqNumber}: a quotation was selected. Head of Procurement authorization required.`,
      entity: 'Quotation',
      entityId: quotation._id,
      relatedUser: req.user!._id
    });

    // When the Head of Procurement selects, nobody can authorize it as it
    // stands, so the officers are asked to confirm it under their own name.
    if (isProcurementHead(req.user)) {
      const officers = await User.find({ role: 'procurement_officer', status: 'active', isDeleted: false })
        .select('_id email firstName lastName role');
      if (officers.length) await createNotifications(officers, {
        type: 'quotation_submitted',
        title: 'Selection needs confirming',
        message: `RFQ ${rfq.rfqNumber}: the Head of Procurement selected a quotation and cannot also authorize it. Confirm the selection so they can.`,
        entity: 'Quotation',
        entityId: quotation._id,
        relatedUser: req.user!._id
      });
    }

    res.status(200).json({
      success: true,
      message: isProcurementHead(req.user)
        ? 'Quotation selected. A procurement officer must confirm it before you can authorize it.'
        : 'Quotation selected. Awaiting Procurement Manager authorization.',
      data: rfq
    });
  } catch (error) {
    console.error('Select quotation error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export default selectQuotation;
