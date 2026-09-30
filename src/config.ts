import { ApiError } from "./errors";
import type { Bindings } from "./types";

export function authRequired(env: Bindings): boolean {
  return Boolean(env.APP_ACCESS_KEY?.trim());
}

export function assertSecretsProtected(env: Bindings): void {
  if (env.APP_ACCESS_KEY && !env.APP_ACCESS_KEY.trim()) {
    throw new ApiError(503, "invalid_access_key", "APP_ACCESS_KEY 不能为空");
  }
  // 服务端持有 STT Token 却未设访问密钥时拒绝服务，避免公开接口消耗部署者额度。
  if (env.SILICONFLOW_API_KEY && !authRequired(env)) {
    throw new ApiError(503, "access_key_not_configured", "配置 SILICONFLOW_API_KEY 时必须同时配置 APP_ACCESS_KEY");
  }
}
