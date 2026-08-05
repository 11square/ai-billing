require('dotenv').config();

const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const migrate = async () => {
  await sequelize.authenticate();
  const queryInterface = sequelize.getQueryInterface();
  const columns = await queryInterface.describeTable('grocery_products');

  const additions = [
    ['image', { type: DataTypes.TEXT('long'), allowNull: true }],
    ['source_type', {
      type: DataTypes.ENUM('own', 'outsourced'),
      allowNull: false,
      defaultValue: 'own'
    }],
    ['boq', { type: DataTypes.JSON, allowNull: true }]
    ,
    ['sale_mode', {
      type: DataTypes.ENUM('packed', 'measured'),
      allowNull: false,
      defaultValue: 'packed'
    }]
  ];

  for (const [column, definition] of additions) {
    if (!columns[column]) {
      await queryInterface.addColumn('grocery_products', column, definition);
      console.log(`Added grocery_products.${column}`);
    }
  }

  await queryInterface.changeColumn('invoice_items', 'unit_price', {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false
  });
  console.log('Verified invoice_items.unit_price supports measured rates');

  console.log('Grocery schema migration complete');
};

migrate()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
