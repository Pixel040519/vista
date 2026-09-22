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

  // Multer limits (file too large, too many files). Without this they carry
  // no statusCode and reach the client as a 500.
  if (err.name === 'MulterError') {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo must be 4 MB or smaller.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Too many files in one upload.'
      : err.message;
    return res.status(400).json({ error: msg });
  }

  // Joi validation errors
  if (err.isJoi) {
    return res.status(422).json({ error: err.details[0].message });
  }

  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    error: err.message || 'Internal Server Error',
    // `meta` is for the cases where the message alone leaves the client with
    // nowhere to go -- an LRN clash against an archived learner needs to hand
    // back that learner's id so the UI can offer to restore them. Opt-in per
    // throw site, so nothing leaks by default.
    ...(err.meta || {}),
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

// Custom error class
class AppError extends Error {
  constructor(message, statusCode, meta) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'AppError';
    // Extra fields merged into the JSON body by `errorHandler` above.
    if (meta) this.meta = meta;
  }
}

module.exports = { errorHandler, AppError };