class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bad(code, message) { return new HttpError(400, code, message); }
function unauthorized(message = "Sign in to continue.") { return new HttpError(401, "UNAUTHENTICATED", message); }
function forbidden(code, message) { return new HttpError(403, code, message); }
function notFound(message = "Not found.") { return new HttpError(404, "NOT_FOUND", message); }
function conflict(code, message) { return new HttpError(409, code, message); }

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, bad, unauthorized, forbidden, notFound, conflict, asyncHandler };
