const notFound = (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({
      message: `API route not found: ${req.method} ${req.originalUrl}`
    });
  }

  next();
};

const errorHandler = (error, req, res, next) => {
  const status = error.status || error.statusCode || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    message: status >= 500 ? 'Internal server error' : error.message,
    ...(process.env.NODE_ENV === 'development' && { details: error.message })
  });
};

module.exports = { notFound, errorHandler };
