const Client = require('../models/Client');
const AppError = require('../utils/AppError');

/* =========================================================
 *  Consultas previas a venta
 * ========================================================= */

/**
 * Verifica si un cliente puede comprar a crédito por `amount`.
 * Retorna la info lista para mostrar en el POS.
 */
const checkCreditBeforeSale = async (clientId, amount) => {
  const client = await Client.findById(clientId).select(
    'name creditAccount'
  );
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const result = client.checkCreditLimit(amount);
  return {
    clientId: client._id,
    clientName: client.name,
    ...result,
  };
};

/* =========================================================
 *  Alertas (placeholder para integración futura)
 * ========================================================= */

/**
 * Emite una alerta de crédito. Por ahora loggea estructurado y devuelve
 * el payload; listo para enchufar email/SMS/WebSocket sin tocar callers.
 *
 * @param {ObjectId} clientId
 * @param {'near-limit'|'over-limit'|'payment-due'|'payment-received'} type
 * @param {object} data
 */
const sendCreditAlert = async (clientId, type, data = {}) => {
  const client = await Client.findById(clientId).select(
    'name email phone creditAccount'
  );
  if (!client) return { sent: false, reason: 'client-not-found' };

  const payload = {
    clientId: client._id,
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
    type,
    balance: client.creditAccount.balance,
    creditLimit: client.creditAccount.creditLimit,
    availableCredit: Math.max(
      0,
      client.creditAccount.creditLimit - client.creditAccount.balance
    ),
    ...data,
    createdAt: new Date(),
  };

  // TODO: reemplazar por integración real (nodemailer, Twilio, queue, etc.)
  console.log(`[CREDIT ALERT][${type}]`, payload);

  return { sent: true, payload };
};

/* =========================================================
 *  Monitoreo masivo
 * ========================================================= */

/**
 * Barre todos los clientes activos con crédito habilitado y devuelve
 * los que estén en riesgo (>= 80% del límite). Pensado para cron diario.
 */
const checkAllCreditLimits = async (threshold = 80) => {
  const atRisk = await Client.getClientsWithCreditRisk(threshold);

  // Disparar alertas (por ahora solo log)
  for (const c of atRisk) {
    const type = c.exceedsLimit ? 'over-limit' : 'near-limit';
    await sendCreditAlert(c._id, type, {
      usagePercentage: c.usagePercentage,
    });
  }

  return {
    threshold,
    total: atRisk.length,
    clients: atRisk,
  };
};

/* =========================================================
 *  Operaciones
 * ========================================================= */

/**
 * Registra un pago en la cuenta corriente.
 * Devuelve el cliente ya persistido.
 */
const registerPayment = async (clientId, amount, options = {}) => {
  const client = await Client.findById(clientId);
  if (!client) throw new AppError('Cliente no encontrado', 404);

  if (!client.isActive) {
    throw new AppError(
      'No se puede registrar un pago a un cliente desactivado',
      400
    );
  }

  const description =
    options.description ||
    `Pago registrado${options.method ? ` (${options.method})` : ''}`;

  client.addCreditMovement('payment', amount, description, {
    createdBy: options.createdBy || null,
    saleId: options.saleId || null,
  });

  await client.save();

  // Alerta opcional tras el pago (reduce deuda → buen momento para notificar)
  if (client.creditAccount.balance === 0) {
    await sendCreditAlert(client._id, 'payment-received', {
      amount: Number(amount),
    });
  }

  return client;
};

/**
 * Resumen completo de la cuenta corriente para mostrar al staff.
 */
const getCreditSummary = async (clientId) => {
  const client = await Client.findById(clientId).select(
    'name email phone creditAccount'
  );
  if (!client) throw new AppError('Cliente no encontrado', 404);

  const ca = client.creditAccount;
  const availableCredit = Math.max(0, (ca.creditLimit || 0) - (ca.balance || 0));
  const usage =
    ca.creditLimit > 0 ? (ca.balance / ca.creditLimit) * 100 : 0;

  const recentMovements = [...(ca.movements || [])]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 20);

  return {
    clientId: client._id,
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phone,
    isEnabled: ca.isEnabled,
    creditLimit: ca.creditLimit,
    balance: ca.balance,
    availableCredit,
    usagePercentage: Number(usage.toFixed(2)),
    activationDate: ca.activationDate,
    lastMovementDate: ca.lastMovementDate,
    movementsCount: (ca.movements || []).length,
    recentMovements,
  };
};

module.exports = {
  checkCreditBeforeSale,
  sendCreditAlert,
  checkAllCreditLimits,
  registerPayment,
  getCreditSummary,
};