const requiredVariables = [
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'JWT_SECRET'
];

const validateEnvironment = () => {
  const missing = requiredVariables.filter((name) => {
    const value = process.env[name];
    return value === undefined || value === '';
  });

  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
      'Copy .env.example to .env and provide the required values.'
    );
  }
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  host: process.env.HOST || (process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0'),
  syncAlter: process.env.DB_SYNC_ALTER === 'true'
};

module.exports = { env, validateEnvironment };
