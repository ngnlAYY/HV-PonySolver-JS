import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const optionsHtml = readFileSync(resolve(process.cwd(), 'public/options.html'), 'utf8')

export function installOptionsPageMarkup(): void {
  const parsed = new DOMParser().parseFromString(optionsHtml, 'text/html')
  document.body.innerHTML = parsed.body.innerHTML
}

export function optionsElement<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) {
    throw new Error(`Missing options test element: ${id}`)
  }
  return found as T
}
