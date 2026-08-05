require('dotenv').config();

const sequelize = require('../config/database');
const { validateEnvironment } = require('../config/env');
const GroceryProduct = require('../models/GroceryProduct');
const { RawMaterial } = require('../models/RawMaterial');

const supportedUnits = new Set(['g', 'kg', 'ml', 'L', 'piece', 'pack']);

const run = async () => {
  validateEnvironment();
  await sequelize.authenticate();
  const transaction = await sequelize.transaction();
  let created = 0;
  let linked = 0;

  try {
    const products = await GroceryProduct.findAll({ where: { sourceType: 'own', isActive: true }, transaction });
    for (const product of products) {
      const recipe = Array.isArray(product.boq) ? product.boq : [];
      let changed = false;
      const linkedRecipe = [];

      for (const line of recipe) {
        if (line.rawMaterialId) {
          linkedRecipe.push(line);
          continue;
        }
        const name = String(line.ingredient || '').trim();
        if (!name) {
          linkedRecipe.push(line);
          continue;
        }
        const unit = supportedUnits.has(line.unit) ? line.unit : 'g';
        let material = await RawMaterial.findOne({ where: { name, shopType: 'grocery' }, transaction });
        if (!material) {
          material = await RawMaterial.create({
            name,
            category: 'Ingredients',
            unit,
            stock: 0,
            minStock: 0,
            costPerUnit: 0,
            shopType: 'grocery',
            isActive: true,
            notes: `Created from ${product.name} recipe`
          }, { transaction });
          created += 1;
        }
        linkedRecipe.push({ ...line, rawMaterialId: material.id, ingredient: material.name, unit: line.unit || material.unit });
        linked += 1;
        changed = true;
      }

      if (changed) await product.update({ boq: linkedRecipe }, { transaction });
    }

    await transaction.commit();
    console.log(`BOQ inventory migration complete: ${created} inventory items created, ${linked} recipe lines linked`);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
};

run()
  .catch(error => {
    console.error('BOQ inventory migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => sequelize.close());
