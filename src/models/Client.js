const mongoose = require("mongoose");
const AppError = require("../utils/AppError");

const GENDERS = ["M", "F", "X", "unspecified"];
const CLIENT_CATEGORIES = ["new", "occasional", "frequent", "vip", "inactive"];
const MOVEMENT_TYPES = ["purchase", "payment", "return", "adjustment"];
const PURCHASE_STATUSES = ["completed", "cancelled", "returned", "pending"];

/* =========================================================
 *  Subdocumentos
 * ========================================================= */
const creditMovementSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: MOVEMENT_TYPES,
      required: true,
    },
    amount: { type: Number, required: true },
    description: { type: String, trim: true, maxlength: 300 },
    balanceBefore: { type: Number, required: true, min: 0 },
    balanceAfter: { type: Number, required: true, min: 0 },
    saleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    date: { type: Date, default: Date.now },
  },
  { _id: true },
);

const purchaseEntrySchema = new mongoose.Schema(
  {
    saleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Sale",
      required: true,
    },
    date: { type: Date, default: Date.now },
    total: { type: Number, required: true, min: 0 },
    products: [
      {
        productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
        name: String,
        quantity: Number,
        price: Number,
        size: String,
        color: String,
        _id: false,
      },
    ],
    status: {
      type: String,
      enum: PURCHASE_STATUSES,
      default: "completed",
    },
  },
  { _id: true },
);

const addressSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, maxlength: 50, default: "Casa" },
    street: {
      type: String,
      required: [true, "La calle es obligatoria"],
      trim: true,
      maxlength: 200,
    },
    city: {
      type: String,
      required: [true, "La ciudad es obligatoria"],
      trim: true,
      maxlength: 100,
    },
    state: { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country: { type: String, trim: true, maxlength: 100, default: "Argentina" },
    isMain: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 300 },
  },
  { _id: true },
);

const preferencesSchema = new mongoose.Schema(
  {
    sizes: {
      top: { type: String, trim: true, maxlength: 10 },
      bottom: { type: String, trim: true, maxlength: 10 },
      shoe: { type: String, trim: true, maxlength: 10 },
    },
    favoriteColors: [{ type: String, trim: true, lowercase: true }],
    preferredCategories: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Category" },
    ],
    favoriteBrands: [{ type: String, trim: true, lowercase: true }],
    shoeSize: { type: String, trim: true, maxlength: 10 },
    pantsSize: { type: String, trim: true, maxlength: 10 },
    observations: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

/* =========================================================
 *  Schema principal
 * ========================================================= */
const clientSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "El nombre es obligatorio"],
      trim: true,
      maxlength: [100, "El nombre no puede superar los 100 caracteres"],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, "Email inválido"],
      default: null,
    },
    phone: {
      type: String,
      required: [true, "El teléfono es obligatorio"],
      trim: true,
      maxlength: 30,
    },
    phone2: { type: String, trim: true, maxlength: 30, default: null },
    birthDate: { type: Date, default: null },
    gender: {
      type: String,
      enum: { values: GENDERS, message: "Género inválido" },
      default: "unspecified",
    },
    taxId: { type: String, trim: true, maxlength: 30, default: null },
    notes: { type: String, trim: true, maxlength: 2000, default: null },
    category: {
      type: String,
      enum: { values: CLIENT_CATEGORIES, message: "Categoría inválida" },
      default: "new",
    },
    isActive: { type: Boolean, default: true },

    creditAccount: {
      isEnabled: { type: Boolean, default: false },
      creditLimit: { type: Number, min: 0, default: 0 },
      balance: { type: Number, min: 0, default: 0 },
      movements: { type: [creditMovementSchema], default: [] },
      activationDate: { type: Date, default: null },
      lastMovementDate: { type: Date, default: null },
    },

    purchaseHistory: { type: [purchaseEntrySchema], default: [] },
    preferences: { type: preferencesSchema, default: () => ({}) },
    addresses: { type: [addressSchema], default: [] },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* =========================================================
 *  Índices
 * ========================================================= */
clientSchema.index({ email: 1 }, { unique: true, sparse: true });
clientSchema.index({ taxId: 1 }, { unique: true, sparse: true });
clientSchema.index({ name: 1 });
clientSchema.index({ phone: 1 });
clientSchema.index({ isActive: 1, category: 1 });
clientSchema.index({
  "creditAccount.isEnabled": 1,
  "creditAccount.balance": 1,
});

/* =========================================================
 *  Virtuals
 * ========================================================= */
clientSchema.virtual("age").get(function () {
  if (!this.birthDate) return null;
  const diff = Date.now() - this.birthDate.getTime();
  const age = Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
  return age >= 0 ? age : null;
});

clientSchema.virtual("mainAddress").get(function () {
  if (!this.addresses || this.addresses.length === 0) return null;
  return this.addresses.find((a) => a.isMain) || this.addresses[0];
});

clientSchema.virtual("availableCredit").get(function () {
  const ca = this.creditAccount;
  if (!ca || !ca.isEnabled) return 0;
  return Math.max(0, (ca.creditLimit || 0) - (ca.balance || 0));
});

clientSchema.virtual("creditUsagePercentage").get(function () {
  const ca = this.creditAccount;
  if (!ca || !ca.isEnabled || ca.creditLimit <= 0) return 0;
  return Number((((ca.balance || 0) / ca.creditLimit) * 100).toFixed(2));
});

/* =========================================================
 *  pre('save'): garantizar exactamente una dirección principal
 * ========================================================= */
clientSchema.pre("save", function (next) {
  if (this.addresses && this.addresses.length > 0) {
    const mainCount = this.addresses.filter((a) => a.isMain).length;
    if (mainCount === 0) {
      this.addresses[0].isMain = true;
    } else if (mainCount > 1) {
      let kept = false;
      this.addresses.forEach((a) => {
        if (a.isMain && !kept) kept = true;
        else if (a.isMain) a.isMain = false;
      });
    }
  }
  next();
});

/* =========================================================
 *  Métodos
 * ========================================================= */

/**
 * Registra un movimiento en la cuenta corriente.
 * No persiste: el caller debe llamar `save()` (o usar el servicio).
 *
 * Tipos:
 *  - 'purchase'   → aumenta deuda (amount > 0)
 *  - 'payment'    → reduce deuda (amount > 0, no puede superar balance)
 *  - 'return'     → reduce deuda (amount > 0, no puede superar balance)
 *  - 'adjustment' → ajuste manual (amount != 0, resultado no puede ser negativo)
 */
clientSchema.methods.addCreditMovement = function (
  type,
  amount,
  description,
  options = {},
) {
  if (!MOVEMENT_TYPES.includes(type)) {
    throw new AppError(
      `Tipo de movimiento inválido: '${type}'. Use: ${MOVEMENT_TYPES.join(", ")}`,
      400,
    );
  }

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw new AppError(
      "El monto del movimiento debe ser distinto de cero",
      400,
    );
  }

  if (!this.creditAccount.isEnabled && type !== "adjustment") {
    throw new AppError(
      "La cuenta corriente del cliente no está habilitada",
      400,
    );
  }

  const balanceBefore = this.creditAccount.balance || 0;
  let balanceAfter = balanceBefore;

  switch (type) {
    case "purchase": {
      if (amt <= 0)
        throw new AppError("El monto de la compra debe ser positivo", 400);
      balanceAfter = balanceBefore + amt;
      break;
    }
    case "payment":
    case "return": {
      if (amt <= 0) {
        throw new AppError(
          `El monto del movimiento '${type}' debe ser positivo`,
          400,
        );
      }
      if (amt > balanceBefore) {
        throw new AppError(
          `El monto (${amt}) supera el saldo deudor actual (${balanceBefore})`,
          400,
        );
      }
      balanceAfter = balanceBefore - amt;
      break;
    }
    case "adjustment": {
      balanceAfter = balanceBefore + amt;
      if (balanceAfter < 0) {
        throw new AppError(
          `El ajuste dejaría el saldo en negativo (saldo actual: ${balanceBefore})`,
          400,
        );
      }
      break;
    }
  }

  this.creditAccount.movements.push({
    type,
    amount: amt,
    description: description || `Movimiento: ${type}`,
    balanceBefore,
    balanceAfter,
    saleId: options.saleId || null,
    createdBy: options.createdBy || null,
  });

  this.creditAccount.balance = balanceAfter;
  this.creditAccount.lastMovementDate = new Date();

  return this;
};

/**
 * Agrega una compra al historial. No persiste.
 */
clientSchema.methods.addPurchaseToHistory = function (
  saleId,
  total,
  products = [],
  status = "completed",
) {
  if (!saleId) throw new AppError("Se requiere el ID de la venta", 400);
  const totalNum = Number(total);
  if (!Number.isFinite(totalNum) || totalNum <= 0) {
    throw new AppError("El total de la compra debe ser positivo", 400);
  }
  if (!PURCHASE_STATUSES.includes(status)) {
    throw new AppError(`Estado de compra inválido: '${status}'`, 400);
  }

  this.purchaseHistory.push({
    saleId,
    date: new Date(),
    total: totalNum,
    products,
    status,
  });

  return this;
};

/**
 * Consulta si el cliente puede comprar a crédito por `amount`.
 * No modifica nada. Devuelve info completa para el caller.
 */
clientSchema.methods.checkCreditLimit = function (amount) {
  const ca = this.creditAccount;
  const amt = Number(amount);

  if (!ca.isEnabled) {
    return {
      canPurchase: false,
      reason: "credit-disabled",
      message: "La cuenta corriente del cliente no está habilitada",
      balance: ca.balance,
      creditLimit: ca.creditLimit,
      availableCredit: 0,
      requested: amt,
      exceedsBy: amt,
    };
  }

  const availableCredit = Math.max(
    0,
    (ca.creditLimit || 0) - (ca.balance || 0),
  );
  const exceedsBy = Math.max(0, amt - availableCredit);
  const canPurchase = amt <= availableCredit;

  return {
    canPurchase,
    reason: canPurchase ? "ok" : "insufficient-credit",
    message: canPurchase
      ? "Crédito disponible"
      : `Crédito insuficiente. Disponible: ${availableCredit}, solicitado: ${amt}`,
    balance: ca.balance,
    creditLimit: ca.creditLimit,
    availableCredit,
    requested: amt,
    exceedsBy,
  };
};

/* =========================================================
 *  Statics
 * ========================================================= */

/**
 * Recalcula la categoría del cliente según su historial.
 * - new: sin compras
 * - inactive: última compra > 6 meses
 * - vip: >=15 compras en el último año o >$500k acumulado
 * - frequent: >=5 compras en el último año
 * - occasional: >=1 compra en el último año
 *
 * Persiste el cambio. Devuelve la categoría.
 */
clientSchema.statics.updateClientCategory = async function (clientId) {
  const client = await this.findById(clientId);
  if (!client) return null;

  const now = Date.now();
  const sixMonthsAgo = now - 6 * 30 * 24 * 60 * 60 * 1000;
  const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;

  const completed = client.purchaseHistory.filter(
    (p) => p.status === "completed",
  );
  const recent = completed.filter(
    (p) => new Date(p.date).getTime() >= oneYearAgo,
  );
  const lastDate =
    completed.length > 0
      ? Math.max(...completed.map((p) => new Date(p.date).getTime()))
      : null;
  const totalSpent = completed.reduce((sum, p) => sum + p.total, 0);

  let category = "new";
  if (completed.length === 0) category = "new";
  else if (lastDate && lastDate < sixMonthsAgo) category = "inactive";
  else if (recent.length >= 15 || totalSpent >= 500000) category = "vip";
  else if (recent.length >= 5) category = "frequent";
  else if (recent.length >= 1) category = "occasional";

  if (client.category !== category) {
    client.category = category;
    await client.save({ validateBeforeSave: false });
  }
  return client.category;
};

/**
 * Clientes con uso de crédito >= threshold% del límite.
 * @param {number} threshold - porcentaje (default 80)
 */
clientSchema.statics.getClientsWithCreditRisk = function (threshold = 80) {
  const t = Math.max(0, Math.min(100, Number(threshold)));
  return this.aggregate([
    { $match: { isActive: true, "creditAccount.isEnabled": true } },
    {
      $addFields: {
        usagePercentage: {
          $cond: [
            { $gt: ["$creditAccount.creditLimit", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    "$creditAccount.balance",
                    "$creditAccount.creditLimit",
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
      },
    },
    { $match: { usagePercentage: { $gte: t } } },
    { $sort: { usagePercentage: -1 } },
    {
      $project: {
        _id: 1,
        name: 1,
        email: 1,
        phone: 1,
        category: 1,
        "creditAccount.balance": 1,
        "creditAccount.creditLimit": 1,
        "creditAccount.lastMovementDate": 1,
        usagePercentage: { $round: ["$usagePercentage", 2] },
        exceedsLimit: {
          $gte: ["$creditAccount.balance", "$creditAccount.creditLimit"],
        },
      },
    },
  ]);
};

module.exports = mongoose.model("Client", clientSchema);
module.exports.GENDERS = GENDERS;
module.exports.CLIENT_CATEGORIES = CLIENT_CATEGORIES;
module.exports.MOVEMENT_TYPES = MOVEMENT_TYPES;
module.exports.PURCHASE_STATUSES = PURCHASE_STATUSES;