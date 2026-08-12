const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch)
}
