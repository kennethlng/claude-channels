export type LogFn = (msg: string, fields?: Record<string, unknown>) => void
export interface Logger {
  info: LogFn
  warn: LogFn
  error: LogFn
}

export function createLogger(
  secrets: string[],
  stream: NodeJS.WritableStream = process.stderr,
): Logger {
  const active = secrets.filter((s) => s.length > 0)
  const redact = (line: string) =>
    active.reduce((acc, secret) => acc.split(secret).join('[REDACTED]'), line)
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    stream.write(redact(JSON.stringify({ level, msg, ...fields })) + '\n')
  }
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  }
}
