import { ApiError } from "../errors";
import type { Fetcher, SpeechOptions } from "../types";
import { makeSsml } from "./ssml";

const ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
// Edge 兼容客户端使用的内置签名材料，不是部署者的私密 API Key；上游协议可能变动。
const SIGNING_KEY = "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
const FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const CLIENT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0";

interface Endpoint {
  region: string;
  token: string;
  expiresAt: number;
}

function decodeBase64(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function signEndpointRequest(): Promise<string> {
  // 按 Edge 兼容客户端的约定拼接请求信息并做 HMAC 签名，以换取短期令牌。
  const endpointPath = ENDPOINT_URL.split("://")[1];
  const encoded = encodeURIComponent(endpointPath);
  const requestId = crypto.randomUUID().replace(/-/g, "");
  const date = `${new Date().toUTCString().replace("GMT", "").trim()} GMT`.toLowerCase();
  const payload = `MSTranslatorAndroidApp${encoded}${date}${requestId}`.toLowerCase();
  const key = await crypto.subtle.importKey("raw", decodeBase64(SIGNING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
  const encodedSignature = btoa(String.fromCharCode(...signature));
  return `MSTranslatorAndroidApp::${encodedSignature}::${date}::${requestId}`;
}

function expiryFromJwt(token: string): number {
  try {
    const payload = token.split(".")[1];
    const decoded = JSON.parse(new TextDecoder().decode(decodeBase64(payload))) as { exp?: unknown };
    if (typeof decoded.exp === "number" && decoded.exp > Date.now() / 1000) return decoded.exp * 1000;
  } catch {
    // A malformed upstream token is handled below.
  }
  throw new ApiError(502, "edge_invalid_token", "Edge TTS 返回了无效的令牌");
}

export class EdgeTts {
  private cached?: Endpoint;
  private pending?: Promise<Endpoint>;

  constructor(private readonly fetcher: Fetcher = (input, init) => fetch(input, init)) {}

  private async endpoint(): Promise<Endpoint> {
    // 过期前 3 分钟刷新；pending 合并并发请求，避免同一时刻重复获取令牌。
    if (this.cached && this.cached.expiresAt - Date.now() > 180_000) return this.cached;
    if (!this.pending) {
      this.pending = this.requestEndpoint().finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }

  private async requestEndpoint(): Promise<Endpoint> {
    let response: Response;
    try {
      response = await this.fetcher(ENDPOINT_URL, {
        method: "POST",
        headers: {
          "Accept-Language": "zh-Hans",
          "X-ClientVersion": "4.0.530a 5fe1dc6c",
          "X-UserId": "0f04d16a175c411e",
          "X-HomeGeographicRegion": "zh-Hans-CN",
          "X-ClientTraceId": crypto.randomUUID().replace(/-/g, ""),
          "X-MT-Signature": await signEndpointRequest(),
          "User-Agent": CLIENT_USER_AGENT,
          "Content-Type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      console.warn("Edge endpoint connection failed", error instanceof Error ? error.message : String(error));
      throw new ApiError(502, "edge_endpoint_unavailable", "无法连接 Edge TTS");
    }
    if (!response.ok) throw new ApiError(502, "edge_endpoint_unavailable", "无法获取 Edge TTS 令牌");
    let data: { r?: unknown; t?: unknown };
    try {
      data = await response.json() as { r?: unknown; t?: unknown };
    } catch {
      throw new ApiError(502, "edge_invalid_response", "Edge TTS 返回了无效响应");
    }
    if (typeof data.r !== "string" || !/^[a-z][a-z0-9-]*$/.test(data.r) || typeof data.t !== "string") {
      throw new ApiError(502, "edge_invalid_response", "Edge TTS 返回了无效的服务地址");
    }
    this.cached = { region: data.r, token: data.t, expiresAt: expiryFromJwt(data.t) };
    return this.cached;
  }

  async synthesize(text: string, options: SpeechOptions): Promise<Uint8Array> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const endpoint = await this.endpoint();
      let response: Response;
      try {
        response = await this.fetcher(`https://${endpoint.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: "POST",
          headers: {
            Authorization: endpoint.token,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": FORMAT,
            "User-Agent": CLIENT_USER_AGENT,
          },
          body: makeSsml(text, options),
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
          continue;
        }
        throw new ApiError(502, "edge_unavailable", "Edge TTS 暂时不可用");
      }
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      await response.body?.cancel();
      // 401 先清缓存再重试；限流或服务端故障则短暂退避，其他错误直接返回。
      if (response.status === 401) this.cached = undefined;
      if ((response.status === 401 || response.status === 429 || response.status >= 500) && attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
        continue;
      }
      throw new ApiError(response.status === 429 ? 429 : 502, "edge_upstream_error", "Edge TTS 无法生成语音");
    }
    throw new ApiError(502, "edge_upstream_error", "Edge TTS 无法生成语音");
  }
}
