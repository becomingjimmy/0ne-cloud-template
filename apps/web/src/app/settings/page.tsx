'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Label,
  Switch,
  Separator,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@0ne/ui'
import { AppShell } from '@/components/shell'
import { authClient } from '@/lib/auth-client'
import {
  User,
  Shield,
  Link2,
  Monitor,
  Mail,
  Palette,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Users,
  Sun,
  Moon,
  Copy,
  Check,
  LogOut,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionEntry {
  id: string
  token: string
  userId: string
  expiresAt: Date | string
  createdAt: Date | string
  updatedAt: Date | string
  ipAddress?: string | null
  userAgent?: string | null
}

interface AccountEntry {
  id: string
  providerId: string
  accountId: string
}

type Theme = 'light' | 'dark' | 'system'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusMessage({ message, type }: { message: string; type: 'success' | 'error' }) {
  return (
    <div
      className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
        type === 'success'
          ? 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300'
          : 'bg-red-50 text-red-800 dark:bg-red-950/40 dark:text-red-300'
      }`}
    >
      {type === 'success' ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" />
      )}
      {message}
    </div>
  )
}

function parseUserAgent(ua?: string | null): string {
  if (!ua) return 'Unknown device'
  const parts: string[] = []
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) parts.push('Chrome')
  else if (/Edg/i.test(ua)) parts.push('Edge')
  else if (/Firefox/i.test(ua)) parts.push('Firefox')
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) parts.push('Safari')
  else parts.push('Browser')

  if (/Windows/i.test(ua)) parts.push('on Windows')
  else if (/Mac/i.test(ua)) parts.push('on macOS')
  else if (/Linux/i.test(ua)) parts.push('on Linux')
  else if (/Android/i.test(ua)) parts.push('on Android')
  else if (/iPhone|iPad/i.test(ua)) parts.push('on iOS')

  return parts.join(' ')
}

function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ---------------------------------------------------------------------------
// Section: Profile
// ---------------------------------------------------------------------------

function ProfileSection() {
  const { data: session, isPending } = authClient.useSession()
  const user = session?.user

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [nameLoading, setNameLoading] = useState(false)
  const [emailLoading, setEmailLoading] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [emailMsg, setEmailMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
    }
  }, [user])

  const handleUpdateName = async () => {
    setNameLoading(true)
    setNameMsg(null)
    const { error } = await authClient.updateUser({ name })
    setNameLoading(false)
    if (error) {
      setNameMsg({ text: error.message || 'Failed to update name.', type: 'error' })
    } else {
      setNameMsg({ text: 'Name updated successfully.', type: 'success' })
    }
  }

  const handleUpdateEmail = async () => {
    setEmailLoading(true)
    setEmailMsg(null)
    const { error } = await authClient.changeEmail({ newEmail: email })
    setEmailLoading(false)
    if (error) {
      setEmailMsg({ text: error.message || 'Failed to update email.', type: 'error' })
    } else {
      setEmailMsg({ text: 'A verification email has been sent to your new address.', type: 'success' })
    }
  }

  if (isPending) return null

  const initial = (user?.name || user?.email || '?').charAt(0).toUpperCase()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Profile
        </CardTitle>
        <CardDescription>Your personal information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Avatar placeholder */}
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary text-2xl font-semibold">
            {initial}
          </div>
          <p className="text-sm text-muted-foreground">
            Profile photo upload coming soon.
          </p>
        </div>

        <Separator />

        {/* Change name */}
        <div className="space-y-2">
          <Label htmlFor="settings-name">Full name</Label>
          <div className="flex gap-2">
            <Input
              id="settings-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className="max-w-sm"
            />
            <Button onClick={handleUpdateName} disabled={nameLoading || name === (user?.name || '')}>
              {nameLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </div>
          {nameMsg && <StatusMessage message={nameMsg.text} type={nameMsg.type} />}
        </div>

        <Separator />

        {/* Change email */}
        <div className="space-y-2">
          <Label htmlFor="settings-email">Email address</Label>
          <div className="flex gap-2">
            <Input
              id="settings-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="max-w-sm"
            />
            <Button onClick={handleUpdateEmail} disabled={emailLoading || email === (user?.email || '')}>
              {emailLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Update Email
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A verification email will be sent to your new address.
          </p>
          {emailMsg && <StatusMessage message={emailMsg.text} type={emailMsg.type} />}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Security
// ---------------------------------------------------------------------------

function SecuritySection() {
  // Password change
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false)
  const [mfaLoading, setMfaLoading] = useState(false)
  const [mfaMsg, setMfaMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [totpUri, setTotpUri] = useState<string | null>(null)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null)
  const [verifyCode, setVerifyCode] = useState('')
  const [verifyLoading, setVerifyLoading] = useState(false)
  const [enablePassword, setEnablePassword] = useState('')
  const [disablePassword, setDisablePassword] = useState('')
  const [disableLoading, setDisableLoading] = useState(false)
  const [copiedUri, setCopiedUri] = useState(false)

  const { data: session } = authClient.useSession()

  useEffect(() => {
    // The twoFactor plugin adds twoFactorEnabled to the user object
    if (session?.user && 'twoFactorEnabled' in session.user && session.user.twoFactorEnabled) {
      setMfaEnabled(true)
    }
  }, [session])

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      setPwMsg({ text: 'New passwords do not match.', type: 'error' })
      return
    }
    if (newPassword.length < 8) {
      setPwMsg({ text: 'Password must be at least 8 characters.', type: 'error' })
      return
    }
    setPwLoading(true)
    setPwMsg(null)
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: false,
    })
    setPwLoading(false)
    if (error) {
      setPwMsg({ text: error.message || 'Failed to change password.', type: 'error' })
    } else {
      setPwMsg({ text: 'Password updated successfully.', type: 'success' })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  const handleEnableMfa = async () => {
    if (!enablePassword) {
      setMfaMsg({ text: 'Enter your current password to enable two-factor authentication.', type: 'error' })
      return
    }
    setMfaLoading(true)
    setMfaMsg(null)
    const { data, error } = await authClient.twoFactor.enable({
      password: enablePassword,
    })
    setMfaLoading(false)
    if (error) {
      setMfaMsg({ text: error.message || 'Failed to enable two-factor authentication.', type: 'error' })
    } else if (data) {
      setTotpUri(data.totpURI)
      if (data.backupCodes) setBackupCodes(data.backupCodes)
      setEnablePassword('')
    }
  }

  const handleVerifyTotp = async () => {
    setVerifyLoading(true)
    setMfaMsg(null)
    const { error } = await authClient.twoFactor.verifyTotp({ code: verifyCode })
    setVerifyLoading(false)
    if (error) {
      setMfaMsg({ text: error.message || 'Invalid code. Please try again.', type: 'error' })
    } else {
      setMfaEnabled(true)
      setTotpUri(null)
      setVerifyCode('')
      setMfaMsg({ text: 'Two-factor authentication enabled successfully.', type: 'success' })
    }
  }

  const handleDisableMfa = async () => {
    setDisableLoading(true)
    setMfaMsg(null)
    const { error } = await authClient.twoFactor.disable({
      password: disablePassword || undefined,
    })
    setDisableLoading(false)
    if (error) {
      setMfaMsg({ text: error.message || 'Failed to disable two-factor authentication.', type: 'error' })
    } else {
      setMfaEnabled(false)
      setDisablePassword('')
      setMfaMsg({ text: 'Two-factor authentication disabled.', type: 'success' })
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUri(true)
      setTimeout(() => setCopiedUri(false), 2000)
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Security
        </CardTitle>
        <CardDescription>Password and two-factor authentication</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Change password */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Change password</h3>
          <div className="space-y-2 max-w-sm">
            <Input
              type="password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <Button
            onClick={handleChangePassword}
            disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword}
          >
            {pwLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Update Password
          </Button>
          {pwMsg && <StatusMessage message={pwMsg.text} type={pwMsg.type} />}
        </div>

        <Separator />

        {/* Two-factor authentication */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium">Two-factor authentication (TOTP)</h3>

          {mfaEnabled && !totpUri ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-4 w-4" />
                Two-factor authentication is enabled.
              </div>
              <div className="space-y-2 max-w-sm">
                <Input
                  type="password"
                  placeholder="Enter your password to disable"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                />
                <Button
                  variant="outline"
                  onClick={handleDisableMfa}
                  disabled={disableLoading || !disablePassword}
                >
                  {disableLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Disable Two-Factor
                </Button>
              </div>
            </div>
          ) : totpUri ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Scan this URI with your authenticator app (Google Authenticator, Authy, 1Password, etc.):
              </p>
              <div className="flex items-center gap-2">
                <code className="block max-w-md overflow-x-auto rounded-md bg-muted px-3 py-2 text-xs break-all">
                  {totpUri}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => copyToClipboard(totpUri)}
                  title="Copy TOTP URI"
                >
                  {copiedUri ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              {backupCodes && backupCodes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Backup codes (save these somewhere safe):</p>
                  <div className="grid grid-cols-2 gap-1 max-w-sm">
                    {backupCodes.map((code, i) => (
                      <code key={i} className="rounded bg-muted px-2 py-1 text-xs font-mono">
                        {code}
                      </code>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2 max-w-sm">
                <Input
                  placeholder="Enter 6-digit code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value)}
                  maxLength={8}
                />
                <Button
                  onClick={handleVerifyTotp}
                  disabled={verifyLoading || verifyCode.length < 6}
                >
                  {verifyLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Verify
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-w-sm">
              <p className="text-sm text-muted-foreground">
                Add an extra layer of security to your account with time-based one-time passwords.
              </p>
              <Input
                type="password"
                placeholder="Enter your current password"
                value={enablePassword}
                onChange={(e) => setEnablePassword(e.target.value)}
              />
              <Button onClick={handleEnableMfa} disabled={mfaLoading || !enablePassword}>
                {mfaLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enable Two-Factor Authentication
              </Button>
            </div>
          )}

          {mfaMsg && <StatusMessage message={mfaMsg.text} type={mfaMsg.type} />}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Connected Accounts
// ---------------------------------------------------------------------------

function ConnectedAccountsSection() {
  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchAccounts = useCallback(async () => {
    setLoading(true)
    const { data, error } = await authClient.listAccounts()
    setLoading(false)
    if (!error && data) {
      setAccounts(data as unknown as AccountEntry[])
    }
  }, [])

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  const hasGoogle = accounts.some((a) => a.providerId === 'google')
  const hasCredential = accounts.some((a) => a.providerId === 'credential')
  const canUnlinkGoogle = hasGoogle && (hasCredential || accounts.length > 1)

  const handleLinkGoogle = async () => {
    setActionLoading(true)
    setMsg(null)
    await authClient.linkSocial({
      provider: 'google',
      callbackURL: '/settings',
    })
    // This redirects to Google, so loading stays on
  }

  const handleUnlinkGoogle = async () => {
    setActionLoading(true)
    setMsg(null)
    const { error } = await authClient.unlinkAccount({ providerId: 'google' })
    setActionLoading(false)
    if (error) {
      setMsg({ text: error.message || 'Failed to unlink Google account.', type: 'error' })
    } else {
      setMsg({ text: 'Google account unlinked.', type: 'success' })
      fetchAccounts()
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          Connected Accounts
        </CardTitle>
        <CardDescription>Manage linked sign-in methods</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading accounts...
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-md border p-4">
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <div>
                <p className="text-sm font-medium">Google</p>
                <p className="text-xs text-muted-foreground">
                  {hasGoogle ? 'Connected' : 'Not connected'}
                </p>
              </div>
            </div>
            {hasGoogle ? (
              <Button
                variant="outline"
                size="sm"
                onClick={handleUnlinkGoogle}
                disabled={actionLoading || !canUnlinkGoogle}
                title={
                  !canUnlinkGoogle
                    ? 'Cannot unlink your only sign-in method. Set a password first.'
                    : undefined
                }
              >
                {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Unlink
              </Button>
            ) : (
              <Button size="sm" onClick={handleLinkGoogle} disabled={actionLoading}>
                {actionLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Link Google Account
              </Button>
            )}
          </div>
        )}
        {!canUnlinkGoogle && hasGoogle && !hasCredential && (
          <p className="text-xs text-muted-foreground">
            Google is your only sign-in method. Set a password before unlinking.
          </p>
        )}
        {msg && <StatusMessage message={msg.text} type={msg.type} />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Active Sessions
// ---------------------------------------------------------------------------

function ActiveSessionsSection() {
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokingAll, setRevokingAll] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const { data: currentSession } = authClient.useSession()
  const currentToken = currentSession?.session?.token

  const fetchSessions = useCallback(async () => {
    setLoading(true)
    const { data, error } = await authClient.listSessions()
    setLoading(false)
    if (!error && data) {
      setSessions(data as unknown as SessionEntry[])
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  const handleRevoke = async (token: string) => {
    setRevoking(token)
    setMsg(null)
    const { error } = await authClient.revokeSession({ token })
    setRevoking(null)
    if (error) {
      setMsg({ text: error.message || 'Failed to revoke session.', type: 'error' })
    } else {
      setSessions((prev) => prev.filter((s) => s.token !== token))
      setMsg({ text: 'Session revoked.', type: 'success' })
    }
  }

  const handleRevokeAll = async () => {
    setRevokingAll(true)
    setMsg(null)
    const { error } = await authClient.revokeSessions()
    setRevokingAll(false)
    if (error) {
      setMsg({ text: error.message || 'Failed to revoke sessions.', type: 'error' })
    } else {
      setSessions((prev) => prev.filter((s) => s.token === currentToken))
      setMsg({ text: 'All other sessions revoked.', type: 'success' })
    }
  }

  const otherSessions = sessions.filter((s) => s.token !== currentToken)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-5 w-5" />
          Active Sessions
        </CardTitle>
        <CardDescription>Devices where you are currently signed in</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sessions...
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <div className="space-y-3">
            {sessions.map((s) => {
              const isCurrent = s.token === currentToken
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{parseUserAgent(s.userAgent)}</p>
                      {isCurrent && (
                        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                          Current
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {s.ipAddress || 'Unknown IP'} &middot; Created {formatDate(s.createdAt)}
                    </p>
                  </div>
                  {!isCurrent && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(s.token)}
                      disabled={revoking === s.token}
                    >
                      {revoking === s.token ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <LogOut className="mr-1 h-3 w-3" />
                      )}
                      Revoke
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {otherSessions.length > 0 && (
          <Button
            variant="outline"
            onClick={handleRevokeAll}
            disabled={revokingAll}
            className="w-full"
          >
            {revokingAll && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Revoke All Other Sessions
          </Button>
        )}

        {msg && <StatusMessage message={msg.text} type={msg.type} />}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Email Preferences
// ---------------------------------------------------------------------------

function EmailPreferencesSection() {
  const [mounted, setMounted] = useState(false)
  const [passwordNotifs, setPasswordNotifs] = useState(true)
  const [signInAlerts, setSignInAlerts] = useState(true)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('email-preferences')
    if (stored) {
      try {
        const prefs = JSON.parse(stored)
        setPasswordNotifs(prefs.passwordNotifs ?? true)
        setSignInAlerts(prefs.signInAlerts ?? true)
      } catch {
        // ignore
      }
    }
  }, [])

  const save = (key: string, value: boolean) => {
    const current = { passwordNotifs, signInAlerts, [key]: value }
    localStorage.setItem('email-preferences', JSON.stringify(current))
  }

  if (!mounted) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Preferences
        </CardTitle>
        <CardDescription>Choose which email notifications you receive</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Password change notifications</p>
            <p className="text-xs text-muted-foreground">
              Get notified when your password is changed
            </p>
          </div>
          <Switch
            checked={passwordNotifs}
            onCheckedChange={(checked: boolean) => {
              setPasswordNotifs(checked)
              save('passwordNotifs', checked)
            }}
          />
        </div>
        <Separator />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">New sign-in alerts</p>
            <p className="text-xs text-muted-foreground">
              Get notified when a new device signs into your account
            </p>
          </div>
          <Switch
            checked={signInAlerts}
            onCheckedChange={(checked: boolean) => {
              setSignInAlerts(checked)
              save('signInAlerts', checked)
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground pt-2">
          These preferences are stored locally. Email delivery depends on your instance configuration.
        </p>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Theme
// ---------------------------------------------------------------------------

function ThemeSection() {
  const [theme, setTheme] = useState<Theme>('system')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const stored = localStorage.getItem('theme') as Theme | null
    if (stored) setTheme(stored)
  }, [])

  const applyTheme = (newTheme: Theme) => {
    const root = document.documentElement
    const isDark =
      newTheme === 'dark' ||
      (newTheme === 'system' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches)

    if (isDark) {
      root.classList.add('dark')
    } else {
      root.classList.remove('dark')
    }
  }

  const handleThemeChange = (newTheme: Theme) => {
    setTheme(newTheme)
    localStorage.setItem('theme', newTheme)
    applyTheme(newTheme)
  }

  if (!mounted) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Theme
        </CardTitle>
        <CardDescription>Choose how the app looks</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2">
          {([
            { value: 'light' as const, label: 'Light', icon: Sun },
            { value: 'dark' as const, label: 'Dark', icon: Moon },
            { value: 'system' as const, label: 'System', icon: Monitor },
          ]).map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              variant={theme === value ? 'default' : 'outline'}
              size="sm"
              onClick={() => handleThemeChange(value)}
              className="flex items-center gap-2"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Danger Zone
// ---------------------------------------------------------------------------

function DangerZoneSection() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const handleDeleteAccount = async () => {
    setLoading(true)
    setMsg(null)
    const { error } = await authClient.deleteUser()
    setLoading(false)
    if (error) {
      setMsg({ text: error.message || 'Failed to delete account.', type: 'error' })
    } else {
      // Account deleted — redirect to sign-in
      router.push('/sign-in')
    }
  }

  return (
    <Card className="border-red-200 dark:border-red-900/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <AlertTriangle className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Irreversible actions that permanently affect your account
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Delete account</p>
            <p className="text-xs text-muted-foreground">
              Permanently delete your account and all associated data.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" size="sm">
                Delete My Account
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Are you absolutely sure?</DialogTitle>
                <DialogDescription>
                  This action cannot be undone. All your data will be permanently deleted.
                  Type <span className="font-semibold">DELETE</span> to confirm.
                </DialogDescription>
              </DialogHeader>
              <Input
                placeholder='Type "DELETE" to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
              {msg && <StatusMessage message={msg.text} type={msg.type} />}
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteAccount}
                  disabled={loading || confirmText !== 'DELETE'}
                >
                  {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Delete Account
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Section: Administration (admin-only)
// ---------------------------------------------------------------------------

function AdminSection() {
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    fetch('/api/admin/permissions')
      .then((r) => setIsAdmin(r.ok))
      .catch(() => setIsAdmin(false))
  }, [])

  if (!isAdmin) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Administration
        </CardTitle>
        <CardDescription>Admin-only settings and user management</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Link href="/settings/admin">
          <Button variant="outline" className="w-full justify-start">
            <Users className="mr-2 h-4 w-4" />
            Manage User Permissions
          </Button>
        </Link>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <AppShell title="0ne">
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            Manage your account, security, and preferences
          </p>
        </div>

        <ProfileSection />
        <SecuritySection />
        <ConnectedAccountsSection />
        <ActiveSessionsSection />
        <EmailPreferencesSection />
        <ThemeSection />
        <AdminSection />
        <DangerZoneSection />
      </div>
    </AppShell>
  )
}
