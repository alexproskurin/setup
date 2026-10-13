import { expect, test } from 'claude-code/testing'

const whoami = { exitCode: 0, stdout: 'alex\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// What the engine stamps on a command typed at the prompt
const typed = (args: string) => ({
  command: 'hello',
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 120 },
})

test('/hello greets the name given', async ($, on) => {
  on('process.run', () => ({ value: whoami }))

  const { text } = await $.command.run(typed('Sam'))

  expect(text).toBe('Hello, Sam! (running as alex)')
})

test('/hello falls back to the OS user', async ($, on) => {
  on('process.run', () => ({ value: whoami }))

  const { text } = await $.command.run(typed(''))

  expect(text).toBe('Hello, alex! (running as alex)')
})
