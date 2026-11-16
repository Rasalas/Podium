import { checkPort } from 'get-port-please'

export const DEFAULT_PORT_RANGE: [number, number] = [3400, 3999]

/** Ports handed out in this process and not yet released. Two servers starting at once must not pick the same one. */
const reserved = new Set<number>()

/** Find a free port in the range, trying `preferred` first. The port stays reserved until released. */
export async function reservePort(range: [number, number] = DEFAULT_PORT_RANGE, preferred?: number): Promise<number> {
  const [from, to] = range
  const order: number[] = []
  if (preferred && preferred >= from && preferred <= to)
    order.push(preferred)
  // Start at a random offset so restarts and parallel apps spread out.
  const span = to - from + 1
  const offset = Math.floor(Math.random() * span)
  for (let i = 0; i < span; i++)
    order.push(from + ((offset + i) % span))
  for (const port of order) {
    if (reserved.has(port))
      continue
    reserved.add(port)
    if (await checkPort(port) === port)
      return port
    reserved.delete(port)
  }
  throw new Error(`Kein freier Port zwischen ${from} und ${to}.`)
}

export function releasePort(port: number | undefined): void {
  if (port)
    reserved.delete(port)
}
