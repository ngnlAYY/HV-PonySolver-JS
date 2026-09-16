function checkRootCheckCommand(rootPackageJson, workspacePackageJsons, readme) {
  const checkCommand = rootPackageJson.scripts?.check
  if (typeof checkCommand !== 'string') {
    return ['package.json scripts.check is missing']
  }

  const errors = []
  const readmeLines = readme.split(/\r?\n/)
  for (const required of [
    'mise.toml',
    'mise install',
    'mise exec -- pnpm install --frozen-lockfile',
    'mise exec -- pnpm check',
  ]) {
    if (!readme.includes(required)) {
      errors.push(`docs/development/commands.md mise setup must document ${required}`)
    }
  }
  const nodeVersion =
    typeof rootPackageJson.engines?.node === 'string'
      ? rootPackageJson.engines.node.match(/\d+\.\d+\.\d+/u)?.[0]
      : undefined
  const pnpmVersion =
    typeof rootPackageJson.packageManager === 'string'
      ? /^pnpm@(?<version>\d+\.\d+\.\d+)$/u.exec(rootPackageJson.packageManager)?.groups?.version
      : undefined
  const nodeRequirementRow = readmeLines.find((line) => /^\|\s*Node\.js\s*\|/u.test(line)) ?? ''
  const pnpmRequirementRow = readmeLines.find((line) => /^\|\s*pnpm\s*\|/u.test(line)) ?? ''
  if (nodeVersion && !nodeRequirementRow.includes(nodeVersion)) {
    errors.push(
      `docs/development/commands.md Node requirement must mention ${nodeVersion} from package.json engines.node`,
    )
  }
  if (pnpmVersion && !pnpmRequirementRow.includes(pnpmVersion)) {
    errors.push(
      `docs/development/commands.md pnpm requirement must mention ${pnpmVersion} from package.json packageManager`,
    )
  }
  errors.push(...checkDocumentedPnpmCommands(rootPackageJson, workspacePackageJsons, readmeLines))
  for (const commandName of ['check:quick', 'test:coverage', 'build']) {
    if (checkCommand.includes(commandName) && !commandDescriptionMentions(readme, 'pnpm check', commandName)) {
      errors.push(
        `docs/development/commands.md pnpm check description must mention ${commandName} because package.json scripts.check runs it`,
      )
    }
  }

  const quickCheckCommand = rootPackageJson.scripts?.['check:quick']
  if (checkCommand.includes('check:quick') && typeof quickCheckCommand !== 'string') {
    errors.push('package.json scripts.check:quick is missing because package.json scripts.check runs it')
    return errors
  }
  if (typeof quickCheckCommand !== 'string') {
    return errors
  }
  for (const commandName of [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'docs:check',
    'architecture:check',
    'browser-sinks:check',
    'extension:package-check',
    'bundle:check',
  ]) {
    if (
      quickCheckCommand.includes(commandName) &&
      !commandDescriptionMentions(readme, 'pnpm check:quick', commandName)
    ) {
      errors.push(
        `docs/development/commands.md pnpm check:quick description must mention ${commandName} because package.json scripts.check:quick runs it`,
      )
    }
  }
  return errors
}

function checkDocumentedPnpmCommands(rootPackageJson, workspacePackageJsons, readmeLines) {
  const errors = []
  for (const line of readmeLines) {
    const command = /^\|\s*`pnpm\s+(?<arguments>[^`]+)`\s*\|/u.exec(line)?.groups?.arguments.trim()
    if (!command) continue
    const tokens = command.split(/\s+/u)
    if (tokens[0] === '--filter') {
      const packageName = tokens[1]
      const commandName = tokens[2]
      const packageJson = workspacePackageJsons.find((candidate) => candidate.name === packageName)
      if (!packageJson) {
        errors.push(
          `docs/development/commands.md documents unknown pnpm workspace filter ${packageName ?? '<missing>'}`,
        )
      } else if (!commandName || typeof packageJson.scripts?.[commandName] !== 'string') {
        errors.push(
          `docs/development/commands.md documents pnpm --filter ${packageName} ${commandName ?? '<missing>'}, but ${packageName} scripts.${commandName ?? '<missing>'} is missing`,
        )
      }
      continue
    }

    const commandName = tokens[0]
    if (typeof rootPackageJson.scripts?.[commandName] !== 'string') {
      errors.push(
        `docs/development/commands.md documents pnpm ${commandName}, but package.json scripts.${commandName} is missing`,
      )
    }
  }
  return errors
}

function commandDescriptionMentions(readme, command, required) {
  const commandRowPattern = /^\|\s*`([^`]*)`\s*\|/
  for (const line of readme.split(/\r?\n/u)) {
    const match = commandRowPattern.exec(line)
    if (match?.[1] === command) return line.slice(match[0].length).includes(required)
  }
  return false
}

// Check copyable commands in both inline code and shell fences, without executing examples.
function checkCommandExamples(rootPackageJson, workspacePackageJsons, source, label) {
  const snippets = []
  let fence = null
  for (const line of source.split(/\r?\n/u)) {
    const marker = /^\s*(`{3,}|~{3,})(\w*)/u.exec(line)
    if (marker) {
      fence = fence ? null : { shell: ['bash', 'sh', 'shell', 'zsh'].includes(marker[2]) }
      continue
    }
    if (fence?.shell) snippets.push(line.trim())
    else if (!fence) for (const match of line.matchAll(/`([^`\n]+)`/gu)) snippets.push(match[1])
  }
  const errors = []
  const builtins = new Set(['install', 'exec', 'audit', 'store', 'dlx', '--version', '--help'])
  for (const snippet of snippets) {
    const command = /^(?:mise exec -- )?pnpm\s+(.+)$/u.exec(snippet)?.[1]
    if (!command) continue
    const tokens = command.trim().split(/\s+/u)
    if (tokens[0] === '...') continue
    let packages = [rootPackageJson]
    if (tokens[0] === '--filter') {
      const name = tokens[1]
      packages = workspacePackageJsons.filter((candidate) => candidate.name === name)
      if (!packages.length) {
        errors.push(`${label} documents unknown pnpm workspace filter ${name ?? '<missing>'}`)
        continue
      }
      tokens.splice(0, 2)
    } else if (tokens[0] === '-r' || tokens[0] === '--recursive') {
      packages = workspacePackageJsons
      tokens.shift()
    }
    if (tokens[0] === 'run') tokens.shift()
    const name = tokens[0]
    if (builtins.has(name)) continue
    for (const pkg of packages) {
      if (!name || typeof pkg.scripts?.[name] !== 'string') {
        errors.push(`${label} documents pnpm ${command}, but ${pkg.name} scripts.${name ?? '<missing>'} is missing`)
      }
    }
  }
  return errors
}

export { checkRootCheckCommand, checkCommandExamples }
