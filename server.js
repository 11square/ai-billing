require('dotenv').config();

const createApp = require('./app');
const sequelize = require('./config/database');
const { env, validateEnvironment } = require('./config/env');

const startServer = async () => {
  try {
    validateEnvironment();
    await sequelize.authenticate();
    console.log('MySQL connected successfully');

    await sequelize.sync({ alter: env.syncAlter });
    console.log(`Database synced (alter: ${env.syncAlter})`);

    const app = createApp();
    const server = app.listen(env.port, env.host, () => {
      console.log(`Server running at http://${env.host}:${env.port}`);
    });

    require('./services/reportService').startScheduler();

    const shutdown = (signal) => {
      console.log(`${signal} received; shutting down gracefully`);
      server.close(async () => {
        await sequelize.close();
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (error) {
    console.error('Server startup failed:', error);
    process.exit(1);
  }
};

startServer();
