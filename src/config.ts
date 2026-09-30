import { ApiError } from "./errors";
import type { Bindings } from "./types";

export function authRequired(env: Bindings): boolean {
  return Boolean(env.APP_ACCESS_KEY?.trim());
}

export function assertSecretsProtected(env: Bindings): void {
  if (env.APP_ACCESS_KEY && !env.APP_ACCESS_KEY.trim()) {
    throw new ApiError(503, "invalid_access_key", "APP_ACCESS_KEY 不能为空");
  }
  if (env.SILICONFLOW_API_KEY && !authRequired(env)) {
    throw new ApiError(503, "access_key_not_configured", "配置 SILICONFLOW_API_KEY 时必须同时配置 APP_ACCESS_KEY");
  }
}
