function stripIgnoredSyntax(source) {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      result += source.slice(index, skipped).replace(/[^\r\n]/g, ' ')
      index = skipped - 1
      continue
    }
    result += source[index]
  }
  return result
}

function stripDeadFalseBranches(source) {
  let result = ''
  for (let index = 0; index < source.length; index += 1) {
    const stripped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (stripped !== index) {
      result += source.slice(index, stripped)
      index = stripped - 1
      continue
    }
    if (source.startsWith('if', index) && !isIdentifierPart(source[index - 1]) && !isIdentifierPart(source[index + 2])) {
      const conditionStart = skipWhitespaceAndComments(source, index + 2)
      if (source[conditionStart] === '(') {
        const conditionEnd = findMatchingParen(source, conditionStart)
        if (conditionEnd !== -1 && stripIgnoredSyntax(source.slice(conditionStart + 1, conditionEnd)).trim() === 'false') {
          const bodyStart = skipWhitespaceAndComments(source, conditionEnd + 1)
          if (source[bodyStart] === '{') {
            const bodyEnd = findMatchingBrace(source, bodyStart)
            if (bodyEnd !== -1) {
              result += source.slice(index, bodyEnd + 1).replace(/[^\r\n]/g, ' ')
              index = bodyEnd
              continue
            }
          }
        }
      }
    }
    result += source[index]
  }
  return result
}

function findMatchingParen(source, openParenIndex) {
  return findMatchingDelimitedToken(source, openParenIndex, '(', ')')
}

function findMatchingBrace(source, openBraceIndex) {
  return findMatchingDelimitedToken(source, openBraceIndex, '{', '}')
}

function findMatchingDelimitedToken(source, openIndex, openToken, closeToken) {
  let depth = 0
  for (let index = openIndex; index < source.length; index += 1) {
    const skipped = skipIgnoredSyntaxAndRegexLiteral(source, index)
    if (skipped !== index) {
      index = skipped - 1
      continue
    }
    if (source[index] === openToken) {
      depth += 1
      continue
    }
    if (source[index] === closeToken) {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return -1
}

function readRegexLiteralEnd(source, startIndex) {
  let isEscaped = false
  let isInCharacterClass = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === '[') {
      isInCharacterClass = true
    } else if (char === ']') {
      isInCharacterClass = false
    } else if (char === '/' && !isInCharacterClass) {
      let endIndex = index + 1
      while (/[A-Za-z]/.test(source[endIndex] ?? '')) {
        endIndex += 1
      }
      return endIndex
    } else if (char === '\n' || char === '\r') {
      return startIndex
    }
  }
  return startIndex
}

function skipIgnoredSyntaxAndRegexLiteral(source, index) {
  const skipped = skipIgnoredSyntax(source, index)
  if (skipped !== index) {
    return skipped
  }
  return source[index] === '/' ? readRegexLiteralEnd(source, index) : index
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
  if (char === '\'' || char === '"') {
    return skipStringLiteral(source, index)
  }
  if (char === '`') {
    return skipTemplateLiteral(source, index)
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

function skipStringLiteral(source, startIndex) {
  const quote = source[startIndex]
  let isEscaped = false
  for (let index = startIndex + 1; index < source.length; index += 1) {
    const char = source[index]
    if (isEscaped) {
      isEscaped = false
    } else if (char === '\\') {
      isEscaped = true
    } else if (char === quote) {
      return index + 1
    } else if (char === '\n' || char === '\r') {
      return source.length
    }
  }
  return source.length
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

function identifierAt(source, index, identifier) {
  return source.startsWith(identifier, index)
    && !isIdentifierPart(source[index - 1])
    && !isIdentifierPart(source[index + identifier.length])
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_$]/.test(char ?? '')
}

export {
  findMatchingBrace,
  findMatchingParen,
  identifierAt,
  isIdentifierPart,
  readRegexLiteralEnd,
  skipIgnoredComment,
  skipIgnoredSyntax,
  skipIgnoredSyntaxAndRegexLiteral,
  skipTemplateLiteral,
  skipWhitespaceAndComments,
  stripDeadFalseBranches,
  stripIgnoredSyntax,
}
