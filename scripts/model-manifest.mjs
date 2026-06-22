import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const defaultManifestRelativePath = 'packages/shared/src/model.ts'

function parseByteLength(value, sourcePath) {
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(value)) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength in ${sourcePath}: ${value}`)
  }
  const parsedValue = Number(value.replaceAll('_', ''))
  if (!Number.isSafeInteger(parsedValue)) {
    throw new Error(`Invalid MODEL_INTEGRITY.byteLength in ${sourcePath}: ${value}`)
  }
  return parsedValue
}

function parseModelManifest(modelSource, options = {}) {
  const sourcePath = options.sourcePath ?? defaultManifestRelativePath
  const requireVersion = options.requireVersion ?? true
  const versionStart = findAssignmentValueStart(modelSource, 'MODEL_VERSION')
  const integritySource = readObjectAssignmentSource(modelSource, 'MODEL_INTEGRITY', sourcePath)
  if (versionStart === -2) {
    throw new Error(`Duplicate MODEL_VERSION in ${sourcePath}`)
  }
  const version = versionStart === -1 ? null : parseAssignedString(modelSource, versionStart, 'MODEL_VERSION', sourcePath)
  const byteLength = integritySource === null ? null : parseNumberProperty(
    integritySource,
    'byteLength',
    'MODEL_INTEGRITY.byteLength',
    sourcePath,
  )
  const sha256 = integritySource === null ? null : parseStringProperty(
    integritySource,
    'sha256',
    'MODEL_INTEGRITY.sha256',
    sourcePath,
  )

  if (requireVersion && !version) {
    throw new Error(`Unable to read MODEL_VERSION from ${sourcePath}`)
  }
  if (!byteLength) {
    throw new Error(`Unable to read MODEL_INTEGRITY.byteLength from ${sourcePath}`)
  }
  if (!sha256) {
    throw new Error(`Unable to read MODEL_INTEGRITY.sha256 from ${sourcePath}`)
  }
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) {
    throw new Error(`Invalid MODEL_INTEGRITY.sha256 in ${sourcePath}: ${sha256}`)
  }

  return {
    version,
    byteLength: parseByteLength(byteLength, sourcePath),
    sha256: sha256.toLowerCase(),
  }
}

function readObjectAssignmentSource(source, name, sourcePath) {
  const objectStart = findAssignmentValueStart(source, name)
  if (objectStart === -2) {
    throw new Error(`Duplicate ${name} in ${sourcePath}`)
  }
  if (objectStart === -1 || source[objectStart] !== '{') {
    return null
  }
  const objectEnd = findMatchingBrace(source, objectStart)
  return objectEnd === -1 ? null : source.slice(objectStart, objectEnd + 1)
}

function findAssignmentValueStart(source, name) {
  const matches = []
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }

    const nameStart = readDeclarationNameStart(source, index)
    if (nameStart === -1 || !identifierAt(source, nameStart, name)) {
      continue
    }

    const equalsIndex = skipWhitespaceAndComments(source, nameStart + name.length)
    if (source[equalsIndex] === '=') {
      matches.push(skipWhitespaceAndComments(source, equalsIndex + 1))
    }
    index = nameStart + name.length - 1
  }
  if (matches.length > 1) {
    return -2
  }
  return matches[0] ?? -1
}

function readDeclarationNameStart(source, index) {
  let declarationStart = index
  if (identifierAt(source, index, 'export')) {
    declarationStart = skipWhitespaceAndComments(source, index + 'export'.length)
  }

  for (const keyword of ['const', 'let', 'var']) {
    if (identifierAt(source, declarationStart, keyword)) {
      return skipWhitespaceAndComments(source, declarationStart + keyword.length)
    }
  }
  return -1
}

function findMatchingBrace(source, objectStart) {
  let depth = 0
  for (let index = objectStart; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return -1
}

function parseAssignedString(source, valueStart, displayName, sourcePath) {
  const parsed = parseStringLiteral(source, valueStart)
  if (!parsed?.value) {
    throw new Error(`Unable to read ${displayName} from ${sourcePath}`)
  }
  assertAssignmentTerminator(source, parsed.end, displayName, sourcePath)
  return parsed.value
}

function parseStringProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const parsed = parseStringLiteral(source, match.valueStart)
  if (!parsed?.value) {
    throw new Error(`Unable to read ${displayName} from ${sourcePath}`)
  }
  assertPropertyTerminator(source, parsed.end, displayName, sourcePath)
  return parsed.value
}

function parseNumberProperty(source, propertyName, displayName, sourcePath) {
  const match = readSinglePropertyMatch(source, propertyName, displayName, sourcePath)
  const tokenEnd = readNumberTokenEnd(source, match.valueStart)
  const token = source.slice(match.valueStart, tokenEnd)
  if (!token) {
    throw new Error(`Unable to read ${displayName} from ${sourcePath}`)
  }
  if (!/^[0-9]+(?:_[0-9]+)*$/.test(token)) {
    throw new Error(`Invalid ${displayName} in ${sourcePath}: ${token}`)
  }
  assertPropertyTerminator(source, tokenEnd, displayName, sourcePath)
  return token
}

function readSinglePropertyMatch(source, propertyName, displayName, sourcePath) {
  const matches = findDirectPropertyMatches(source, propertyName)
  if (matches.length === 0) {
    throw new Error(`Unable to read ${displayName} from ${sourcePath}`)
  }
  if (matches.length > 1) {
    throw new Error(`Duplicate ${displayName} in ${sourcePath}`)
  }
  return matches[0]
}

function findDirectPropertyMatches(source, propertyName) {
  const matches = []
  let depth = 0
  for (let index = 0; index < source.length; index += 1) {
    const commentEnd = skipIgnoredComment(source, index)
    if (commentEnd !== index) {
      index = commentEnd - 1
      continue
    }

    const char = source[index]
    if (char === '\'' || char === '"') {
      const parsed = parseStringLiteral(source, index)
      if (!parsed) {
        return matches
      }
      if (depth === 1) {
        const colonIndex = skipWhitespaceAndComments(source, parsed.end)
        if (source[colonIndex] === ':' && parsed.value === propertyName) {
          matches.push({ valueStart: skipWhitespaceAndComments(source, colonIndex + 1) })
        }
      }
      index = parsed.end - 1
      continue
    }
    if (char === '`') {
      index = skipQuotedLiteral(source, index) - 1
      continue
    }
    if (char === '{') {
      depth += 1
      continue
    }
    if (char === '}') {
      depth -= 1
      continue
    }
    if (depth !== 1) {
      continue
    }

    if (identifierAt(source, index, propertyName)) {
      const colonIndex = skipWhitespaceAndComments(source, index + propertyName.length)
      if (source[colonIndex] === ':') {
        matches.push({ valueStart: skipWhitespaceAndComments(source, colonIndex + 1) })
      }
    }
  }
  return matches
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

function readNumberTokenEnd(source, valueStart) {
  let index = valueStart
  while (/[0-9_]/.test(source[index] ?? '')) {
    index += 1
  }
  return index
}

function assertPropertyTerminator(source, valueEnd, displayName, sourcePath) {
  const terminator = source[skipWhitespaceAndComments(source, valueEnd)]
  if (terminator !== ',' && terminator !== '}') {
    throw new Error(`Invalid ${displayName} in ${sourcePath}: unexpected token after literal value`)
  }
}

function assertAssignmentTerminator(source, valueEnd, displayName, sourcePath) {
  const boundary = readAssignmentBoundary(source, valueEnd)
  if (boundary.char === undefined || boundary.char === ';') {
    return
  }
  if (boundary.hasLineBreak && isAssignmentStatementStart(source, boundary.index)) {
    return
  }
  throw new Error(`Invalid ${displayName} in ${sourcePath}: unexpected token after literal value`)
}

function readAssignmentBoundary(source, valueEnd) {
  let index = valueEnd
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

function isAssignmentStatementStart(source, index) {
  return identifierAt(source, index, 'export')
    || identifierAt(source, index, 'const')
    || identifierAt(source, index, 'let')
    || identifierAt(source, index, 'var')
}

function skipIgnoredSyntax(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  if (char === '\'' || char === '"' || char === '`') {
    return skipQuotedLiteral(source, index)
  }
  return index
}

function skipWhitespaceAndComments(source, startIndex) {
  let index = startIndex
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1
      continue
    }
    const skipped = skipIgnoredComment(source, index)
    if (skipped === index) {
      return index
    }
    index = skipped
  }
  return index
}

function skipIgnoredComment(source, index) {
  const char = source[index]
  const nextChar = source[index + 1]
  if (char === '/' && nextChar === '/') {
    return skipLineComment(source, index)
  }
  if (char === '/' && nextChar === '*') {
    return skipBlockComment(source, index)
  }
  return index
}

function skipLineComment(source, startIndex) {
  const endIndex = source.indexOf('\n', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 1
}

function skipBlockComment(source, startIndex) {
  const endIndex = source.indexOf('*/', startIndex + 2)
  return endIndex === -1 ? source.length : endIndex + 2
}

function skipQuotedLiteral(source, startIndex) {
  const quote = source[startIndex]
  if (quote === '`') {
    return skipTemplateLiteral(source, startIndex)
  }
  return skipUntilUnescaped(source, startIndex, quote)
}

function skipTemplateLiteral(source, startIndex) {
  let isEscaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === '`') {
      return index + 1
    } else if (char === '$' && source[index + 1] === '{') {
      index = skipTemplateExpression(source, index + 2) - 1
    }
  }
  return source.length
}

function skipTemplateExpression(source, startIndex) {
  let depth = 1
  for (let index = startIndex; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntax(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === '{') {
      depth += 1
    } else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) {
        return index + 1
      }
    }
  }
  return source.length
}

function skipUntilUnescaped(source, startIndex, endChar) {
  let isEscaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    if (isEscaped) {
      isEscaped = false
    } else if (source[index] === '\\') {
      isEscaped = true
    } else if (source[index] === endChar) {
      return index + 1
    }
  }
  return source.length
}

function identifierAt(source, index, identifier) {
  return source.startsWith(identifier, index)
    && !isIdentifierPart(source[index - 1])
    && !isIdentifierPart(source[index + identifier.length])
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char ?? '')
}

async function readModelManifest(repoRoot, options = {}) {
  const relativePath = options.relativePath ?? defaultManifestRelativePath
  const manifestPath = resolve(repoRoot, relativePath)
  const source = await readFile(manifestPath, 'utf8')
  return parseModelManifest(source, {
    requireVersion: options.requireVersion,
    sourcePath: manifestPath,
  })
}

export { parseModelManifest, readModelManifest }
