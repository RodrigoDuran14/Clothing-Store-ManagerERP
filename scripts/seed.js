require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../src/config/database");
const User = require("../src/models/User");
const { ROLES } = require('../src/config/roles');

const seed = async () => {
  try {
    await connectDB();

    const email = (process.env.ADMIN_EMAIL || "").toLowerCase();
    const password = process.env.ADMIN_PASSWORD;

    if (!email || !password) {
      console.error(
        "❌ Faltan variables ADMIN_EMAIL y/o ADMIN_PASSWORD en el .env",
      );
      process.exit(1);
    }

    const existing = await User.findOne({ email });
    if (existing) {
      // Asegura que el admin del seed siempre sea role='admin'
      if (existing.role !== ROLES.ADMIN) {
        existing.role = ROLES.ADMIN;
        existing.isActive = true;
        await existing.save();
        console.log(`🔄 Rol elevado a admin para: ${email}`);
      } else {
        console.log(`ℹ️  Admin ya existe: ${email} (sin cambios)`);
      }
    } else {
      await User.create({
        name: "Administrador",
        email,
        password,
        role: ROLES.ADMIN,
        isActive: true,
      });
      console.log(`✅ Admin creado: ${email}`);
    }
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error en seed:", error.message);
    process.exit(1);
  }
};

seed();
