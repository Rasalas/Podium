/**
 * Phone remote helpers: which addresses the phone can use, the link and its QR code.
 * Pure functions apart from reading the network interfaces.
 */
import type { NetworkInterfaceInfo } from 'node:os'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { renderSVG } from 'uqr'

/** Password for Slidev's remote mode: 128 random bits, URL-safe. */
export function newRemotePassword(): string {
  return randomBytes(16).toString('base64url')
}

function ipv4ToNumber(address: string): number | undefined {
  const parts = address.split('.')
  if (parts.length !== 4 || parts.some(p => !/^\d{1,3}$/.test(p) || Number(p) > 255))
    return undefined
  return parts.reduce((n, p) => n * 256 + Number(p), 0)
}

function inRange(address: string, base: string, bits: number): boolean {
  const value = ipv4ToNumber(address)
  const start = ipv4ToNumber(base)
  if (value === undefined || start === undefined)
    return false
  const size = 2 ** (32 - bits)
  return Math.floor(value / size) === Math.floor(start / size)
}

export function isTailscaleIPv4(address: string): boolean {
  return inRange(address, '100.64.0.0', 10)
}

export function isPrivateIPv4(address: string): boolean {
  return inRange(address, '10.0.0.0', 8) || inRange(address, '172.16.0.0', 12) || inRange(address, '192.168.0.0', 16)
}

/**
 * Interfaces that are not the physical network: container bridges, VMs, VPN tunnels.
 * Linux, macOS and Windows names. A phone in the Wi-Fi cannot reach these addresses.
 */
const VIRTUAL_INTERFACE = /^(?:docker|br-|veth|virbr|vmnet|vboxnet|vnic|lxc|lxd|incus|cni|flannel|cali|weave|kube|podman|cilium|tun|tap|utun|wg|zt|tailscale|ham|awdl|llw|anpi|ap\d|bridge|gif|stf|vEthernet|VirtualBox|VMware|Hyper-V|Tailscale|ZeroTier|WireGuard|OpenVPN|Loopback)/i

export function isVirtualInterface(name: string): boolean {
  return VIRTUAL_INTERFACE.test(name)
}

/** Name of the interface that carries the default route, on Linux. Undefined elsewhere or when unknown. */
export function defaultRouteInterface(routeTable?: string): string | undefined {
  let text = routeTable
  if (text === undefined) {
    if (process.platform !== 'linux')
      return undefined
    try {
      text = readFileSync('/proc/net/route', 'utf8')
    }
    catch {
      return undefined
    }
  }
  let best: { iface: string, metric: number } | undefined
  for (const line of text.split('\n').slice(1)) {
    const [iface, destination, , , , , metric, mask] = line.trim().split(/\s+/)
    if (!iface || destination !== '00000000' || mask !== '00000000')
      continue
    const m = Number(metric) || 0
    if (!best || m < best.metric)
      best = { iface, metric: m }
  }
  return best?.iface
}

export interface RemoteAddresses {
  tailscale?: string
  /** Private IPv4 addresses of physical interfaces; the default-route interface first. */
  lan: string[]
}

export function remoteAddresses(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
  defaultInterface: string | undefined = defaultRouteInterface(),
): RemoteAddresses {
  let tailscale: string | undefined
  const lan: { address: string, preferred: boolean }[] = []
  for (const [name, infos] of Object.entries(interfaces)) {
    for (const info of infos ?? []) {
      if (info.internal || info.family !== 'IPv4')
        continue
      if (isTailscaleIPv4(info.address)) {
        tailscale ??= info.address
        continue
      }
      if (!isPrivateIPv4(info.address) || isVirtualInterface(name))
        continue
      lan.push({ address: info.address, preferred: name === defaultInterface })
    }
  }
  lan.sort((a, b) => Number(b.preferred) - Number(a.preferred))
  return { tailscale, lan: [...new Set(lan.map(l => l.address))] }
}

/**
 * Slidev's presenter page for the phone: current and next slide, notes, timer, arrows.
 * Not the `/entry?password=<pw>/` link Slidev prints for its QR code: in Slidev 53 the slash
 * ends up in the password (the guard then falls back to the plain slides), and the entry page's
 * links drop the password, so the phone would be asked to type it.
 */
export function remoteUrl(address: string, port: number, password: string): string {
  return `http://${address}:${port}/presenter/?password=${encodeURIComponent(password)}`
}

export function remoteQrSvg(url: string): string {
  return renderSVG(url, { ecc: 'M', border: 2 })
}
