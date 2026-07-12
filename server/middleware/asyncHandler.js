/**
 * Route error plumbing.
 *
 * Every route used to wrap its handler in the same try/catch that logged and returned
 * a 500. That is the error middleware's job, and it could never run while each route
 * swallowed its own rejections. `asyncHandler` hands them to it instead.
 *
 * A handler (or a service it calls) reports an expected failure by throwing an
 * `HttpError`. Anything else is a bug, and surfaces as a logged 500.
 */

/** Wrap an async route handler so a rejection reaches the error middleware. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * The terminal error handler. A client error (4xx) is the app talking to the user, so
 * its message is passed through; a 5xx is ours, so it is logged and the user gets a
 * generic message rather than an internal one.
 */
// eslint-disable-next-line no-unused-vars -- Express identifies an error handler by arity.
function errorHandler(err, req, res, next) {
  const status = err.status || 500;

  if (status >= 500) {
    console.error(`${req.method} ${req.originalUrl}`, err);
    return res.status(status).json({ message: 'Server error' });
  }

  res.status(status).json({ message: err.message, ...err.extra });
}

module.exports = { asyncHandler, errorHandler };
