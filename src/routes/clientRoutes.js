const express = require('express');
const clientController = require('../controllers/clientController');
const { protect } = require('../middleware/auth');
const { isAdmin, isEmployeeOrAbove } = require('../middleware/role');
const validate = require('../middleware/validate');
const {
  createClientValidator,
  updateClientValidator,
  enableCreditValidator,
  registerPaymentValidator,
  checkCreditLimitValidator,
  updatePreferencesValidator,
  addAddressValidator,
  updateAddressValidator,
  clientIdParamValidator,
  addressIdParamValidator,
} = require('../validators/clientValidator');

const router = express.Router();

// Todas las rutas requieren autenticación + staff (empleado o superior)
router.use(protect, isEmployeeOrAbove);

/* =========================================================
 *  Rutas específicas primero
 * ========================================================= */
router.get(
  '/stats',
  isAdmin,
  clientController.getClientStats
);

router.get(
  '/credit-risk',
  isAdmin,
  clientController.getCreditRiskClients
);

/* =========================================================
 *  CRUD principal
 * ========================================================= */
router
  .route('/')
  .get(clientController.getClients)
  .post(createClientValidator, validate, clientController.createClient);

/* =========================================================
 *  Operaciones por cliente
 * ========================================================= */
router.patch(
  '/:id/status',
  clientIdParamValidator,
  validate,
  clientController.toggleClientStatus
);

router.patch(
  '/:id/preferences',
  clientIdParamValidator,
  updatePreferencesValidator,
  validate,
  clientController.updatePreferences
);

router.get(
  '/:id/purchases',
  clientIdParamValidator,
  validate,
  clientController.getPurchaseHistory
);

/* ---------- CRÉDITO ---------- */
router.post(
  '/:id/credit/enable',
  clientIdParamValidator,
  enableCreditValidator,
  validate,
  clientController.enableCredit
);

router.post(
  '/:id/credit/disable',
  clientIdParamValidator,
  validate,
  clientController.disableCredit
);

router.post(
  '/:id/credit/payments',
  clientIdParamValidator,
  registerPaymentValidator,
  validate,
  clientController.registerCreditPayment
);

router.get(
  '/:id/credit/summary',
  clientIdParamValidator,
  validate,
  clientController.getCreditSummary
);

router.get(
  '/:id/credit/check',
  clientIdParamValidator,
  checkCreditLimitValidator,
  validate,
  clientController.checkCreditLimit
);

/* ---------- DIRECCIONES ---------- */
router.post(
  '/:id/addresses',
  clientIdParamValidator,
  addAddressValidator,
  validate,
  clientController.addAddress
);

router.patch(
  '/:id/addresses/:addressId',
  addressIdParamValidator,
  updateAddressValidator,
  validate,
  clientController.updateAddress
);

router.delete(
  '/:id/addresses/:addressId',
  addressIdParamValidator,
  validate,
  clientController.deleteAddress
);

/* =========================================================
 *  GET / PATCH / DELETE por id (al final)
 * ========================================================= */
router
  .route('/:id')
  .get(clientIdParamValidator, validate, clientController.getClientById)
  .patch(
    clientIdParamValidator,
    updateClientValidator,
    validate,
    clientController.updateClient
  )
  .delete(clientIdParamValidator, validate, clientController.deleteClient);

module.exports = router;