const { execSync } = require('child_process')
const path = require('path')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const identity = context.packager.config?.mac?.identity
  const autoDiscovery = process.env.CSC_IDENTITY_AUTO_DISCOVERY !== 'false'
  const hasCert = !!process.env.CSC_LINK || !!process.env.CSC_NAME
  if (identity !== null && (identity || (autoDiscovery && hasCert))) return

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execSync(`codesign --force --deep --sign - "${app}"`, { stdio: 'inherit' })
}
