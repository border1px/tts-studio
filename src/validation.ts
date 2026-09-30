import {
  DEFAULT_VOICE,
  MAX_AUDIO_FILE_BYTES,
  MAX_TEXT_CHARACTERS,
  MAX_TEXT_FILE_BYTES,
  STYLES,
} from "./catalog";
import { ApiError } from "./errors";
import type { SpeechOptions } from "./types";

const MAX_JSON_BYTES = 64 * 1024;
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "flac", "aac", "ogg", "webm", "amr", "3gp"]);

async function readLimitedBytes(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  // Content-Length 可能缺失或不可信，因此读取请求流时仍逐块检查实际大小。
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new ApiError(413, "request_too_large", "请求内容过大");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function readLimitedForm(request: Request, contentType: string, limit: number): Promise<FormData> {
  try {
    return await new Response(await readLimitedBytes(request, limit), {
      headers: { "Content-Type": contentType },
    }).formData();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_multipart", "表单内容无效");
  }
}

function numeric(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "number" && (typeof value !== "string" || !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value.trim()))) {
    throw new ApiError(400, "invalid_parameter", `${name} 必须为数字`, name);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "invalid_parameter", `${name} 必须在 ${min} 到 ${max} 之间`, name);
  }
  return parsed;
}

function speechOptions(value: Record<string, unknown>, input: string): SpeechOptions {
  const text = input.trim();
  if (!text) throw new ApiError(400, "missing_input", "请输入文字", "input");
  // 以 Unicode 码点而非 UTF-16 码元计数，避免普通表情符号被算成两个。
  if (Array.from(text).length > MAX_TEXT_CHARACTERS) {
    throw new ApiError(413, "text_too_long", `文字不能超过 ${MAX_TEXT_CHARACTERS} 个字符`, "input");
  }

  const voice = value.voice ?? DEFAULT_VOICE;
  if (typeof voice !== "string" || voice.length > 80 || !/^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9-]+Neural$/.test(voice)) {
    throw new ApiError(400, "invalid_parameter", "声音名称无效", "voice");
  }
  const style = value.style ?? "general";
  if (typeof style !== "string" || !STYLES.includes(style as (typeof STYLES)[number])) {
    throw new ApiError(400, "invalid_parameter", "不支持该语音风格", "style");
  }
  return {
    input: text,
    voice,
    style,
    speed: numeric(value.speed, "speed", 1, 0.5, 2),
    pitch: numeric(value.pitch, "pitch", 0, -50, 50),
    volume: numeric(value.volume, "volume", 0, -1, 1),
  };
}

export async function parseSpeechRequest(request: Request): Promise<SpeechOptions> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    // 在文件大小上额外预留表单边界和其他字段的空间，解析后再检查文件本身。
    const declaredSize = Number(request.headers.get("content-length") || 0);
    if (declaredSize > MAX_TEXT_FILE_BYTES + 64 * 1024) {
      throw new ApiError(413, "file_too_large", "TXT 文件不能超过 500 KB", "file");
    }
    const form = await readLimitedForm(request, contentType, MAX_TEXT_FILE_BYTES + 64 * 1024);
    const file = form.get("file");
    if (!(file instanceof File)) throw new ApiError(400, "missing_file", "请选择 TXT 文件", "file");
    if (!file.name.toLowerCase().endsWith(".txt") && !file.type.startsWith("text/")) {
      throw new ApiError(400, "invalid_file_type", "仅支持 TXT 文件", "file");
    }
    if (file.size > MAX_TEXT_FILE_BYTES) throw new ApiError(413, "file_too_large", "TXT 文件不能超过 500 KB", "file");
    const options: Record<string, unknown> = {};
    for (const name of ["voice", "speed", "pitch", "volume", "style"]) {
      const field = form.get(name);
      if (field !== null) {
        if (typeof field !== "string") throw new ApiError(400, "invalid_parameter", `${name} 必须为文本`, name);
        options[name] = field;
      }
    }
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new ApiError(400, "invalid_file_encoding", "TXT 文件必须使用 UTF-8 编码", "file");
    }
    return speechOptions(options, text);
  }

  if (!contentType.includes("application/json")) {
    throw new ApiError(415, "invalid_content_type", "请使用 application/json 或 multipart/form-data", "content-type");
  }
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_JSON_BYTES) throw new ApiError(413, "request_too_large", "请求内容过大");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readLimitedBytes(request, MAX_JSON_BYTES)));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_json", "JSON 内容无效");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "invalid_json", "JSON 内容必须是对象");
  }
  const options = body as Record<string, unknown>;
  if (typeof options.input !== "string") throw new ApiError(400, "missing_input", "input 必须为文本", "input");
  return speechOptions(options, options.input);
}

export async function parseTranscriptionRequest(request: Request): Promise<{ file: File; token?: string }> {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    throw new ApiError(415, "invalid_content_type", "请使用 multipart/form-data", "content-type");
  }
  const declaredSize = Number(request.headers.get("content-length") || 0);
  if (declaredSize > MAX_AUDIO_FILE_BYTES + 64 * 1024) {
    throw new ApiError(413, "file_too_large", "音频文件不能超过 10 MB", "file");
  }
  const form = await readLimitedForm(request, contentType, MAX_AUDIO_FILE_BYTES + 64 * 1024);
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "missing_file", "请选择音频文件", "file");
  if (file.size > MAX_AUDIO_FILE_BYTES) throw new ApiError(413, "file_too_large", "音频文件不能超过 10 MB", "file");
  const extension = file.name.toLowerCase().split(".").pop() || "";
  if (!AUDIO_EXTENSIONS.has(extension)) {
    throw new ApiError(400, "invalid_file_type", "不支持该音频文件类型", "file");
  }
  const token = form.get("token");
  if (token !== null && typeof token !== "string") {
    throw new ApiError(400, "invalid_parameter", "token 必须为文本", "token");
  }
  return { file, token: token?.trim() || undefined };
}
