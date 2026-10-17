#!/usr/bin/env bun
// Greets the name given (or the OS user). The one piece of code every harness runs.
import { userInfo } from 'node:os'

const user = userInfo().username
const name = process.argv.slice(2).join(' ').trim() || user

console.log(`Hello, ${name}! (running as ${user})`)
