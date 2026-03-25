'use client'

import { useState, useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Switch,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from '@0ne/ui'
import { Bell, Mail, MessageSquare, AlertTriangle, Loader2, Send, ArrowLeft } from 'lucide-react'
import { AppShell } from '@/components/shell'
import Link from 'next/link'
import type {
  NotificationPreferences,
  DeliveryMethod,
  MetricsConfig,
  AlertThresholds,
} from '@0ne/db/types'

// Metric display info for the checklist
const METRICS_INFO: { key: keyof MetricsConfig; label: string; description: string }[] = [
  { key: 'revenue', label: "Yesterday's Revenue", description: 'One-Time + MRR combined' },
  { key: 'leads', label: 'New Leads', description: 'Contacts added yesterday' },
  { key: 'clients', label: 'New Clients', description: 'Converted leads' },
  { key: 'fundedAmount', label: 'Funded Amount', description: 'Total funding processed' },
  { key: 'adSpend', label: 'Ad Spend', description: 'Marketing spend tracking' },
  { key: 'costPerLead', label: 'Cost Per Lead', description: 'Ad spend efficiency' },
  { key: 'skoolMembers', label: 'Skool Members', description: 'New community members' },
  { key: 'skoolConversion', label: 'Skool Conversion', description: 'Member conversion rate' },
]

// Time options for the delivery time picker
const TIME_OPTIONS = Array.from({ length: 24 }, (_, hour) => {
  const h = hour.toString().padStart(2, '0')
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  const amPm = hour < 12 ? 'AM' : 'PM'
  return {
    value: `${h}:00:00`,
    label: `${displayHour}:00 ${amPm}`,
  }
})

export default function NotificationsSettingsPage() {
  const { user } = useUser()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [sendingTest, setSendingTest] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [enabled, setEnabled] = useState(false)
  const [deliveryTime, setDeliveryTime] = useState('08:00:00')
  const [deliveryEmail, setDeliveryEmail] = useState('')
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('email')
  const [metricsConfig, setMetricsConfig] = useState<MetricsConfig>({
    revenue: true,
    leads: true,
    clients: true,
    fundedAmount: true,
    adSpend: true,
    costPerLead: true,
    skoolMembers: true,
    skoolConversion: true,
  })
  const [alertThresholds, setAlertThresholds] = useState<AlertThresholds>({})

  // Threshold form state
  const [revenueThreshold, setRevenueThreshold] = useState<string>('')
  const [leadsDaysThreshold, setLeadsDaysThreshold] = useState<string>('')
  const [syncFailureAlert, setSyncFailureAlert] = useState(false)

  // Fetch preferences on mount
  useEffect(() => {
    const fetchPreferences = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/kpi/notifications')
        if (!response.ok) {
          throw new Error('Failed to fetch preferences')
        }
        const data = await response.json()
        const prefs: NotificationPreferences = data.preferences

        setEnabled(prefs.dailySnapshotEnabled ?? false)
        setDeliveryTime(prefs.deliveryTime ?? '08:00:00')
        setDeliveryEmail(prefs.deliveryEmail || user?.emailAddresses[0]?.emailAddress || '')
        setDeliveryMethod((prefs.deliveryMethod ?? 'email') as DeliveryMethod)
        setMetricsConfig(prefs.metricsConfig as MetricsConfig)
        const thresholds = (prefs.alertThresholds || {}) as AlertThresholds
        setAlertThresholds(thresholds)

        // Parse thresholds for form
        if (thresholds?.revenue?.min !== undefined) {
          setRevenueThreshold(thresholds.revenue.min?.toString() || '')
        }
        // We don't have a leads days threshold in the current schema, but we can add it
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preferences')
      } finally {
        setLoading(false)
      }
    }

    fetchPreferences()
  }, [user?.emailAddresses])

  // Save preferences
  const savePreferences = async () => {
    setSaving(true)
    setError(null)

    try {
      // Build alert thresholds
      const thresholds: AlertThresholds = {}
      if (revenueThreshold && !isNaN(Number(revenueThreshold))) {
        thresholds.revenue = { min: Number(revenueThreshold), max: null }
      }
      if (syncFailureAlert) {
        // Store sync failure alert flag in a threshold (using costPerLead as placeholder)
        // In production, you'd have a separate field for this
      }

      const body = {
        dailySnapshotEnabled: enabled,
        deliveryTime: deliveryTime,
        deliveryEmail: deliveryEmail || null,
        deliveryMethod: deliveryMethod,
        metricsConfig: metricsConfig,
        alertThresholds: thresholds,
      }

      const response = await fetch('/api/kpi/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save preferences')
      }

      toast.success('Notification preferences saved')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save preferences'
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  // Send test notification
  const sendTestNotification = async () => {
    setSendingTest(true)
    try {
      const response = await fetch('/api/kpi/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: deliveryMethod }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Failed to send test notification')
      }

      toast.success('Test notification sent! Check your inbox.')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to send test notification'
      toast.error(message)
    } finally {
      setSendingTest(false)
    }
  }

  // Toggle a metric
  const toggleMetric = (key: keyof MetricsConfig) => {
    setMetricsConfig((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  if (loading) {
    return (
      <AppShell title="0ne">
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="0ne">
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Link href="/kpi">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Notification Settings</h1>
            <p className="text-muted-foreground">
              Configure your daily business snapshot and alerts
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {error}
          </div>
        )}

        {/* Daily Snapshot Toggle */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Daily Snapshot
            </CardTitle>
            <CardDescription>
              Receive a daily summary of your key business metrics
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Enable Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Enable daily snapshot</p>
                <p className="text-sm text-muted-foreground">
                  Receive a business summary at your chosen time
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} />
            </div>

            {/* Delivery Time */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Delivery Time</label>
              <Select value={deliveryTime} onValueChange={setDeliveryTime} disabled={!enabled}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Times are in your local timezone
              </p>
            </div>

            {/* Delivery Email */}
            <div className="space-y-2">
              <label className="text-sm font-medium">Delivery Email</label>
              <Input
                type="email"
                value={deliveryEmail}
                onChange={(e) => setDeliveryEmail(e.target.value)}
                placeholder={user?.emailAddresses[0]?.emailAddress || 'Enter email address'}
                disabled={!enabled}
                className="max-w-md"
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to use your account email
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Metrics Selection */}
        <Card>
          <CardHeader>
            <CardTitle>Metrics to Include</CardTitle>
            <CardDescription>
              Select which metrics to include in your daily snapshot
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              {METRICS_INFO.map((metric) => (
                <div
                  key={metric.key}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{metric.label}</p>
                    <p className="text-sm text-muted-foreground">{metric.description}</p>
                  </div>
                  <Switch
                    checked={metricsConfig[metric.key]}
                    onCheckedChange={() => toggleMetric(metric.key)}
                    disabled={!enabled}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Delivery Method */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Delivery Method
            </CardTitle>
            <CardDescription>Choose how you want to receive notifications</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setDeliveryMethod('email')}
                disabled={!enabled}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  deliveryMethod === 'email'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                } ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <Mail className="h-5 w-5" />
                <div>
                  <p className="font-medium">Email</p>
                  <p className="text-sm text-muted-foreground">Via GHL</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDeliveryMethod('sms')}
                disabled={!enabled}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  deliveryMethod === 'sms'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                } ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <MessageSquare className="h-5 w-5" />
                <div>
                  <p className="font-medium">SMS</p>
                  <p className="text-sm text-muted-foreground">Via GHL</p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setDeliveryMethod('both')}
                disabled={!enabled}
                className={`flex items-center gap-3 rounded-lg border p-4 text-left transition-colors ${
                  deliveryMethod === 'both'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                } ${!enabled ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <div className="flex">
                  <Mail className="h-5 w-5" />
                  <MessageSquare className="h-5 w-5 -ml-1" />
                </div>
                <div>
                  <p className="font-medium">Both</p>
                  <p className="text-sm text-muted-foreground">Email + SMS</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Alert Thresholds */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Alert Thresholds
            </CardTitle>
            <CardDescription>Get notified when metrics fall outside expected ranges</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Revenue Threshold */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium">Revenue below threshold</p>
                <p className="text-sm text-muted-foreground">
                  Alert when daily revenue drops below this amount
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">$</span>
                <Input
                  type="number"
                  value={revenueThreshold}
                  onChange={(e) => setRevenueThreshold(e.target.value)}
                  placeholder="0"
                  disabled={!enabled}
                  className="w-28"
                />
              </div>
            </div>

            {/* No Leads Threshold */}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <p className="font-medium">No new leads alert</p>
                <p className="text-sm text-muted-foreground">
                  Alert if no new leads for this many days
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={leadsDaysThreshold}
                  onChange={(e) => setLeadsDaysThreshold(e.target.value)}
                  placeholder="0"
                  disabled={!enabled}
                  className="w-28"
                />
                <span className="text-muted-foreground">days</span>
              </div>
            </div>

            {/* Sync Failure Alert */}
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Sync failure alerts</p>
                <p className="text-sm text-muted-foreground">
                  Get notified if data sync fails
                </p>
              </div>
              <Switch
                checked={syncFailureAlert}
                onCheckedChange={setSyncFailureAlert}
                disabled={!enabled}
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Button onClick={savePreferences} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Preferences'
            )}
          </Button>

          <Button
            variant="outline"
            onClick={sendTestNotification}
            disabled={!enabled || sendingTest}
          >
            {sendingTest ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send Test Email
              </>
            )}
          </Button>
        </div>
      </div>
    </AppShell>
  )
}
