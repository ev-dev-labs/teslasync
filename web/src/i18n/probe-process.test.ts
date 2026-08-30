import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - shared process helper authored as ESM JavaScript
import { collectProcessOutput } from './probe-process.mjs'

interface FakeChild extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('collectProcessOutput', () => {
  it('keeps collecting stdio emitted after the process has already exited', async () => {
    const child = fakeChild()
    const pending = collectProcessOutput(child)

    child.stdout.emit('data', Buffer.from('[i18n-runtime] cold NotFound: 0 deferred'))
    // Node fires `exit` as soon as the process is gone; the pipes may still be
    // draining. Anything a gate parses at this point can be a partial report.
    child.emit('exit', 0, null)
    child.stdout.emit('data', Buffer.from(' locale requests\n'))
    child.stderr.emit('data', Buffer.from('trailing stderr\n'))
    child.emit('close', 0, null)

    await expect(pending).resolves.toEqual({
      code: 0,
      signal: null,
      output: '[i18n-runtime] cold NotFound: 0 deferred locale requests\ntrailing stderr\n',
    })
  })

  it('does not resolve on exit alone', async () => {
    const child = fakeChild()
    let settled = false
    const pending = collectProcessOutput(child).then((value) => {
      settled = true
      return value
    })

    child.emit('exit', 1, null)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    child.emit('close', 1, null)
    await expect(pending).resolves.toMatchObject({ code: 1 })
  })

  it('falls back to the exit code when close reports none', async () => {
    const child = fakeChild()
    const pending = collectProcessOutput(child)
    child.emit('exit', 3, null)
    child.emit('close', null, null)
    await expect(pending).resolves.toMatchObject({ code: 3 })
  })

  it('rejects when the child fails to spawn', async () => {
    const child = fakeChild()
    const pending = collectProcessOutput(child)
    child.emit('error', new Error('spawn ENOENT'))
    await expect(pending).rejects.toThrow('spawn ENOENT')
  })

  it('captures a full report from a real child process without truncation', async () => {
    const line = '[i18n-runtime] Drives: 1 deferred locale requests (locale-driving-Aa11Bb22.js)'
    const script = `const l=${JSON.stringify(line)};for(let i=0;i<20000;i+=1)process.stdout.write(l+"\\n")`
    const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe'] })

    const { code, output } = await collectProcessOutput(child)

    expect(code).toBe(0)
    expect(output.split('\n').filter(Boolean)).toHaveLength(20000)
    expect(output.endsWith(`${line}\n`)).toBe(true)
  })

  it('forwards chunks to the caller as they arrive', async () => {
    const child = fakeChild()
    const stdout: string[] = []
    const stderr: string[] = []
    const pending = collectProcessOutput(child, {
      onStdout: (chunk: Buffer) => stdout.push(chunk.toString()),
      onStderr: (chunk: Buffer) => stderr.push(chunk.toString()),
    })

    child.stdout.emit('data', Buffer.from('out'))
    child.stderr.emit('data', Buffer.from('err'))
    child.emit('close', 0, null)

    await pending
    expect(stdout).toEqual(['out'])
    expect(stderr).toEqual(['err'])
  })
})
