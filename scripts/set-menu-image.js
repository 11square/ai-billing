require('dotenv').config();

const { Op } = require('sequelize');
const sequelize = require('../config/database');
const GroceryProduct = require('../models/GroceryProduct');

const [search, image] = process.argv.slice(2);

const run = async () => {
  if (!search) throw new Error('Usage: node scripts/set-menu-image.js <name> [image-path]');
  await sequelize.authenticate();
  const products = await GroceryProduct.findAll({
    where: { name: { [Op.like]: `%${search}%` }, isActive: true },
    attributes: ['id', 'name', 'image']
  });
  if (!image) {
    console.log(JSON.stringify(products.map(product => product.toJSON())));
    return;
  }
  if (products.length !== 1) {
    throw new Error(`Expected exactly one matching product, found ${products.length}`);
  }
  await products[0].update({ image });
  console.log(JSON.stringify({ id: products[0].id, name: products[0].name, image }));
};

run()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
