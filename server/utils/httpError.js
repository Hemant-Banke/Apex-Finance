/**
 * An error that knows the HTTP status it should be reported as.
 *
 * Lives in utils (pure, no deps) rather than in the middleware, so a SERVICE can
 * throw one too: "Account not found" and "no FX rate for this trade" are things the
 * user did, not faults, and they must reach the client with their own message rather
 * than being flattened into a 500 by the error handler.
 *
 * `extra` is merged into the JSON body — the import route's `needsPassword`, say.
 */
class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra  = extra;
  }
}

/** A client error: the request was wrong. */
const badRequest = (message, extra) => new HttpError(400, message, extra);

/** The thing addressed does not exist (or is not this user's). */
const notFound = (message) => new HttpError(404, message);

module.exports = { HttpError, badRequest, notFound };
