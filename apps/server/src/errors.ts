import { AiError } from "@quirenote/ai";

/** 统一错误：{ error: { code, message } } + HTTP 状态码。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** 附加信息，原样放进错误响应（例如需要启用的插件 id）。 */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what}不存在`);
export const badRequest = (message: string, code = "bad_request") => new ApiError(400, code, message);

export function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof AiError) return new ApiError(err.status, err.code, err.message);
  const message = err instanceof Error ? err.message : String(err);
  return new ApiError(500, "internal", message);
}

export function errorMessageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
