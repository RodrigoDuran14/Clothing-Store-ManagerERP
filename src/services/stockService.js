const Product = require('../models/Product');
const AppError = require('../utils/AppError');

/* =========================================================
 *  Verificación previa (read-only)
 * ========================================================= */
const checkStockForSale = async (items) => {
  const issues = [];
  const checked = [];

  for (const item of items) {
    const product = await Product.findById(item.productId);
    if (!product) {
      issues.push({
        item,
        reason: 'product-not-found',
        message: `Producto no encontrado: ${item.productId}`,
      });
      continue;
    }
    if (!product.isActive) {
      issues.push({
        item,
        reason: 'product-inactive',
        message: `Producto inactivo: ${product.name}`,
      });
      continue;
    }

    const variant = product.variants.find(
      (v) =>
        v.size === String(item.size).toUpperCase() && v.color === item.color
    );
    if (!variant) {
      issues.push({
        item,
        reason: 'variant-not-found',
        message: `Variante no encontrada en "${product.name}" (talle: ${item.size}, color: ${item.color})`,
      });
      continue;
    }
    if (variant.stock < item.quantity) {
      issues.push({
        item,
        reason: 'insufficient-stock',
        available: variant.stock,
        requested: item.quantity,
        message: `Stock insuficiente en "${product.name}" ${item.size}/${item.color}: disponible ${variant.stock}, solicitado ${item.quantity}`,
      });
      continue;
    }

    checked.push({ product, variant, item });
  }

  return { ok: issues.length === 0, issues, checked };
};

/* =========================================================
 *  Deducción atómica con rollback
 * ========================================================= */
const deductStockForSale = async (items) => {
  const deducted = [];
  try {
    for (const item of items) {
      const size = String(item.size).toUpperCase();
      const color = item.color;
      const qty = Number(item.quantity);

      const result = await Product.findOneAndUpdate(
        {
          _id: item.productId,
          isActive: true,
          variants: {
            $elemMatch: { size, color, stock: { $gte: qty } },
          },
        },
        { $inc: { 'variants.$.stock': -qty } },
        { new: true }
      );

      if (!result) {
        throw new AppError(
          `Stock insuficiente o variante no encontrada (producto ${item.productId}, talle ${item.size}, color ${item.color})`,
          400
        );
      }

      deducted.push({
        productId: item.productId,
        productName: item.productName,
        size,
        color,
        quantity: qty,
      });
    }
    return deducted;
  } catch (err) {
    for (const d of deducted) {
      try {
        await Product.updateOne(
          {
            _id: d.productId,
            variants: { $elemMatch: { size: d.size, color: d.color } },
          },
          { $inc: { 'variants.$.stock': d.quantity } }
        );
      } catch (rbErr) {
        console.error(
          `⚠️  Rollback falló para ${d.productName} ${d.size}/${d.color}:`,
          rbErr.message
        );
      }
    }
    throw err;
  }
};

/* =========================================================
 *  Restauración (para cancelaciones o devoluciones)
 * ========================================================= */
const restoreStockForCancellation = async (items) => {
  const restored = [];
  for (const item of items) {
    try {
      await Product.updateOne(
        {
          _id: item.productId,
          variants: {
            $elemMatch: {
              size: String(item.size).toUpperCase(),
              color: item.color,
            },
          },
        },
        { $inc: { 'variants.$.stock': Number(item.quantity) } }
      );
      restored.push(item);
    } catch (err) {
      console.error(
        `⚠️  No se pudo restaurar stock de ${item.productId}:`,
        err.message
      );
    }
  }
  return restored;
};

/* =========================================================
 *  Resumen para mostrar al frontend
 * ========================================================= */
const getStockSummary = async (productIds) => {
  if (!productIds || productIds.length === 0) return [];
  return Product.find({ _id: { $in: productIds }, isActive: true })
    .select('name variants totalStock isActive')
    .lean();
};

module.exports = {
  checkStockForSale,
  deductStockForSale,
  restoreStockForCancellation,
  restoreStock: restoreStockForCancellation,
  getStockSummary,
};