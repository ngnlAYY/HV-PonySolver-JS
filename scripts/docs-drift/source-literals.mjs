import {
  findMatchingBrace,
  findMatchingParen,
  identifierAt,
  isIdentifierPart,
  readRegexLiteralEnd,
  skipIgnoredComment,
  skipIgnoredSyntaxAndRegexLiteral,
  skipWhitespaceAndComments,
} from './source-syntax.mjs'

function readConstStringLiteral(source, constantName) {
  const valueStart = readTopLevelConstValueStart(source, constantName)
  if (valueStart === -1) {
    return null
  }
  const parsed = parseStringLiteral(source, valueStart)
  if (!parsed || !hasConstLiteralTerminator(source, parsed.end)) {
    return null
  }
  return parsed.value
}

function hasConstLiteralTerminator(source, literalEnd) {
  const suffixStart = readConstLiteralBoundary(source, literalEnd)
  if (suffixStart.char === undefined || suffixStart.char === ';' || suffixStart.char === ',') {
    return true
  }
  if (suffixStart.hasLineBreak && isStatementStart(source, suffixStart.index)) {
    return true
  }

  const suffixEnd = skipTypeScriptConstSuffix(source, suffixStart.index)
  if (suffixEnd === suffixStart.index) {
    return false
  }
  const boundary = readConstLiteralBoundary(source, suffixEnd)
  if (boundary.char === undefined || boundary.char === ';' || boundary.char === ',') {
    return true
  }
  return boundary.hasLineBreak && isStatementStart(source, boundary.index)
}

function readConstLiteralBoundary(source, startIndex) {
  let index = startIndex
  let hasLineBreak = false
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      hasLineBreak ||= source[index] === '\n' || source[index] === '\r'
      index += 1
      continue
    }
    const skipped = skipIgnoredComment(source, index)
    if (skipped === index) {
      break
    }
    hasLineBreak ||= source.slice(index, skipped).includes('\n') || skipped === source.length
    index = skipped
  }
  return { char: source[index], hasLineBreak, index }
}

function isStatementStart(source, index) {
  return identifierAt(source, index, 'export')
    || identifierAt(source, index, 'import')
    || identifierAt(source, index, 'const')
    || identifierAt(source, index, 'let')
    || identifierAt(source, index, 'var')
    || identifierAt(source, index, 'function')
    || identifierAt(source, index, 'type')
    || identifierAt(source, index, 'interface')
    || source[index] === '}'
}

function skipTypeScriptConstSuffix(source, startIndex) {
  let index = startIndex
  const firstSuffixEnd = skipSingleTypeScriptConstSuffix(source, index)
  if (firstSuffixEnd === index) {
    return startIndex
  }
  index = skipWhitespaceAndComments(source, firstSuffixEnd)
  const secondSuffixEnd = skipSingleTypeScriptConstSuffix(source, index)
  return secondSuffixEnd === index ? firstSuffixEnd : secondSuffixEnd
}

function skipSingleTypeScriptConstSuffix(source, startIndex) {
  let index = startIndex
  if (identifierAt(source, index, 'as')) {
    index = skipWhitespaceAndComments(source, index + 'as'.length)
    if (!identifierAt(source, index, 'const')) {
      return startIndex
    }
    return index + 'const'.length
  }
  if (identifierAt(source, index, 'satisfies')) {
    index = skipWhitespaceAndComments(source, index + 'satisfies'.length)
    while (index < source.length && source[index] !== ';' && source[index] !== ',' && source[index] !== '\n' && source[index] !== '\r') {
      const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
      if (skipped !== index) {
        index = skipped
        continue
      }
      index += 1
    }
    return index
  }
  return startIndex
}

function readTopLevelConstValueStart(source, constantName) {
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === '{') {
      depth += 1
      continue
    }
    if (source[index] === '}') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0 || !identifierAt(source, index, 'const')) {
      continue
    }
    const nameStart = skipWhitespaceAndComments(source, index + 'const'.length)
    if (!identifierAt(source, nameStart, constantName)) {
      continue
    }
    const equalsIndex = readConstEqualsIndex(source, nameStart + constantName.length)
    if (equalsIndex !== -1) {
      return skipWhitespaceAndComments(source, equalsIndex + 1)
    }
  }
  return -1
}

function readConstEqualsIndex(source, startIndex) {
  let index = skipWhitespaceAndComments(source, startIndex)
  if (source[index] === ':') {
    index += 1
    while (index < source.length) {
      const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
      if (skipped !== index) {
        index = skipped
        continue
      }
      if (source[index] === '=') {
        return index
      }
      if (source[index] === '\n' || source[index] === '\r' || source[index] === ';') {
        return -1
      }
      index += 1
    }
    return -1
  }
  return source[index] === '=' ? index : -1
}

function extractStringCallArgumentsFromCode(source, callee) {
  const values = []
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!source.startsWith(callee, index)
      || isIdentifierPart(source[index - 1])
      || isIdentifierPart(source[index + callee.length])) {
      continue
    }

    const openParenIndex = skipWhitespaceAndComments(source, index + callee.length)
    if (source[openParenIndex] !== '(') {
      continue
    }
    const argumentStart = skipWhitespaceAndComments(source, openParenIndex + 1)
    const parsed = parseStringLiteral(source, argumentStart)
    if (!parsed) {
      continue
    }
    const argumentEnd = skipWhitespaceAndComments(source, parsed.end)
    if (source[argumentEnd] === ')') {
      values.push(parsed.value)
    }
    index = parsed.end - 1
  }
  return values
}

function readIdentifierToken(source, startIndex) {
  if (!/[A-Za-z_$]/.test(source[startIndex] ?? '')) {
    return null
  }
  let endIndex = startIndex + 1
  while (isIdentifierPart(source[endIndex])) {
    endIndex += 1
  }
  return source.slice(startIndex, endIndex)
}

function readFunctionBodySource(source, functionName) {
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (!identifierAt(source, index, 'function')) {
      continue
    }
    const nameStart = skipWhitespaceAndComments(source, index + 'function'.length)
    if (!identifierAt(source, nameStart, functionName)) {
      continue
    }
    const paramsStart = skipWhitespaceAndComments(source, nameStart + functionName.length)
    if (source[paramsStart] !== '(') {
      continue
    }
    const paramsEnd = findMatchingParen(source, paramsStart)
    if (paramsEnd === -1) {
      return ''
    }
    const bodyStart = skipFunctionReturnType(source, paramsEnd + 1)
    if (source[bodyStart] !== '{') {
      return ''
    }
    const bodyEnd = findMatchingBrace(source, bodyStart)
    return bodyEnd === -1 ? '' : source.slice(bodyStart + 1, bodyEnd)
  }
  return ''
}

function skipFunctionReturnType(source, startIndex) {
  let index = skipWhitespaceAndComments(source, startIndex)
  if (source[index] !== ':') {
    return index
  }
  index += 1
  while (index < source.length) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped
      continue
    }
    if (source[index] === '{') {
      return index
    }
    index += 1
  }
  return index
}

function readConstRegexLiteral(source, constantName) {
  const valueStart = readTopLevelConstValueStart(source, constantName)
  if (valueStart === -1 || source[valueStart] !== '/') {
    return null
  }
  const literalEnd = readRegexLiteralEnd(source, valueStart)
  return literalEnd === valueStart ? null : source.slice(valueStart, literalEnd)
}

function parseStringLiteral(source, valueStart) {
  const quote = source[valueStart]
  if (quote !== '\'' && quote !== '"') {
    return null
  }

  let value = ''
  let isEscaped = false
  for (let index = valueStart + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      value += char
      isEscaped = false
    } else if (char === '\\') {
      value += char
      isEscaped = true
    } else if (char === quote) {
      return { value, end: index + 1 }
    } else if (char === '\n' || char === '\r') {
      return null
    } else {
      value += char
    }
  }
  return null
}

export { extractStringCallArgumentsFromCode, parseStringLiteral, readConstRegexLiteral, readConstStringLiteral, readFunctionBodySource, readIdentifierToken }
