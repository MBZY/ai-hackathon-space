'use strict';

class AppError extends Error {
  constructor(message, code, statusCode, details) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = true;
  }
}

const badRequest = (msg, details) => new AppError(msg, 'BAD_REQUEST', 400, details);
const unauthorized = (msg = '请先登录') => new AppError(msg, 'UNAUTHORIZED', 401);
const forbidden = (msg = '没有权限执行此操作') => new AppError(msg, 'FORBIDDEN', 403);
const notFound = (msg = '资源不存在') => new AppError(msg, 'NOT_FOUND', 404);
const conflict = (msg) => new AppError(msg, 'CONFLICT', 409);
const unprocessable = (msg, details) => new AppError(msg, 'VALIDATION_ERROR', 422, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, unprocessable };
