export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new AppError(400, code, message, details);
export const unauthorized = (message = 'Chưa đăng nhập') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Không có quyền') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Bản ghi') => new AppError(404, 'NOT_FOUND', `${what} không tồn tại`);
export const conflict = (code, message, details) => new AppError(409, code, message, details);

/** Middleware xử lý lỗi cho Hono */
export function errorHandler(err, c) {
  if (err instanceof AppError) {
    return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err?.name === 'ZodError') {
    return c.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Dữ liệu không hợp lệ',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      400,
    );
  }
  if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return c.json({ error: { code: 'DUPLICATE', message: 'Dữ liệu bị trùng', details: { sqlite: err.message } } }, 409);
  }
  console.error(err);
  return c.json({ error: { code: 'INTERNAL', message: 'Lỗi hệ thống' } }, 500);
}
