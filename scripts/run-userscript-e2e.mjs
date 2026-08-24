import { spawn } from 'node:child_process'

const allowedForwardedArgs = new Set(['--list'])
const forwardedArgs = process.argv.slice(2)
if (forwardedArgs[0] === '--') {
  forwardedArgs.shift()
}

const rejectedArg = forwardedArgs.find((arg) => !allowedForwardedArgs.has(arg))
if (rejectedArg) {
  process.stderr.write(`Unsupported userscript E2E argument: ${rejectedArg}\n`)
  process.stderr.write('Allowed arguments: --list\n')
  process.exitCode = 1
} else {
  const corepackCommand = process.platform === 'win32' ? 'corepack.cmd' : 'corepack'
  const child = spawn(
    corepackCommand,
    ['pnpm', '--filter', '@hv-pony-solver/userscript', 'test:e2e', ...forwardedArgs],
    { stdio: 'inherit' },
  )

  child.on('error', (error) => {
    process.stderr.write(`Failed to start ${corepackCommand}: ${error.message}\n`)
    process.exitCode = 1
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exitCode = code ?? 1
  })
}
