const generateHelpUrl = require('@sanity/generate-help-url')
const assign = require('object-assign')
const validate = require('./validators')
const once = require('./util/once')

const defaultCdnHost = 'apicdn.sanity.io'
const defaultConfig = {
  apiHost: 'https://api.sanity.io',
  useProjectHostname: true,
  gradientMode: false,
  isPromiseAPI: true
}

const IS_BROWSER = () => typeof window !== 'undefined'

// eslint-disable-next-line no-console
const printWarning = message => once(() => console.warn(message.join(' ')))

const printCdnWarning = printWarning([
  'You are not using the Sanity CDN. That means your data is always fresh, but the CDN is faster and',
  `cheaper. Think about it! For more info, see ${generateHelpUrl('js-client-cdn-configuration')}.`,
  'To hide this warning, please set the `useCdn` option to either `true` or `false` when creating',
  'the client.'
])

const printTokenWarning = printWarning([
  'You have configured Sanity client to use a token in the Browser. This may cause unintended security issues.',
  `Make sure to read ${generateHelpUrl('js-client-token-browser')}.`,
  'If you are *absolutely* sure what you are doing, you can hide this warning, by setting the `ignoreTokenBrowserWarning` option to `true`'
])

exports.defaultConfig = defaultConfig

exports.initConfig = (config, prevConfig) => {
  const newConfig = assign({}, defaultConfig, prevConfig, config)
  const gradientMode = newConfig.gradientMode
  const projectBased = !gradientMode && newConfig.useProjectHostname

  if (typeof Promise === 'undefined') {
    const helpUrl = generateHelpUrl('js-client-promise-polyfill')
    throw new Error(`No native Promise-implementation found, polyfill needed - see ${helpUrl}`)
  }

  if (gradientMode && !newConfig.namespace) {
    throw new Error('Configuration must contain `namespace` when running in gradient mode')
  }

  if (projectBased && !newConfig.projectId) {
    throw new Error('Configuration must contain `projectId`')
  }

  if (typeof newConfig.useCdn === 'undefined') {
    printCdnWarning()
  }

  if (
    IS_BROWSER &&
    typeof newConfig.token !== 'undefined' &&
    newConfig.ignoreTokenBrowserWarning !== true
  ) {
    printTokenWarning()
  }

  if (projectBased) {
    validate.projectId(newConfig.projectId)
  }

  if (!gradientMode && newConfig.dataset) {
    validate.dataset(newConfig.dataset, newConfig.gradientMode)
  }

  newConfig.isDefaultApi = newConfig.apiHost === defaultConfig.apiHost
  newConfig.useCdn = Boolean(newConfig.useCdn) && !newConfig.token && !newConfig.withCredentials

  if (newConfig.gradientMode) {
    newConfig.url = newConfig.apiHost
    newConfig.cdnUrl = newConfig.apiHost
  } else {
    const hostParts = newConfig.apiHost.split('://', 2)
    const protocol = hostParts[0]
    const host = hostParts[1]
    const cdnHost = newConfig.isDefaultApi ? defaultCdnHost : host

    if (newConfig.useProjectHostname) {
      newConfig.url = `${protocol}://${newConfig.projectId}.${host}/v1`
      newConfig.cdnUrl = `${protocol}://${newConfig.projectId}.${cdnHost}/v1`
    } else {
      newConfig.url = `${newConfig.apiHost}/v1`
      newConfig.cdnUrl = newConfig.url
    }
  }

  return newConfig
}
