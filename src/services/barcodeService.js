/**
 * Servicio de códigos de barras EAN-13.
 * EAN-13: 13 dígitos. El último es el dígito verificador (check digit).
 * Los primeros 3 (prefijo) identifican el país/fabricante.
 * Por convención usamos el rango 200-299 para códigos de uso interno.
 */

/**
 * Calcula el dígito verificador EAN-13.
 * Algoritmo: posiciones impares (1-based) × 1, pares × 3, módulo 10.
 *
 * @param {string} digits12 - 12 dígitos sin el verificador
 * @returns {number} Dígito verificador (0-9)
 */
const calculateCheckDigit = (digits12) => {
  const str = String(digits12);
  if (!/^\d{12}$/.test(str)) {
    throw new Error('Se requieren exactamente 12 dígitos para calcular el verificador');
  }
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(str[i], 10);
    sum += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (sum % 10)) % 10;
};

/**
 * Genera un código EAN-13 aleatorio y válido.
 *
 * @param {string} prefix - 3 dígitos de prefijo (default '200')
 * @returns {string} EAN-13 de 13 dígitos
 */
const generateEAN13 = (prefix = '200') => {
  const p = String(prefix).padStart(3, '0').slice(0, 3);
  if (!/^\d{3}$/.test(p)) {
    throw new Error('El prefijo debe ser de 3 dígitos numéricos');
  }
  let payload = '';
  for (let i = 0; i < 9; i++) {
    payload += Math.floor(Math.random() * 10);
  }
  const digits12 = p + payload;
  return digits12 + calculateCheckDigit(digits12);
};

/**
 * Valida formato + dígito verificador de un EAN-13.
 */
const validateBarcode = (barcode) => {
  const str = String(barcode);
  if (!/^\d{13}$/.test(str)) return false;
  const digits12 = str.slice(0, 12);
  const check = parseInt(str[12], 10);
  return calculateCheckDigit(digits12) === check;
};

/**
 * Genera un código de barras único consultando el modelo.
 * Reintenta en caso de colisión (probabilidad prácticamente nula).
 *
 * @param {Model} Model - Modelo Mongoose con campo `barcode`
 * @param {number} maxAttempts
 */
const generateUniqueBarcode = async (Model, maxAttempts = 10) => {
  for (let i = 0; i < maxAttempts; i++) {
    const code = generateEAN13();
    const exists = await Model.findOne({ barcode: code }).select('_id').lean();
    if (!exists) return code;
  }
  throw new Error('No se pudo generar un código de barras único. Reintente.');
};

module.exports = {
  calculateCheckDigit,
  generateEAN13,
  validateBarcode,
  generateUniqueBarcode,
};