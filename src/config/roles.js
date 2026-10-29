/**
 * Roles del sistema.
 * - admin:    control total del back-office
 * - partner:  socio con acceso a su propio catálogo, ventas y reportes
 * - employee: empleado del back-office (POS, stock, clientes)
 * - customer: usuario público del ecommerce
 */
const ROLES = Object.freeze({
  ADMIN: 'admin',
  PARTNER: 'partner',
  EMPLOYEE: 'employee',
  CUSTOMER: 'customer',
});

const ALL_ROLES = Object.values(ROLES);

// Grupos reutilizables
const STAFF_ROLES = [ROLES.ADMIN, ROLES.PARTNER, ROLES.EMPLOYEE];
const PARTNER_SCOPED_ROLES = [ROLES.PARTNER, ROLES.EMPLOYEE];

module.exports = { ROLES, ALL_ROLES, STAFF_ROLES, PARTNER_SCOPED_ROLES };