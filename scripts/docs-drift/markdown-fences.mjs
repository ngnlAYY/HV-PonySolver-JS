// 每份文档独立跟踪围栏；返回 null 表示正文，content 区分代码正文与围栏标记。
export function createMarkdownFenceScanner() {
  let fence = null
  const delimiter = { content: false, language: '' }
  return (line) => {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line)
    if (fence) {
      if (marker && marker[1][0] === fence.character && marker[1].length >= fence.length && marker[2].trim() === '') {
        fence = null
        return delimiter
      }
      return fence
    }
    if (!marker || (marker[1][0] === '`' && marker[2].includes('`'))) return null
    fence = {
      character: marker[1][0],
      length: marker[1].length,
      language: marker[2].trim().split(/\s+/u, 1)[0],
      content: true,
    }
    return delimiter
  }
}
