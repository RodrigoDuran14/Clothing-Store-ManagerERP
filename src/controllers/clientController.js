const Client = require('../models/Client');
const AppError = require('../utils/AppError');
const { paginate, formatPagination } = require('../utils/helpers');
const creditService = require('../services/creditService');

/* =========================================================
 *  Helpers
 * ========================================================= */
const buildClientFilter = (query) => {
  const filter = {};

  if (query.isActive !== undefined) filter.isActive = query.isActive === 'true';
  if (query.category) filter.category = query.category;
  if (query.gender) filter.gender = query.gender;
  if (query.hasCredit === 'true') filter['creditAccount.isEnabled'] = true;
  if (query.hasDebt === 'true') filter['creditAccount.balance'] = { $gt: 0 };

  if (query.search) {
    filter.$or = [
      { name: { $regex: query.search, $options: 'i' } },
      { email: { $regex: query.search, $options: 'i' } },
      { phone: { $regex: query.search, $options: 'i' } },
      { taxId: { $regex: query.search, $options: 'i' } },
    ];
  }

  return filter;
};

const buildClientSort = (sortBy) => {
  const map = {
    name: { name: 1 },
    '-name': { name: -1 },
    recent: { createdAt: -1 },
    balance: { 'creditAccount.balance': -1 },
    '-balance': { 'creditAccount.balance': 1 },
    category: { category: 1, name: 1 },
  };
  return map[sortBy] || { createdAt: -1 };
};

/* =========================================================
 *  GET /api/clients
 * ========================================================= */
exports.getClients = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );
    const filter = buildClientFilter(req.query);
    const sort = buildClientSort(req.query.sort);

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean({ virtuals: true }),
      Client.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: {
        clients,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Clientes obtenidos correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  GET /api/clients/:id
 * ========================================================= */
exports.getClientById = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id)
      .populate('preferences.preferredCategories', 'name slug');
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    res.status(200).json({
      success: true,
      data: client,
      message: 'Cliente obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  POST /api/clients
 * ========================================================= */
exports.createClient = async (req, res, next) => {
  try {
    const {
      name,
      email,
      phone,
      phone2,
      birthDate,
      gender,
      taxId,
      notes,
      category,
      preferences,
      addresses,
    } = req.body;

    if (email) {
      const exists = await Client.findOne({ email: email.toLowerCase() });
      if (exists) {
        return next(new AppError('Ya existe un cliente con ese email', 400));
      }
    }
    if (taxId) {
      const exists = await Client.findOne({ taxId });
      if (exists) {
        return next(
          new AppError('Ya existe un cliente con ese DNI/CUIT', 400)
        );
      }
    }

    const client = await Client.create({
      name,
      email: email || null,
      phone,
      phone2: phone2 || null,
      birthDate: birthDate || null,
      gender: gender || 'unspecified',
      taxId: taxId || null,
      notes: notes || null,
      category: category || 'new',
      preferences: preferences || {},
      addresses: addresses || [],
    });

    res.status(201).json({
      success: true,
      data: client,
      message: 'Cliente creado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/clients/:id  (perfil only)
 * ========================================================= */
exports.updateClient = async (req, res, next) => {
  try {
    // Defensa adicional (el validator ya lo bloquea)
    const forbidden = [
      'creditAccount',
      'purchaseHistory',
      'addresses',
      'preferences',
      'category',
      'isActive',
    ];
    const attempted = forbidden.filter((f) => req.body[f] !== undefined);
    if (attempted.length > 0) {
      return next(
        new AppError(
          `Los campos '${attempted.join("', '")}' no se pueden modificar por esta ruta`,
          400
        )
      );
    }

    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    // Unicidad de email / taxId si cambian
    if (req.body.email !== undefined && req.body.email !== client.email) {
      const exists = await Client.findOne({
        _id: { $ne: client._id },
        email: req.body.email.toLowerCase(),
      });
      if (exists) {
        return next(new AppError('Ya existe un cliente con ese email', 400));
      }
      client.email = req.body.email;
    }
    if (req.body.taxId !== undefined && req.body.taxId !== client.taxId) {
      const exists = await Client.findOne({
        _id: { $ne: client._id },
        taxId: req.body.taxId,
      });
      if (exists) {
        return next(
          new AppError('Ya existe un cliente con ese DNI/CUIT', 400)
        );
      }
      client.taxId = req.body.taxId;
    }

    const allowed = ['name', 'phone', 'phone2', 'birthDate', 'gender', 'notes'];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) client[field] = req.body[field];
    });

    await client.save();

    res.status(200).json({
      success: true,
      data: client,
      message: 'Cliente actualizado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DELETE /api/clients/:id  (soft delete)
 * ========================================================= */
exports.deleteClient = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    if (!client.isActive) {
      return next(new AppError('El cliente ya está desactivado', 400));
    }

    if (client.creditAccount.balance > 0) {
      return next(
        new AppError(
          `No se puede desactivar un cliente con saldo deudor pendiente ($${client.creditAccount.balance})`,
          400
        )
      );
    }

    client.isActive = false;
    await client.save();

    res.status(200).json({
      success: true,
      data: client,
      message: 'Cliente desactivado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PATCH /api/clients/:id/status
 * ========================================================= */
exports.toggleClientStatus = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    const newStatus =
      req.body.isActive !== undefined ? !!req.body.isActive : !client.isActive;

    if (newStatus === client.isActive) {
      return res.status(200).json({
        success: true,
        data: client,
        message: `El cliente ya estaba ${client.isActive ? 'activo' : 'inactivo'}`,
      });
    }

    if (!newStatus && client.creditAccount.balance > 0) {
      return next(
        new AppError(
          `No se puede desactivar un cliente con saldo deudor pendiente ($${client.creditAccount.balance})`,
          400
        )
      );
    }

    client.isActive = newStatus;
    await client.save();

    res.status(200).json({
      success: true,
      data: client,
      message: `Cliente ${newStatus ? 'activado' : 'desactivado'} correctamente`,
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  CRÉDITO — enable / disable
 * ========================================================= */
exports.enableCredit = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    if (!client.isActive) {
      return next(
        new AppError('No se puede habilitar crédito a un cliente desactivado', 400)
      );
    }

    const { creditLimit } = req.body;
    const wasEnabled = client.creditAccount.isEnabled;

    client.creditAccount.isEnabled = true;
    client.creditAccount.creditLimit = Number(creditLimit);
    if (!client.creditAccount.activationDate) {
      client.creditAccount.activationDate = new Date();
    }

    await client.save();

    res.status(200).json({
      success: true,
      data: client.creditAccount,
      message: wasEnabled
        ? 'Límite de crédito actualizado correctamente'
        : 'Cuenta corriente habilitada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.disableCredit = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    if (!client.creditAccount.isEnabled) {
      return next(
        new AppError('La cuenta corriente ya está deshabilitada', 400)
      );
    }

    if (client.creditAccount.balance > 0) {
      return next(
        new AppError(
          `No se puede deshabilitar la cuenta corriente con saldo deudor pendiente ($${client.creditAccount.balance})`,
          400
        )
      );
    }

    client.creditAccount.isEnabled = false;
    await client.save();

    res.status(200).json({
      success: true,
      data: client.creditAccount,
      message: 'Cuenta corriente deshabilitada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  CRÉDITO — payment / summary / check
 * ========================================================= */
exports.registerCreditPayment = async (req, res, next) => {
  try {
    const { amount, method, description } = req.body;
    const client = await creditService.registerPayment(
      req.params.id,
      Number(amount),
      {
        method,
        description,
        createdBy: req.user._id,
      }
    );

    res.status(200).json({
      success: true,
      data: {
        clientId: client._id,
        clientName: client.name,
        balance: client.creditAccount.balance,
        availableCredit: Math.max(
          0,
          client.creditAccount.creditLimit - client.creditAccount.balance
        ),
        lastMovementDate: client.creditAccount.lastMovementDate,
      },
      message: 'Pago registrado correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.getCreditSummary = async (req, res, next) => {
  try {
    const summary = await creditService.getCreditSummary(req.params.id);
    res.status(200).json({
      success: true,
      data: summary,
      message: 'Resumen de cuenta corriente obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.checkCreditLimit = async (req, res, next) => {
  try {
    const { amount } = req.query;
    const result = await creditService.checkCreditBeforeSale(
      req.params.id,
      Number(amount)
    );
    res.status(200).json({
      success: true,
      data: result,
      message: result.canPurchase
        ? 'Crédito disponible para la venta'
        : result.message,
    });
  } catch (error) {
    next(error);
  }
};

exports.getCreditRiskClients = async (req, res, next) => {
  try {
    const threshold = Number(req.query.threshold) || 80;
    const clients = await Client.getClientsWithCreditRisk(threshold);

    res.status(200).json({
      success: true,
      data: { clients, threshold, total: clients.length },
      message:
        clients.length > 0
          ? 'Clientes en riesgo de crédito obtenidos correctamente'
          : 'No hay clientes en riesgo de crédito',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  HISTORIAL DE COMPRAS
 * ========================================================= */
exports.getPurchaseHistory = async (req, res, next) => {
  try {
    const { skip, limit: limitNum, page: pageNum } = paginate(
      req.query.page,
      req.query.limit
    );

    const client = await Client.findById(req.params.id).select(
      'name purchaseHistory'
    );
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    const sorted = [...client.purchaseHistory].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
    const items = sorted.slice(skip, skip + limitNum);
    const total = sorted.length;

    res.status(200).json({
      success: true,
      data: {
        clientId: client._id,
        clientName: client.name,
        purchases: items,
        pagination: formatPagination(total, pageNum, limitNum),
      },
      message: 'Historial de compras obtenido correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  STATS (admin)
 * ========================================================= */
exports.getClientStats = async (req, res, next) => {
  try {
    const [countsAgg, byCategory, recentAgg] = await Promise.all([
      Client.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: ['$isActive', 1, 0] } },
            inactive: { $sum: { $cond: ['$isActive', 0, 1] } },
            withCreditEnabled: {
              $sum: { $cond: ['$creditAccount.isEnabled', 1, 0] },
            },
            withDebt: {
              $sum: { $cond: [{ $gt: ['$creditAccount.balance', 0] }, 1, 0] },
            },
            totalReceivables: { $sum: '$creditAccount.balance' },
          },
        },
      ]),
      Client.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Client.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      }),
    ]);

    const counts = countsAgg[0] || {
      total: 0,
      active: 0,
      inactive: 0,
      withCreditEnabled: 0,
      withDebt: 0,
      totalReceivables: 0,
    };

    res.status(200).json({
      success: true,
      data: {
        ...counts,
        newLast30Days: recentAgg,
        byCategory: byCategory.reduce((acc, r) => {
          acc[r._id] = r.count;
          return acc;
        }, {}),
      },
      message: 'Estadísticas de clientes obtenidas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  PREFERENCIAS
 * ========================================================= */
exports.updatePreferences = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    // Merge profundo: preserva campos no enviados
    const current = client.preferences ? client.preferences.toObject() : {};
    const incoming = req.body || {};

    client.preferences = {
      ...current,
      ...incoming,
      sizes: { ...(current.sizes || {}), ...(incoming.sizes || {}) },
    };

    await client.save();

    res.status(200).json({
      success: true,
      data: client.preferences,
      message: 'Preferencias actualizadas correctamente',
    });
  } catch (error) {
    next(error);
  }
};

/* =========================================================
 *  DIRECCIONES
 * ========================================================= */
exports.addAddress = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    const {
      label,
      street,
      city,
      state,
      postalCode,
      country,
      isMain,
      notes,
    } = req.body;

    const shouldBeMain = isMain === true || client.addresses.length === 0;
    if (shouldBeMain) {
      client.addresses.forEach((a) => (a.isMain = false));
    }

    client.addresses.push({
      label: label || 'Casa',
      street,
      city,
      state: state || null,
      postalCode: postalCode || null,
      country: country || 'Argentina',
      isMain: shouldBeMain,
      notes: notes || null,
    });

    await client.save();

    res.status(201).json({
      success: true,
      data: client.addresses,
      message: 'Dirección agregada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.updateAddress = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    const address = client.addresses.id(req.params.addressId);
    if (!address) return next(new AppError('Dirección no encontrada', 404));

    if (req.body.isMain === true) {
      client.addresses.forEach((a) => {
        if (!a._id.equals(address._id)) a.isMain = false;
      });
    }

    const allowed = [
      'label',
      'street',
      'city',
      'state',
      'postalCode',
      'country',
      'notes',
      'isMain',
    ];
    allowed.forEach((field) => {
      if (req.body[field] !== undefined) address[field] = req.body[field];
    });

    await client.save();

    res.status(200).json({
      success: true,
      data: client.addresses,
      message: 'Dirección actualizada correctamente',
    });
  } catch (error) {
    next(error);
  }
};

exports.deleteAddress = async (req, res, next) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return next(new AppError('Cliente no encontrado', 404));

    const address = client.addresses.id(req.params.addressId);
    if (!address) return next(new AppError('Dirección no encontrada', 404));

    const wasMain = address.isMain;
    client.addresses.pull(req.params.addressId);

    if (wasMain && client.addresses.length > 0) {
      client.addresses[0].isMain = true;
    }

    await client.save();

    res.status(200).json({
      success: true,
      data: client.addresses,
      message: 'Dirección eliminada correctamente',
    });
  } catch (error) {
    next(error);
  }
};