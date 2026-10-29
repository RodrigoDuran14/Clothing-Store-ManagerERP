const mongoose = require('mongoose');
const AppError = require('../utils/AppError');
const { slugify } = require('../utils/helpers');

const MAX_LEVEL = 5;

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
      trim: true,
      maxlength: [100, 'El nombre no puede superar los 100 caracteres'],
      set: (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: [1000, 'La descripción no puede superar los 1000 caracteres'],
    },
    image: { type: String, default: null },
    icon: { type: String, default: null },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      default: null,
    },
    level: { type: Number, min: 0, max: MAX_LEVEL, default: 0 },
    order: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    isFeatured: { type: Boolean, default: false },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* Índices: unicidad por partner */
categorySchema.index({ partnerId: 1, name: 1 }, { unique: true });
categorySchema.index({ partnerId: 1, slug: 1 }, { unique: true });
categorySchema.index({ parentId: 1, order: 1 });
categorySchema.index({ isActive: 1, level: 1 });
categorySchema.index({ isFeatured: 1 });

/* Virtuals */
categorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentId',
});

categorySchema.virtual('fullPath').get(function () {
  if (this.populated('parentId') && this.parentId) {
    const parentPath = this.parentId.fullPath || this.parentId.name;
    return `${parentPath} > ${this.name}`;
  }
  return this.name;
});

/* pre-save: slug + jerarquía */
categorySchema.pre('save', async function (next) {
  try {
    /* ---------- 1. Slug ---------- */
    if (this.isModified('name') || !this.slug) {
      const baseSlug = slugify(this.name) || 'categoria';
      let slug = baseSlug;
      let counter = 1;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const exists = await this.constructor.findOne({
          slug,
          partnerId: this.partnerId || null,
          _id: { $ne: this._id },
        });
        if (!exists) break;
        counter += 1;
        slug = `${baseSlug}-${counter}`;
      }
      this.slug = slug;
    }

    /* ---------- 2. Jerarquía ---------- */
    if (this.parentId) {
      if (this.parentId.equals(this._id)) {
        return next(
          new AppError('Una categoría no puede ser su propio padre', 400)
        );
      }

      const parent = await this.constructor.findById(this.parentId);
      if (!parent) {
        return next(new AppError('Categoría padre no encontrada', 404));
      }

      if (parent.level >= MAX_LEVEL) {
        return next(
          new AppError(
            `No se pueden anidar más de ${MAX_LEVEL} niveles de categorías`,
            400
          )
        );
      }

      const visited = new Set();
      let ancestor = parent;
      while (ancestor && ancestor.parentId) {
        if (ancestor.parentId.equals(this._id)) {
          return next(
            new AppError('Referencia circular detectada en categorías', 400)
          );
        }
        const key = ancestor.parentId.toString();
        if (visited.has(key)) break;
        visited.add(key);
        ancestor = await this.constructor.findById(ancestor.parentId);
      }

      this.level = parent.level + 1;
    } else {
      this.level = 0;
    }

    next();
  } catch (error) {
    next(error);
  }
});

/* Métodos */
categorySchema.methods.hasProducts = async function () {
  if (!mongoose.models.Product) return false;
  const count = await mongoose.models.Product.countDocuments({
    categoryId: this._id,
    isActive: true,
  });
  return count > 0;
};

categorySchema.methods.getBreadcrumb = async function () {
  const chain = [];
  let current = this;
  const visited = new Set();

  while (current && !visited.has(current._id.toString())) {
    visited.add(current._id.toString());
    chain.unshift({
      _id: current._id,
      name: current.name,
      slug: current.slug,
      level: current.level,
    });
    if (!current.parentId) break;
    current = await this.constructor.findById(current.parentId);
  }
  return chain;
};

/* Statics */
categorySchema.statics.getCategoryTree = async function (filter = {}) {
  const categories = await this.find(filter)
    .sort({ level: 1, order: 1, name: 1 })
    .lean();

  const map = {};
  const roots = [];

  categories.forEach((cat) => {
    map[cat._id.toString()] = { ...cat, children: [] };
  });

  categories.forEach((cat) => {
    const node = map[cat._id.toString()];
    if (cat.parentId && map[cat.parentId.toString()]) {
      map[cat.parentId.toString()].children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};

categorySchema.statics.getForSelect = async function (filter = {}) {
  const categories = await this.find(filter)
    .select('_id name slug level parentId order isFeatured')
    .sort({ level: 1, order: 1, name: 1 })
    .lean();

  return categories.map((c) => ({
    _id: c._id,
    name: `${'— '.repeat(c.level)}${c.name}`,
    rawName: c.name,
    slug: c.slug,
    level: c.level,
    parentId: c.parentId,
    isFeatured: c.isFeatured,
  }));
};

categorySchema.statics.updateDescendantsLevels = async function (
  parentId,
  parentLevel
) {
  const children = await this.find({ parentId }).select('_id level');
  for (const child of children) {
    const newLevel = parentLevel + 1;
    if (child.level !== newLevel) {
      await this.collection.updateOne(
        { _id: child._id },
        { $set: { level: newLevel } }
      );
    }
    await this.updateDescendantsLevels(child._id, newLevel);
  }
};

module.exports = mongoose.model('Category', categorySchema);