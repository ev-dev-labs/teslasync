/**
 * Child-process output collection for the locale perf gates.
 *
 * Lives under `src/i18n/` rather than `scripts/` so vitest (which only
 * collects `src/**` specs) can cover it directly.
 *
 * The distinction this module exists for: Node emits `exit` as soon as the
 * child process terminates, but the parent's stdio pipes may still hold
 * buffered data at that moment. Only `close` is guaranteed to fire after every
 * stdio stream has been closed. A gate that parses stdout captured up to
 * `exit` can therefore read a truncated report — silently passing a locality
 * check whose violating line had not been flushed yet, or failing one because
 * a route line never arrived.
 */

/**
 * Resolves once the child has exited *and* its stdio pipes have drained.
 *
 * @param {import('node:child_process').ChildProcess} child
 * @param {{ onStdout?: (chunk: Buffer) => void, onStderr?: (chunk: Buffer) => void }} [handlers]
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, output: string }>}
 */
export function collectProcessOutput(child, handlers = {}) {
  return new Promise((resolve, reject) => {
    let output = ''
    let exitCode = null
    let exitSignal = null

    const append = (chunk, forward) => {
      output += chunk.toString()
      forward?.(chunk)
    }
    child.stdout?.on('data', (chunk) => append(chunk, handlers.onStdout))
    child.stderr?.on('data', (chunk) => append(chunk, handlers.onStderr))
    child.once('error', reject)
    // `exit` only tells us the process is gone; the pipes may still be draining.
    child.once('exit', (code, signal) => {
      exitCode = code
      exitSignal = signal
    })
    child.once('close', (code, signal) => {
      resolve({ code: code ?? exitCode, signal: signal ?? exitSignal, output })
    })
  })
}
