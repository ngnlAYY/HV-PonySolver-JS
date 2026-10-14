import assert from 'node:assert/strict'
import test from 'node:test'

import { readConstStringLiteral, readFunctionBodySource } from '../source-literals.mjs'

for (const expression of [
  "'no-store' as const",
  "'no-store' satisfies string",
  "'no-store' as const satisfies string",
  "'no-store' satisfies ('no-store' | 'private')",
  "'no-store' satisfies string & {}",
]) {
  test(`accepts a type-only literal initializer: ${expression}`, () => {
    assert.equal(readConstStringLiteral(`const CACHE_CONTROL = ${expression}`, 'CACHE_CONTROL'), 'no-store')
  })
}

for (const expression of [
  "'no-store' satisfies string + ', max-age=86400'",
  "'no-store' as const satisfies string + ', max-age=86400'",
  "'no-store' satisfies string && 'public'",
  "'no-store' satisfies string === 'no-store' ? 'public' : 'private'",
  "'no-store' satisfies string\n  + ', max-age=86400'",
  "'no-store' satisfies",
]) {
  test(`rejects a non-literal initializer after type syntax: ${expression}`, () => {
    assert.equal(readConstStringLiteral(`const CACHE_CONTROL = ${expression}`, 'CACHE_CONTROL'), null)
  })
}

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
