const mongoose = require('mongoose');

/* 'adjusted' para splits reducidos por una devolución parcial */
const SPLIT_STATUSES = ['pending', 'settled', 'cancelled', 'adjusted'];

const splitItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

/* trazabilidad de ajustes por devolución */
const adjustmentSchema = new mongoose.Schema(
  {
    returnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Return' },
    returnNumber: { type: String },
    amount: { type: Number, required: true }, // negativo si reduce, positivo si re-agrega
    reason: { type: String, trim: true, maxlength: 200 },
    date: { type: Date, default: Date.now },
  },
  { _id: false }
);

const partnerSplitSchema = new mongoose.Schema(
  {
    saleId: { type: mongoose.Schema.Types.ObjectId, ref: 'Sale', required: true },
    saleNumber: { type: String, required: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Partner', required: true },
    items: { type: [splitItemSchema], default: [] },
    itemsSubtotal: { type: Number, required: true, min: 0 },
    grossAmount: { type: Number, required: true, min: 0 },

    partnerPercentage: { type: Number, required: true, min: 0, max: 100, default: 100 },
    storePercentage: { type: Number, required: true, min: 0, max: 100, default: 0 },
    partnerAmount: { type: Number, required: true, min: 0 },
    storeAmount: { type: Number, required: true, min: 0 },

    status: { type: String, enum: SPLIT_STATUSES, default: 'pending' },
    settledAt: { type: Date, default: null },
    settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },

    /* historial de ajustes por devolución */
    adjustments: { type: [adjustmentSchema], default: [] },
  },
  { timestamps: true }
);

partnerSplitSchema.index({ saleId: 1 });
partnerSplitSchema.index({ partnerId: 1, status: 1 });
partnerSplitSchema.index({ partnerId: 1, createdAt: -1 });
partnerSplitSchema.index({ saleId: 1, partnerId: 1 }, { unique: true });

module.exports = mongoose.model('PartnerSplit', partnerSplitSchema);
module.exports.SPLIT_STATUSES = SPLIT_STATUSES;