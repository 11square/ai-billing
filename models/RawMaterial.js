const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const User = require('./User');

const RawMaterial = sequelize.define('RawMaterial', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(120), allowNull: false },
  category: { type: DataTypes.STRING(60) },
  sku: { type: DataTypes.STRING(50) },
  unit: { type: DataTypes.ENUM('g', 'kg', 'ml', 'L', 'piece', 'pack'), allowNull: false, defaultValue: 'kg' },
  stock: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
  minStock: { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0, field: 'min_stock' },
  costPerUnit: { type: DataTypes.DECIMAL(14, 4), allowNull: false, defaultValue: 0, field: 'cost_per_unit' },
  vendorId: { type: DataTypes.INTEGER, field: 'vendor_id' },
  expiryDate: { type: DataTypes.DATEONLY, field: 'expiry_date' },
  notes: { type: DataTypes.TEXT },
  shopType: { type: DataTypes.ENUM('grocery', 'fertilizer'), allowNull: false, field: 'shop_type' },
  isActive: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true, field: 'is_active' }
}, {
  tableName: 'raw_materials',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  indexes: [{ unique: true, fields: ['name', 'shop_type'] }]
});

const RawMaterialMovement = sequelize.define('RawMaterialMovement', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  rawMaterialId: { type: DataTypes.INTEGER, allowNull: false, field: 'raw_material_id' },
  movementType: {
    type: DataTypes.ENUM('opening', 'purchase', 'adjustment_in', 'adjustment_out', 'production_use', 'wastage', 'return_to_vendor'),
    allowNull: false,
    field: 'movement_type'
  },
  direction: { type: DataTypes.ENUM('in', 'out'), allowNull: false },
  quantity: { type: DataTypes.DECIMAL(14, 3), allowNull: false },
  balanceAfter: { type: DataTypes.DECIMAL(14, 3), allowNull: false, field: 'balance_after' },
  unitCost: { type: DataTypes.DECIMAL(14, 4), field: 'unit_cost' },
  referenceType: { type: DataTypes.STRING(30), field: 'reference_type' },
  referenceId: { type: DataTypes.INTEGER, field: 'reference_id' },
  notes: { type: DataTypes.TEXT },
  shopType: { type: DataTypes.ENUM('grocery', 'fertilizer'), allowNull: false, field: 'shop_type' },
  createdBy: { type: DataTypes.INTEGER, field: 'created_by' }
}, {
  tableName: 'raw_material_movements',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['raw_material_id', 'created_at'] },
    { fields: ['reference_type', 'reference_id'] }
  ]
});

RawMaterial.hasMany(RawMaterialMovement, { foreignKey: 'rawMaterialId', as: 'movements' });
RawMaterialMovement.belongsTo(RawMaterial, { foreignKey: 'rawMaterialId', as: 'material' });
RawMaterialMovement.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

module.exports = { RawMaterial, RawMaterialMovement };
