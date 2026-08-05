// Create the first administrator for a fresh AI Bill installation.
// Required environment variables: ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD.
require('dotenv').config();

const sequelize = require('../config/database');
const User = require('../models/User');

async function bootstrap() {
  const name = String(process.env.ADMIN_NAME || '').trim();
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');

  if (!name || !email || password.length < 12) {
    throw new Error('ADMIN_NAME, ADMIN_EMAIL and ADMIN_PASSWORD (minimum 12 characters) are required');
  }

  await sequelize.authenticate();
  await sequelize.sync({ alter: false });
  const [user, created] = await User.findOrCreate({
    where: { email },
    defaults: { name, email, password, role: 'admin', activeShop: 'grocery' }
  });
  if (!created) throw new Error(`Administrator ${user.email} already exists`);
  console.log(`Administrator created: ${user.email}`);
}

bootstrap()
  .then(() => sequelize.close())
  .catch(async error => {
    console.error(error.message);
    await sequelize.close().catch(() => {});
    process.exit(1);
  });
