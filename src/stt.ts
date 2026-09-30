import { ApiError } from "./errors";
import type { Fetcher } from "./types";

export async function transcribe(file: File, token: string, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", "FunAudioLLM/SenseVoiceSmall");
  // 不手写 Content-Type，让运行时为 FormData 自动生成 multipart boundary。
  let response: Response;
  try {
    response = await fetcher("https://api.siliconflow.cn/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ApiError(502, "stt_unavailable", "语音转文字服务暂时不可用");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(response.status === 429 ? 429 : 502, "stt_upstream_error", "语音转文字服务拒绝了请求");
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new ApiError(502, "stt_invalid_response", "语音转文字服务返回了无效的 JSON");
  }
  if (!result || typeof result !== "object" || typeof (result as { text?: unknown }).text !== "string") {
    throw new ApiError(502, "stt_invalid_response", "语音转文字服务未返回文本");
  }
  return (result as { text: string }).text;
}
