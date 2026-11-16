import mongoose, { Schema, type Document } from 'mongoose';
import { nextSequence, sbuNumberPrefix } from '../services/numbering.service.js';

export interface IStoreTransaction extends Document {
  transactionNumber: string;
  type: 'receipt' | 'issue' | 'adjustment' | 'transfer' | 'return';
  item: mongoose.Types.ObjectId | any;
  site: mongoose.Types.ObjectId | any;
  inventory: mongoose.Types.ObjectId | any;
  quantity: number;
  previousQuantity: number;
  newQuantity: number;
  unitCost?: number;
  totalValue?: number;
  reference?: {
    type?: 'grv' | 'store_requisition' | 'purchase_requisition' | 'adjustment' | 'transfer' | 'stock_transfer';
    document?: mongoose.Types.ObjectId | any;
  };
  department?: mongoose.Types.ObjectId | any;
  reason?: string;
  performedBy: mongoose.Types.ObjectId | any;
  notes?: string;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const StoreTransactionSchema = new Schema<IStoreTransaction>({
  transactionNumber: {
    type: String,
    unique: true,
    required: true
  },
  type: {
    type: String,
    enum: ['receipt', 'issue', 'adjustment', 'transfer', 'return'],
    required: true
  },
  item: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Item',
    required: true
  },
  site: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Site',
    required: true
  },
  inventory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  previousQuantity: {
    type: Number,
    required: true
  },
  newQuantity: {
    type: Number,
    required: true
  },
  unitCost: Number,
  totalValue: Number,
  reference: {
    type: {
      type: String,
      enum: ['grv', 'store_requisition', 'purchase_requisition', 'adjustment', 'transfer', 'stock_transfer']
    },
    document: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: 'reference.type'
    }
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  reason: String,
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  notes: String,
  isDeleted: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

/** The ledger's established codes, e.g. ST-TRF for a transfer rather than ST-TRA. */
const TYPE_CODES: Record<string, string> = {
  receipt: 'REC',
  issue: 'ISS',
  adjustment: 'ADJ',
  transfer: 'TRF',
  return: 'RET'
};

// Generate transaction number before validation (required field must be set
// pre-validate). One atomic sequence for every type; controllers used to number
// these themselves from a count, which gave two movements at once the same
// number and failed the second on the unique index.
StoreTransactionSchema.pre('validate', async function() {
  if (this.isNew && !this.transactionNumber) {
    const year = new Date().getFullYear();
    const typePrefix = TYPE_CODES[this.type] || this.type.substring(0, 3).toUpperCase();
    const seq = await nextSequence(this, 'storeTransaction', year, { field: 'transactionNumber', pattern: 'ST-[A-Z]{3}' });
    this.transactionNumber = `${sbuNumberPrefix()}ST-${typePrefix}-${year}-${String(seq).padStart(6, '0')}`;
  }
});

export default mongoose.model<IStoreTransaction>('StoreTransaction', StoreTransactionSchema);
