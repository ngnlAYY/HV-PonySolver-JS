import assert from 'node:assert/strict'
import test from 'node:test'

import { readConstRegexLiteral, readConstStringLiteral, readFunctionBodySource } from '../source-literals.mjs'

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

for (const suffix of [
  '',
  ';',
  '\nconst next = true',
  ' as RegExp',
  ' satisfies RegExp',
  ' as RegExp satisfies RegExp',
]) {
  test(`accepts a complete regex initializer with type-only suffix: ${JSON.stringify(suffix)}`, () => {
    const literal = '/^Bearer\\s+([^\\s]+)$/i'
    assert.equal(readConstRegexLiteral(`const PATTERN = ${literal}${suffix}`, 'PATTERN'), literal)
  })
}

for (const suffix of [
  ' && /^Token\\s+([^\\s]+)$/i',
  '.compile("^Token")',
  ' ? /^Token/ : /^Other/',
  '\n  && /^Token/',
  ' as RegExp && /^Token/',
  ' satisfies RegExp && /^Token/',
  ' satisfies',
]) {
  test(`rejects a regex prefix of a runtime initializer: ${JSON.stringify(suffix)}`, () => {
    assert.equal(readConstRegexLiteral(`const PATTERN = /^Bearer\\s+([^\\s]+)$/i${suffix}`, 'PATTERN'), null)
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
