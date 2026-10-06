// Code-owned lexical processing; no model or remote embedding provider involved.
export const normalizeMemoryText = (text: string) =>
  text.normalize("NFKC").toLowerCase();
export const memoryTerms = (text: string, limit = 30) =>
  [...new Set(normalizeMemoryText(text).match(/[\p{L}\p{N}_]+/gu) || [])].slice(
    0,
    limit,
  );

// Offsets address the original record in UTF-16 code units, not the normalized index.
export function memoryChunks(content: string) {
  const chunks: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < content.length; ) {
    let end = Math.min(start + 1400, content.length);
    if (end < content.length) {
      const paragraph = content.lastIndexOf("\n", end);
      if (paragraph > start + 850) end = paragraph + 1;
      if (/[\uD800-\uDBFF]/.test(content[end - 1])) end--;
    }
    chunks.push({ start, end, text: content.slice(start, end) });
    if (end === content.length) break;
    start = end - 160;
    if (/[\uDC00-\uDFFF]/.test(content[start])) start++;
  }
  return chunks;
}
