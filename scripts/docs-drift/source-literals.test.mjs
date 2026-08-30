import assert from 'node:assert/strict'
import test from 'node:test'

import { readFunctionBodySource } from './source-literals.mjs'

test('reads a function body after an object return type', () => {
  const source = `
function target(value: string): { value: string } {
  const marker = 'object-return-body'
  return { value }
}
`

  const body = readFunctionBodySource(source, 'target')
  assert.match(body, /object-return-body/u)
  assert.doesNotMatch(body, /^\s*value:\s*string\s*$/u)
})

test('reads a generic function body when its constraint contains an object type', () => {
  const source = `
export function target<T extends { value: string }>(value: T): T {
  const marker = 'generic-body'
  return value
}
`

  assert.match(readFunctionBodySource(source, 'target'), /generic-body/u)
})

test('skips bodyless overload declarations and reads the implementation body', () => {
  const source = `
function target(value: string): string
function target(value: number): number
function target(value: string | number) {
  const marker = 'implementation-body'
  return value
}
`

  assert.match(readFunctionBodySource(source, 'target'), /implementation-body/u)
})
