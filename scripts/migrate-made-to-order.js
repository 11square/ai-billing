require('dotenv').config();

const sequelize = require('../config/database');
const { validateEnvironment } = require('../config/env');
const GroceryProduct = require('../models/GroceryProduct');

const run = async () => {
  validateEnvironment();
  await sequelize.authenticate();
  const transaction = await sequelize.transaction();
  try {
    const products = await GroceryProduct.findAll({ where: { sourceType: 'own' }, transaction });
    const cleared = products.filter(product => Number(product.stock) !== 0 || Number(product.minStock) !== 0).length;
    await GroceryProduct.update({ stock: 0, minStock: 0 }, { where: { sourceType: 'own' }, transaction });
    await transaction.commit();
    console.log(`Made-to-order migration complete: ${products.length} own-made items updated, ${cleared} finished-stock balances cleared`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

run()
  .catch(error => {
    console.error('Made-to-order migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => sequelize.close());
