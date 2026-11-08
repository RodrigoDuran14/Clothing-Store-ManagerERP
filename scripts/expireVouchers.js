require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const voucherService = require('../src/services/voucherService');

const run = async () => {
  try {
    await connectDB();
    const result = await voucherService.expireVouchers();
    console.log(`✅ Vouchers vencidos: ${result.expiredCount} (${result.at.toISOString()})`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error al expirar vouchers:', error.message);
    process.exit(1);
  }
};

run();