import type { SpeechOptions } from "../types";

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function makeSsml(text: string, options: SpeechOptions): string {
  const language = options.voice.split("-").slice(0, 2).join("-");
  const signed = (value: number) => value >= 0 ? `+${value}` : String(value);
  const rate = `${signed(Math.round((options.speed - 1) * 100))}%`;
  const pitch = `${signed(Math.round(options.pitch))}Hz`;
  const volume = `${signed(Math.round(options.volume * 100))}%`;
  const prosody = `<prosody rate="${rate}" pitch="${pitch}" volume="${volume}">${escapeXml(text)}</prosody>`;
  // 通用风格只使用 prosody；其余风格才包裹微软扩展的 express-as 标签。
  const content = options.style === "general"
    ? prosody
    : `<mstts:express-as style="${options.style}">${prosody}</mstts:express-as>`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${language}"><voice name="${options.voice}">${content}</voice></speak>`;
}
