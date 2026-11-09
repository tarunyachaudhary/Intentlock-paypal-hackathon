import mongoose from 'mongoose';
const { Schema, model } = mongoose;

export const User = model('User', new Schema({
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
}, { timestamps: true }));

export const Policy = model('Policy', new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  instruction: String,
  category: String,
  maxBudget: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  allowedMerchants: [String],
  requireApproval: { type: Boolean, default: true },
  parsedBy: String,
  active: { type: Boolean, default: true },
}, { timestamps: true }));

export const STATUSES = ['BLOCKED', 'PENDING_APPROVAL', 'APPROVED', 'ORDER_CREATING', 'ORDER_CREATED', 'CAPTURING', 'CAPTURED', 'EXPIRED', 'FAILED'];

export const Purchase = model('Purchase', new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  policyId: Schema.Types.ObjectId,
  policySnapshot: Schema.Types.Mixed,   // frozen copy: later policy edits cannot change an evaluated purchase
  productSnapshot: Schema.Types.Mixed,  // frozen copy: price/merchant at evaluation time
  amount: { type: Number, required: true }, // server-side price, never taken from the client
  currency: { type: String, default: 'USD' },
  policyDecision: String,
  checks: Schema.Types.Mixed,
  risk: Schema.Types.Mixed,
  explanation: String,
  mandate: { payload: Schema.Types.Mixed, signature: String },
  status: { type: String, enum: STATUSES, required: true, index: true },
  blockReason: String,
  paypalOrderId: String,
  paypalCaptureId: String,
  approvedAt: Date,
  capturedAt: Date,
}, { timestamps: true }));

export const AuditLog = model('AuditLog', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true, required: true },
  purchaseId: Schema.Types.ObjectId,
  action: { type: String, required: true },
  decision: String,
  reason: String,
  prevHash: String,
  hash: String,
  createdAt: { type: Date, required: true },
}, { versionKey: false }));
