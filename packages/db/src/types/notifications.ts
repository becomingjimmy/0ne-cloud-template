// Notification Preferences database types

/**
 * Delivery method for notifications
 */
export type DeliveryMethod = 'email' | 'sms' | 'both'

/**
 * Configuration for which metrics to include in daily snapshots
 * All fields default to true
 */
export interface MetricsConfig {
  revenue: boolean
  leads: boolean
  clients: boolean
  fundedAmount: boolean
  adSpend: boolean
  costPerLead: boolean
  skoolMembers: boolean
  skoolConversion: boolean
}

/**
 * Threshold settings for a single metric
 * Set min/max to null to disable that threshold
 */
export interface MetricThreshold {
  min: number | null
  max: number | null
}

/**
 * Alert thresholds configuration
 * Keys match MetricsConfig keys
 */
export interface AlertThresholds {
  revenue?: MetricThreshold
  leads?: MetricThreshold
  clients?: MetricThreshold
  fundedAmount?: MetricThreshold
  adSpend?: MetricThreshold
  costPerLead?: MetricThreshold
  skoolMembers?: MetricThreshold
  skoolConversion?: MetricThreshold
}

/**
 * User notification preferences (database row — camelCase from Drizzle)
 */
export interface NotificationPreferences {
  clerkUserId: string
  dailySnapshotEnabled: boolean | null
  deliveryTime: string | null
  deliveryEmail: string | null
  deliveryMethod: string | null
  metricsConfig: MetricsConfig | unknown
  alertThresholds: AlertThresholds | unknown
  createdAt: Date | null
  updatedAt: Date | null
}

/**
 * Input for creating/updating notification preferences
 * All fields optional except user_id (which comes from auth)
 */
export interface NotificationPreferencesInput {
  dailySnapshotEnabled?: boolean
  deliveryTime?: string
  deliveryEmail?: string | null
  deliveryMethod?: DeliveryMethod
  metricsConfig?: Partial<MetricsConfig>
  alertThresholds?: AlertThresholds
}

/**
 * Default metrics configuration
 */
export const DEFAULT_METRICS_CONFIG: MetricsConfig = {
  revenue: true,
  leads: true,
  clients: true,
  fundedAmount: true,
  adSpend: true,
  costPerLead: true,
  skoolMembers: true,
  skoolConversion: true,
}

/**
 * Default notification preferences for new users
 */
export const DEFAULT_NOTIFICATION_PREFERENCES: Omit<NotificationPreferences, 'clerkUserId' | 'createdAt' | 'updatedAt'> = {
  dailySnapshotEnabled: false,
  deliveryTime: '08:00:00',
  deliveryEmail: null,
  deliveryMethod: 'email',
  metricsConfig: DEFAULT_METRICS_CONFIG,
  alertThresholds: {},
}
