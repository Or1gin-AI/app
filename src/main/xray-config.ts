export type ProxyServices = 'off' | 'claude' | 'chatgpt' | 'both'

export interface FrontProxyConfig {
  server: string
  port: number
  uuid: string
  security?: 'none' | 'reality'
  flow?: string
  serverName?: string
  fingerprint?: string
  publicKey?: string
  shortId?: string
}

export interface PhoneGatewayLike {
  host: string; port: number; user: string; pass: string
}

export interface BuildOpts {
  proxyPassword: string
  frontProxy: FrontProxyConfig | null
  phoneGateway: PhoneGatewayLike | null
  proxyServices: ProxyServices
  remote: { address: string; port: number; serverName: string; wsPath: string; method: string }
  ports: { socks: number; http: number }
  sharedDomains: string[]
  claudeDomains: string[]
  claudeIps: string[]
  chatgptDomains: string[]
}

export function buildXrayConfig(opts: BuildOpts): object {
  const { frontProxy, proxyServices, remote } = opts
  const whitelist = !!frontProxy

  const proxyOutbound: Record<string, unknown> = {
    tag: 'proxy', protocol: 'shadowsocks',
    settings: { servers: [{ address: remote.address, port: remote.port, method: remote.method, password: opts.proxyPassword }] },
    streamSettings: {
      network: 'ws', security: 'tls',
      tlsSettings: { serverName: remote.serverName, fingerprint: 'chrome' },
      wsSettings: { path: remote.wsPath },
    },
  }

  const outbounds: Record<string, unknown>[] = [{ tag: 'direct', protocol: 'freedom' }]

  if (whitelist) {
    const gatewayUser: Record<string, unknown> = {
      id: frontProxy!.uuid,
      encryption: 'none',
    }
    if (frontProxy!.flow) gatewayUser.flow = frontProxy!.flow

    const gatewayStreamSettings: Record<string, unknown> = {
      network: 'tcp',
      security: frontProxy!.security ?? 'none',
    }
    if (frontProxy!.security === 'reality') {
      gatewayStreamSettings.realitySettings = {
        serverName: frontProxy!.serverName,
        fingerprint: frontProxy!.fingerprint ?? 'chrome',
        password: frontProxy!.publicKey,
        shortId: frontProxy!.shortId,
      }
    }

    outbounds.push({
      tag: 'gateway', protocol: 'vless',
      settings: { vnext: [{ address: frontProxy!.server, port: frontProxy!.port, users: [gatewayUser] }] },
      streamSettings: gatewayStreamSettings,
    })
    // Chain the shadowsocks proxy through the dedicated gateway at the dialer (TCP) layer.
    // NOTE: outbound-level `proxySettings: { tag }` does NOT compose with this ws/tls
    // shadowsocks outbound (connection fails); `sockopt.dialerProxy` is the working form.
    ;(proxyOutbound.streamSettings as Record<string, unknown>).sockopt = { dialerProxy: 'gateway' }
  }
  outbounds.push(proxyOutbound, { tag: 'block', protocol: 'blackhole' })

  const aiDomains: string[] = []
  const aiIps: string[] = []
  const wantClaude = proxyServices === 'claude' || proxyServices === 'both'
  const wantChatgpt = proxyServices === 'chatgpt' || proxyServices === 'both'
  if (wantClaude) { aiDomains.push(...opts.claudeDomains); aiIps.push(...opts.claudeIps) }
  if (wantChatgpt) { aiDomains.push(...opts.chatgptDomains) }

  const rules: Record<string, unknown>[] = []

  if (whitelist) {
    rules.push({ type: 'field', outboundTag: 'direct', ip: ['geoip:private', 'geoip:cn'] })
    rules.push({ type: 'field', outboundTag: 'direct', domain: ['geosite:cn'] })
    if (proxyServices !== 'off') {
      const proxyDomains = [...opts.sharedDomains, ...aiDomains]
      rules.push({ type: 'field', outboundTag: 'proxy', domain: proxyDomains })
      if (aiIps.length > 0) rules.push({ type: 'field', outboundTag: 'proxy', ip: aiIps })
      rules.push({ type: 'field', outboundTag: 'block', domain: aiDomains, port: '443', network: 'udp' })
    }
    rules.push({ type: 'field', outboundTag: 'gateway', network: 'tcp,udp' })
  } else {
    const proxyDomains = [...opts.sharedDomains, ...aiDomains]
    rules.push({ type: 'field', outboundTag: 'proxy', domain: proxyDomains })
    if (aiIps.length > 0) rules.push({ type: 'field', outboundTag: 'proxy', ip: aiIps })
    rules.push({ type: 'field', outboundTag: 'block', port: '443', network: 'udp' })
  }

  const inbounds: Record<string, unknown>[] = [
    { tag: 'socks-in', port: opts.ports.socks, listen: '127.0.0.1', protocol: 'socks', settings: { udp: true } },
    { tag: 'http-in', port: opts.ports.http, listen: '127.0.0.1', protocol: 'http' },
  ]
  if (opts.phoneGateway) {
    inbounds.push({
      tag: 'phone-gateway-in', port: opts.phoneGateway.port, listen: opts.phoneGateway.host, protocol: 'socks',
      settings: { auth: 'password', udp: true, accounts: [{ user: opts.phoneGateway.user, pass: opts.phoneGateway.pass }] },
    })
  }

  return {
    log: { loglevel: 'info' },
    dns: {
      queryStrategy: 'UseIPv4',
      servers: whitelist
        ? [
            { address: '223.5.5.5', port: 53, domains: ['geosite:cn'], skipFallback: true },
            { address: 'https://1.1.1.1/dns-query', skipFallback: true },
            'localhost',
          ]
        : [{ address: 'https://1.1.1.1/dns-query', skipFallback: true }, 'localhost'],
    },
    inbounds,
    outbounds,
    routing: { domainStrategy: 'IPIfNonMatch', rules },
  }
}
