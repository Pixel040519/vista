const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.stack);

  // Postgres unique violation
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Record already exists.' });
  }

  // Postgres foreign key violation
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced record does not exist.' });
  }

  // Joi validation errors
  if (err.isJoi) {
    return res.status(422).json({ error: err.details[0].message });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
  }
}

module.exports = { errorHandler, AppError };