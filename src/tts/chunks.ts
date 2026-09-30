import { MAX_CHUNK_CHARACTERS } from "../catalog";

const SENTENCE_END = /[。！？.!?；;\n]/;

export function splitText(text: string, maxCharacters = MAX_CHUNK_CHARACTERS): string[] {
  const characters = Array.from(text);
  const chunks: string[] = [];
  let start = 0;
  while (start < characters.length) {
    let end = Math.min(start + maxCharacters, characters.length);
    if (end < characters.length) {
      for (let index = end - 1; index > start + Math.floor(maxCharacters / 2); index--) {
        if (SENTENCE_END.test(characters[index])) {
          end = index + 1;
          break;
        }
      }
    }
    const chunk = characters.slice(start, end).join("");
    if (chunk.trim()) chunks.push(chunk);
    start = end;
  }
  return chunks;
}

export function joinAudio(parts: Uint8Array[]): ArrayBuffer {
  const total = parts.reduce((size, part) => size + part.byteLength, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.byteLength;
  }
  return joined.buffer;
}
