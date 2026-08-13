function readQuotedValue(source, property) {
  const match = source.match(new RegExp(`${property}:\\s*'([^']+)'`))
  return match?.[1] ?? null
}

export function checkExtensionDocs(extensionPackageJson, buildSource, readme, extensionDoc) {
  const errors = []
  const chromeMinimum = readQuotedValue(buildSource, 'minimum_chrome_version')
  const firefoxMinimum = readQuotedValue(buildSource, 'strict_min_version')
  if (!chromeMinimum) errors.push('extension build minimum_chrome_version is unreadable')
  if (!firefoxMinimum) errors.push('extension build strict_min_version is unreadable')

  const requiredScripts = [
    'build',
    'build:packaged',
    'lint:firefox',
    'test:e2e:content',
    'test:e2e:chromium',
    'test:e2e:packaged',
  ]
  for (const script of requiredScripts) {
    if (typeof extensionPackageJson.scripts?.[script] !== 'string') {
      errors.push(`apps/extension/package.json scripts.${script} is missing`)
    }
    if (!readme.includes(script) && !extensionDoc.includes(script)) {
      errors.push(`extension documentation must mention ${script}`)
    }
  }

  for (const [label, value] of [
    ['Chromium minimum version', chromeMinimum],
    ['Firefox minimum version', firefoxMinimum],
  ]) {
    const displayValue = value?.endsWith('.0') ? value.slice(0, -2) : value
    if (value && !readme.includes(value) && !extensionDoc.includes(value) && !readme.includes(displayValue) && !extensionDoc.includes(displayValue)) {
      errors.push(`extension documentation omits ${label} ${value}`)
    }
  }

  const requiredFacts = [
    'apps/extension/dist/chromium',
    'apps/extension/dist/firefox',
    'authenticationInfo',
    '`none`',
    'storage.local',
    'IndexedDB',
    '--model-mode packaged',
    'model/yolo26n-640.ort',
    'hv-pony-solver-chromium-packaged-<version>.zip',
    'hv-pony-solver-firefox-packaged-<version>.zip',
    'modelDelivery',
    '当前版本已内置模型，无需配置模型 Key。',
    'offscreen',
    'ArrayBuffer',
    'Base64',
    '不要在同一浏览器配置中同时启用用户脚本版和扩展版',
  ]
  const combinedDocs = `${readme}\n${extensionDoc}`
  for (const fact of requiredFacts) {
    if (!combinedDocs.includes(fact)) {
      errors.push(`extension documentation omits ${fact}`)
    }
  }

  return errors
}
