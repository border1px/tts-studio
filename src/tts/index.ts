import { splitText, joinAudio } from "./chunks";
import type { SpeechOptions } from "../types";

export interface SpeechChunkSynthesizer {
  synthesize(text: string, options: SpeechOptions): Promise<Uint8Array>;
}

export async function synthesizeSpeech(
  options: SpeechOptions,
  synthesizer: SpeechChunkSynthesizer,
): Promise<ArrayBuffer> {
  const chunks = splitText(options.input);
  const audio: Uint8Array[] = [];
  // 顺序合成，确保音频片段与原文顺序一致。
  for (const chunk of chunks) {
    audio.push(await synthesizer.synthesize(chunk, options));
  }
  return joinAudio(audio);
}
