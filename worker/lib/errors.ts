import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ApiErrorBody } from "@shared/types";

/** 라우트에서 throw 하면 onError 에서 { error } JSON 으로 변환 */
export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: string,
    message: string,
    public extra: Omit<ApiErrorBody["error"], "code" | "message"> = {},
  ) {
    super(message);
  }
}

export const Errors = {
  unauthorized: () => new ApiError(401, "UNAUTHORIZED", "로그인이 만료되었습니다. 다시 로그인하세요."),
  forbidden: () => new ApiError(403, "FORBIDDEN", "권한이 없습니다."),
  mustChangePassword: () =>
    new ApiError(403, "MUST_CHANGE_PASSWORD", "새 비밀번호를 설정한 뒤 이용할 수 있습니다."),
  badRequest: (message: string, fields?: Record<string, string>) =>
    new ApiError(400, "BAD_REQUEST", message, { fields }),
  conflict: (message: string, fields?: Record<string, string>) =>
    new ApiError(409, "CONFLICT", message, { fields }),
  notFound: () => new ApiError(404, "NOT_FOUND", "요청한 항목을 찾을 수 없습니다."),
};
