import { describe, it, expect } from 'vitest'
import { buildXrayConfig, type BuildOpts } from './xray-config'

const BASE: BuildOpts = {
  proxyPassword: 'pw',
  frontProxy: null,
  phoneGateway: null,
  proxyServices: 'both',
  remote: { address: 'p.originai.cc', port: 443, serverName: 'p.originai.cc', wsPath: '/update', method: 'aes-256-gcm' },
  ports: { socks: 21910, http: 21911 },
  sharedDomains: ['regexp:.*shared.*'],
  claudeDomains: ['regexp:.*claude.*'], claudeIps: ['160.79.104.0/21'],
  chatgptDomains: ['regexp:.*openai.*'],
}
const FP = { server: '64.83.46.210', port: 12690, uuid: 'uuid-1' }

function outboundTags(cfg: any): string[] { return cfg.outbounds.map((o: any) => o.tag) }
function rules(cfg: any): any[] { return cfg.routing.rules }

describe('buildXrayConfig', () => {
  it('non-whitelist (frontProxy=null): keeps original behavior — no gateway, AI→proxy, no CN split', () => {
    const cfg: any = buildXrayConfig(BASE)
    expect(outboundTags(cfg)).not.toContain('gateway')
    const hasCnDirect = rules(cfg).some(r => (r.domain || []).includes('geosite:cn'))
    expect(hasCnDirect).toBe(false)
    const proxy = cfg.outbounds.find((o: any) => o.tag === 'proxy')
    expect(proxy.proxySettings).toBeUndefined()
  })

  it('whitelist global tunnel (both): CN direct, AI→proxy via gateway, default MATCH→gateway', () => {
    const cfg: any = buildXrayConfig({ ...BASE, frontProxy: FP, proxyServices: 'both' })
    expect(outboundTags(cfg)).toEqual(expect.arrayContaining(['direct', 'gateway', 'proxy', 'block']))
    const gw = cfg.outbounds.find((o: any) => o.tag === 'gateway')
    expect(gw.protocol).toBe('vless')
    expect(gw.settings.vnext[0]).toMatchObject({ address: '64.83.46.210', port: 12690 })
    expect(gw.settings.vnext[0].users[0]).toMatchObject({ id: 'uuid-1', encryption: 'none' })
    const proxy = cfg.outbounds.find((o: any) => o.tag === 'proxy')
    expect(proxy.proxySettings).toEqual({ tag: 'gateway' })
    expect(rules(cfg).some(r => (r.domain || []).includes('geosite:cn'))).toBe(true)
    expect(rules(cfg).some(r => (r.ip || []).includes('geoip:cn'))).toBe(true)
    expect(rules(cfg).some(r => r.outboundTag === 'proxy' && (r.domain || []).includes('regexp:.*claude.*'))).toBe(true)
    const last = rules(cfg)[rules(cfg).length - 1]
    expect(last.outboundTag).toBe('gateway')
  })

  it('whitelist layer2 off: all non-CN incl AI → gateway, no AI→proxy rule', () => {
    const cfg: any = buildXrayConfig({ ...BASE, frontProxy: FP, proxyServices: 'off' })
    expect(rules(cfg).some(r => r.outboundTag === 'proxy')).toBe(false)
    const last = rules(cfg)[rules(cfg).length - 1]
    expect(last.outboundTag).toBe('gateway')
  })
})
