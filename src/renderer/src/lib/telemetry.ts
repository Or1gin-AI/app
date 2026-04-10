import posthog from 'posthog-js'

// Telemetry can be disabled via:
// 1. Build-time: VITE_TELEMETRY_DISABLED=true
// 2. Runtime: --no-telemetry command line arg (checked via preload)
let _disabled = import.meta.env.VITE_TELEMETRY_DISABLED === 'true'

export function disableTelemetry(): void {
  _disabled = true
  try { posthog.opt_out_capturing() } catch { /* */ }
}

export function isTelemetryDisabled(): boolean {
  return _disabled
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (_disabled) return
  try { posthog.capture(event, properties) } catch { /* */ }
}

export function identify(email: string, properties?: Record<string, unknown>): void {
  if (_disabled) return
  try { posthog.identify(email, properties) } catch { /* */ }
}

export function reset(): void {
  if (_disabled) return
  try { posthog.reset() } catch { /* */ }
}

// ========== Event names ==========
export const EVENTS = {
  // App lifecycle
  APP_STARTED: 'app_started',
  APP_VERSION: 'app_version',

  // Auth
  USER_REGISTERED: 'user_registered',
  USER_LOGGED_IN: 'user_logged_in',
  USER_LOGGED_OUT: 'user_logged_out',
  EMAIL_VERIFIED: 'email_verified',

  // Navigation
  PAGE_VIEW: '$pageview',

  // Network
  NETWORK_OPTIMIZATION_COMPLETE: 'network_optimization_complete',
  NETWORK_STATUS_CHECK: 'network_status_check',

  // Subscription
  CHECKOUT_CREATED: 'checkout_created',
  CHECKOUT_COMPLETED: 'checkout_completed',
  SUBSCRIPTION_UPGRADED: 'subscription_upgraded',
  SUBSCRIPTION_CANCELLED: 'subscription_cancelled',
  PAYMENT_METHOD_SELECTED: 'payment_method_selected',

  // SMS Activation
  SMS_NUMBER_REQUESTED: 'sms_number_requested',
  SMS_CODE_RECEIVED: 'sms_code_received',
  SMS_NUMBER_REFRESHED: 'sms_number_refreshed',
  SMS_REFUNDED: 'sms_refunded',

  // Proxy
  PROXY_LOGIN_REQUESTED: 'proxy_login_requested',

  // Errors
  CHECKOUT_ERROR: 'checkout_error',
  ACTIVATION_ERROR: 'activation_error',
} as const
