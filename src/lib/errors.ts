export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, msg, details);
export const notFound = (msg = "Not found") => new AppError(404, msg);
export const conflict = (msg: string) => new AppError(409, msg);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, msg, details);
