import type { ApiErrorBody } from "@shared/types";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details: Omit<ApiErrorBody["error"], "code" | "message"> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: "same-origin",
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const error = body?.error;
    throw new ApiClientError(
      response.status,
      error?.code ?? "HTTP_ERROR",
      error?.message ?? "요청을 처리하지 못했습니다.",
      {
        remainingAttempts: error?.remainingAttempts,
        lockedMinutes: error?.lockedMinutes,
        fields: error?.fields,
      },
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
