function checkRootCheckCommand(rootPackageJson, readme) {
  const checkCommand = rootPackageJson.scripts?.check
  if (typeof checkCommand !== 'string') {
    return ['package.json scripts.check is missing']
  }

  const errors = []
  for (const commandName of ['check:quick', 'test:coverage', 'build']) {
    if (checkCommand.includes(commandName) && !commandDescriptionMentions(readme, 'pnpm check', commandName)) {
      errors.push(`README.md pnpm check description must mention ${commandName} because package.json scripts.check runs it`)
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
  for (const commandName of ['lint', 'typecheck', 'test', 'docs:check', 'graphify:check', 'architecture:check']) {
    if (quickCheckCommand.includes(commandName) && !commandDescriptionMentions(readme, 'pnpm check:quick', commandName)) {
      errors.push(`README.md pnpm check:quick description must mention ${commandName} because package.json scripts.check:quick runs it`)
    }
  }
  return errors
}

function commandDescriptionMentions(readme, command, required) {
  const escapedCommand = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const commandRowPattern = new RegExp(`^\\|\\s*\`${escapedCommand}\`\\s*\\|(?<description>.*)\\|\\s*$`, 'm')
  const description = commandRowPattern.exec(readme)?.groups?.description
  return description?.includes(required) ?? false
}

export { checkRootCheckCommand }
