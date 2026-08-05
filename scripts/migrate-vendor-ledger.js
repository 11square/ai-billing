require('dotenv').config();

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { validateEnvironment } = require('../config/env');
const { Purchase } = require('../models/Purchase');
const VendorLedgerEntry = require('../models/VendorLedgerEntry');

const dateOnly = value => new Date(value).toISOString().slice(0, 10);

const addMissingColumns = async (table, definitions) => {
  const queryInterface = sequelize.getQueryInterface();
  const existing = await queryInterface.describeTable(table);
  for (const [name, definition] of Object.entries(definitions)) {
    if (!existing[name]) {
      console.log(`Adding ${table}.${name}`);
      await queryInterface.addColumn(table, name, definition);
    }
  }
};

const run = async () => {
  validateEnvironment();
  await sequelize.authenticate();

  await addMissingColumns('vendors', {
    contact_person: { type: DataTypes.STRING(100), allowNull: true },
    alternate_phone: { type: DataTypes.STRING(20), allowNull: true },
    payment_terms_days: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    bank_name: { type: DataTypes.STRING(100), allowNull: true },
    account_number: { type: DataTypes.STRING(50), allowNull: true },
    ifsc: { type: DataTypes.STRING(20), allowNull: true },
    upi_id: { type: DataTypes.STRING(100), allowNull: true },
    notes: { type: DataTypes.TEXT, allowNull: true },
    is_active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true }
  });
  await addMissingColumns('purchases', {
    paid_amount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0 }
  });

  await VendorLedgerEntry.sync();

  const purchases = await Purchase.findAll({ where: { vendorId: { [require('sequelize').Op.ne]: null } } });
  for (const purchase of purchases) {
    const transaction = await sequelize.transaction();
    try {
      const referenceNo = purchase.vendorBillNo || `PO-${String(purchase.id).padStart(4, '0')}`;
      const [purchaseEntry] = await VendorLedgerEntry.findOrCreate({
        where: { purchaseId: purchase.id, entryType: 'purchase' },
        defaults: {
          vendorId: purchase.vendorId,
          direction: 'credit',
          amount: purchase.grandTotal,
          entryDate: dateOnly(purchase.billDate),
          referenceNo,
          notes: 'Migrated purchase balance',
          shopType: purchase.shopType,
          createdBy: purchase.createdBy
        },
        transaction
      });
      const legacyPaid = purchase.status === 'paid' ? Number(purchase.grandTotal) : Number(purchase.paidAmount || 0);
      if (legacyPaid > 0) {
        await purchase.update({ paidAmount: legacyPaid }, { transaction });
        await VendorLedgerEntry.findOrCreate({
          where: { purchaseId: purchase.id, entryType: 'payment' },
          defaults: {
            vendorId: purchase.vendorId,
            direction: 'debit',
            amount: legacyPaid,
            entryDate: dateOnly(purchase.paymentDate || purchase.billDate),
            referenceNo,
            paymentMode: purchase.paymentMode === 'cash' ? 'cash' : 'online',
            notes: 'Migrated purchase payment',
            shopType: purchase.shopType,
            createdBy: purchase.createdBy
          },
          transaction
        });
      }
      await transaction.commit();
      if (purchaseEntry) console.log(`Ledger ready for purchase ${purchase.id}`);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  console.log('Vendor ledger migration complete');
};

run()
  .catch(error => {
    console.error('Vendor ledger migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
