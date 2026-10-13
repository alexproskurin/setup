import type { Register } from 'claude-code'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'hello', description: 'Say hello from a mod' })

    return next(e)
  })

  // Runs as code, not a prompt: nothing here reaches the model.
  on('command.run', { command: 'hello' }, async ($, e) => {
    const { exitCode, stdout } = await $.process.run(['whoami'])
    const user = exitCode === 0 ? stdout.trim() : 'there'
    const name = e.args.trim() || user

    return { text: `Hello, ${name}! (running as ${user})` }
  })
}
