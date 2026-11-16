/**
 * The launcher's address rules (pure functions exported by launcher.mjs; importing it from a
 * test does not start a server), and the main process's remote helpers.
 */
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without types
import * as launcher from '../../../launcher/launcher.mjs'
import { defaultRouteInterface, isVirtualInterface, newRemotePassword, remoteAddresses, remoteQrSvg, remoteUrl } from '../../../src/main/remote'

describe('launcher address classification', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.8.9.10', 'loopback'],
    ['::1', 'loopback'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['100.64.0.1', 'tailscale'],
    ['100.101.102.103', 'tailscale'],
    ['100.127.255.255', 'tailscale'],
    ['::ffff:100.101.102.103', 'tailscale'],
    ['fd7a:115c:a1e0::1', 'tailscale'],
    ['fd7a:115c:a1e0:ab12:4843:cd96:6258:b240', 'tailscale'],
    ['10.0.0.5', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['192.168.1.50', 'private'],
    ['::ffff:192.168.1.50', 'private'],
    ['::ffff:c0a8:b251', 'private'],
    ['fe80::1%eth0', 'private'],
    ['fd00::1', 'private'],
    ['fd7a:115c:a1e1::1', 'private'],
    ['100.63.255.255', 'public'],
    ['100.128.0.0', 'public'],
    ['172.32.0.1', 'public'],
    ['8.8.8.8', 'public'],
    ['::ffff:8.8.8.8', 'public'],
    ['2001:db8::1', 'public'],
    ['::', 'public'],
    ['', 'invalid'],
    ['localhost', 'invalid'],
    ['1.2.3', 'invalid'],
    ['256.1.1.1', 'invalid'],
    ['1:2:3:4:5:6:7:8:9', 'invalid'],
  ])('%s is %s', (address, kind) => {
    expect(launcher.classifyAddress(address)).toBe(kind)
  })

  it('unwraps IPv4-mapped IPv6 and zone ids', () => {
    expect(launcher.normalizeAddress('::ffff:1.2.3.4')).toBe('1.2.3.4')
    expect(launcher.normalizeAddress('::FFFF:0102:0304')).toBe('1.2.3.4')
    expect(launcher.normalizeAddress('[::1]')).toBe('::1')
    expect(launcher.normalizeAddress('fe80::1%wlan0')).toBe('fe80::1')
  })

  it('parses IPv6 forms', () => {
    expect(launcher.parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1])
    expect(launcher.parseIPv6('fd7a:115c:a1e0::')).toEqual([0xFD7A, 0x115C, 0xA1E0, 0, 0, 0, 0, 0])
    expect(launcher.parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xFFFF, 0x0102, 0x0304])
    expect(launcher.parseIPv6('1::2::3')).toBeUndefined()
    expect(launcher.parseIPv6('12345::')).toBeUndefined()
  })
})

describe('launcher allow rules', () => {
  const cases: [string, boolean, boolean][] = [
    // address, allowed with 'tailscale', allowed with 'lan'
    ['127.0.0.1', true, true],
    ['::1', true, true],
    ['::ffff:127.0.0.1', true, true],
    ['100.101.102.103', true, true],
    ['fd7a:115c:a1e0::5', true, true],
    ['192.168.1.50', false, true],
    ['10.1.2.3', false, true],
    ['172.20.0.1', false, true],
    ['fe80::abcd', false, true],
    ['fc00::1', false, true],
    ['8.8.8.8', false, false],
    ['2a00:1450::1', false, false],
    ['garbage', false, false],
    [undefined as unknown as string, false, false],
  ]
  it.each(cases)('%s: tailscale %s, lan %s', (address, viaTailscale, viaLan) => {
    expect(launcher.isAllowedClient(address, 'tailscale')).toBe(viaTailscale)
    expect(launcher.isAllowedClient(address, 'lan')).toBe(viaLan)
  })

  it('treats an unknown mode as loopback only', () => {
    expect(launcher.isAllowedClient('127.0.0.1', 'bogus')).toBe(true)
    expect(launcher.isAllowedClient('100.101.102.103', 'bogus')).toBe(false)
  })
})

describe('remote addresses', () => {
  const iface = (address: string, family: 'IPv4' | 'IPv6' = 'IPv4', internal = false) =>
    ({ address, family, internal, netmask: '', mac: '', cidr: null }) as any

  it('finds the Tailscale address and private addresses of real interfaces', () => {
    const result = remoteAddresses({
      lo: [iface('127.0.0.1', 'IPv4', true)],
      docker0: [iface('172.17.0.1')],
      'br-1234': [iface('172.18.0.1')],
      wlp2s0: [iface('192.168.1.20'), iface('fe80::1', 'IPv6')],
      eno1: [iface('192.168.1.50')],
      tailscale0: [iface('100.101.102.103'), iface('fd7a:115c:a1e0::1', 'IPv6')],
      wan: [iface('84.1.2.3')],
    }, 'eno1')
    expect(result).toEqual({ tailscale: '100.101.102.103', lan: ['192.168.1.50', '192.168.1.20'] })
  })

  it('has no Tailscale address without Tailscale', () => {
    expect(remoteAddresses({ en0: [iface('10.0.0.4')] }, undefined)).toEqual({ tailscale: undefined, lan: ['10.0.0.4'] })
  })

  it('knows virtual interfaces', () => {
    for (const name of ['docker0', 'br-abc', 'veth12', 'virbr0', 'vEthernet (WSL)', 'utun3', 'tailscale0', 'wg0'])
      expect(isVirtualInterface(name)).toBe(true)
    for (const name of ['eno1', 'eth0', 'wlp2s0', 'en0', 'WLAN', 'Ethernet', 'Wi-Fi'])
      expect(isVirtualInterface(name)).toBe(false)
  })

  it('reads the default route from /proc/net/route text', () => {
    const table = [
      'Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT',
      'wlp2s0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0',
      'eno1\t00000000\t01B2A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0',
      'docker0\t000011AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
    ].join('\n')
    expect(defaultRouteInterface(table)).toBe('eno1')
    expect(defaultRouteInterface('Iface\tDestination\n')).toBeUndefined()
  })

  it('makes a 128-bit password, the presenter link and a QR code', () => {
    const password = newRemotePassword()
    expect(Buffer.from(password, 'base64url')).toHaveLength(16)
    expect(newRemotePassword()).not.toBe(password)
    const url = remoteUrl('100.101.102.103', 3456, password)
    expect(url).toBe(`http://100.101.102.103:3456/presenter/?password=${password}`)
    const svg = remoteQrSvg(url)
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 \d+ \d+"/)
  })
})
