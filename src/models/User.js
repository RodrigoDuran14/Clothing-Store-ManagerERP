const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ALL_ROLES } = require('../config/roles');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [100, 'El nombre no puede superar los 100 caracteres'],
    },
    email: {
      type: String,
      required: [true, 'El email es obligatorio'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\S+@\S+\.\S+$/, 'Email inválido'],
    },
    phone: { type: String, trim: true, default: null },
    image: { type: String, default: null },
    role: {
      type: String,
      enum: {
        values: ALL_ROLES,
        message: `Rol inválido. Valores permitidos: ${ALL_ROLES.join(', ')}`,
      },
      default: ROLES.CUSTOMER,
      required: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },

    isActive: { type: Boolean, default: true },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: [8, 'La contraseña debe tener al menos 8 caracteres'],
      select: false,
    },
    lastLogin: { type: Date, default: null },
    passwordChangedAt: Date,
    resetPasswordToken: String,
    resetPasswordExpire: Date,
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

userSchema.index({ isActive: 1 });
userSchema.index({ role: 1 });
userSchema.index({ partnerId: 1 });

/* =========================================================
 *  Hashear password antes de guardar
 * ========================================================= */
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  if (!this.isNew) this.passwordChangedAt = Date.now() - 1000;
  next();
});

/* =========================================================
 *  Reglas de negocio del modelo
 * ========================================================= */
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changed = parseInt(this.passwordChangedAt.getTime() / 1000, 10);
    return JWTTimestamp < changed;
  }
  return false;
};

/**
 * ¿Este usuario necesita un partnerId asignado?
 * partner y employee deben tener partnerId.
 */
userSchema.methods.requiresPartner = function () {
  return this.role === ROLES.PARTNER || this.role === ROLES.EMPLOYEE;
};

/* =========================================================
 *  Sanitizar salida
 * ========================================================= */
userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: true });
  delete obj.password;
  delete obj.resetPasswordToken;
  delete obj.resetPasswordExpire;
  delete obj.__v;
  delete obj.id;
  return obj;
};

module.exports = mongoose.model('User', userSchema);