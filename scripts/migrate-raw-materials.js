require('dotenv').config();

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const { validateEnvironment } = require('../config/env');
const { RawMaterial, RawMaterialMovement } = require('../models/RawMaterial');

const run = async () => {
  validateEnvironment();
  await sequelize.authenticate();

  await RawMaterial.sync();
  await RawMaterialMovement.sync();

  const queryInterface = sequelize.getQueryInterface();
  const columns = await queryInterface.describeTable('purchase_items');
  if (!columns.raw_material_id) {
    console.log('Adding purchase_items.raw_material_id');
    await queryInterface.addColumn('purchase_items', 'raw_material_id', { type: DataTypes.INTEGER, allowNull: true });
  }
  if (!columns.item_kind) {
    console.log('Adding purchase_items.item_kind');
    await queryInterface.addColumn('purchase_items', 'item_kind', {
      type: DataTypes.ENUM('product', 'raw_material'),
      allowNull: false,
      defaultValue: 'product'
    });
  }
  await queryInterface.changeColumn('purchase_items', 'quantity', {
    type: DataTypes.DECIMAL(12, 3),
    allowNull: false
  });

  console.log('Raw-material inventory migration complete');
};

run()
  .catch(error => {
    console.error('Raw-material migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
