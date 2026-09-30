export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly param: string | null = null,
    public readonly type = status < 500 ? "invalid_request_error" : "api_error",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorBody(error: ApiError) {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param,
      code: error.code,
    },
  };
}
