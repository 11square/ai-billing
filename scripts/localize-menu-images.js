require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const sequelize = require('../config/database');
const GroceryProduct = require('../models/GroceryProduct');

const outputDirectory = path.join(__dirname, '..', 'public', 'images', 'menu');

const extensionFor = (contentType) => {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
};

const localize = async () => {
  await sequelize.authenticate();
  await fs.mkdir(outputDirectory, { recursive: true });

  const products = await GroceryProduct.findAll({
    where: { isActive: true }
  });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const product of products) {
    if (!product.image || product.image.startsWith('/images/menu/')) {
      skipped++;
      continue;
    }

    try {
      const response = await fetch(product.image, {
        headers: { 'User-Agent': 'AIBill/1.0' }
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.startsWith('image/')) {
        throw new Error(`Image request failed (${response.status})`);
      }

      const extension = extensionFor(contentType);
      const fileName = `product-${product.id}.${extension}`;
      const filePath = path.join(outputDirectory, fileName);
      const bytes = Buffer.from(await response.arrayBuffer());

      await fs.writeFile(filePath, bytes);
      await product.update({ image: `/images/menu/${fileName}` });
      downloaded++;
      console.log(`Saved ${product.name} -> ${fileName}`);
    } catch (error) {
      failed++;
      console.error(`Failed ${product.name}: ${error.message}`);
    }
  }

  console.log(JSON.stringify({ downloaded, skipped, failed, total: products.length }));
  if (failed) process.exitCode = 1;
};

localize()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
