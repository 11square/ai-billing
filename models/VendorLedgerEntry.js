const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { Vendor, Purchase } = require('./Purchase');
const User = require('./User');

const VendorLedgerEntry = sequelize.define('VendorLedgerEntry', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  vendorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'vendor_id'
  },
  purchaseId: {
    type: DataTypes.INTEGER,
    field: 'purchase_id'
  },
  entryType: {
    type: DataTypes.ENUM(
      'opening_balance',
      'purchase',
      'payment',
      'purchase_return',
      'credit_adjustment',
      'debit_adjustment'
    ),
    allowNull: false,
    field: 'entry_type'
  },
  direction: {
    type: DataTypes.ENUM('credit', 'debit'),
    allowNull: false
  },
  amount: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false
  },
  entryDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'entry_date'
  },
  referenceNo: {
    type: DataTypes.STRING(100),
    field: 'reference_no'
  },
  paymentMode: {
    type: DataTypes.ENUM('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'online', 'other'),
    field: 'payment_mode'
  },
  notes: {
    type: DataTypes.TEXT
  },
  shopType: {
    type: DataTypes.ENUM('grocery', 'fertilizer'),
    allowNull: false,
    field: 'shop_type'
  },
  createdBy: {
    type: DataTypes.INTEGER,
    field: 'created_by'
  }
}, {
  tableName: 'vendor_ledger_entries',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: false,
  indexes: [
    { fields: ['vendor_id', 'entry_date'] },
    { fields: ['purchase_id'] }
  ]
});

Vendor.hasMany(VendorLedgerEntry, { foreignKey: 'vendorId', as: 'ledgerEntries' });
VendorLedgerEntry.belongsTo(Vendor, { foreignKey: 'vendorId', as: 'vendor' });
Purchase.hasMany(VendorLedgerEntry, { foreignKey: 'purchaseId', as: 'ledgerEntries' });
VendorLedgerEntry.belongsTo(Purchase, { foreignKey: 'purchaseId', as: 'purchase' });
VendorLedgerEntry.belongsTo(User, { foreignKey: 'createdBy', as: 'creator' });

module.exports = VendorLedgerEntry;
