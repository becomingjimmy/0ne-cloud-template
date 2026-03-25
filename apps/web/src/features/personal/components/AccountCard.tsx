'use client'

import { Card, CardContent, Button, toast } from '@0ne/ui'
import { Building2, Trash2, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { useState } from 'react'
import type { PlaidItem, PlaidAccount } from '../hooks/use-plaid-accounts'

interface AccountCardProps {
  item: PlaidItem
  onUnlink: (itemId: string) => Promise<void>
  onAccountUpdate?: () => void
}

function formatBalance(balance: number | null): string {
  if (balance === null || balance === undefined) return '—'
  return `$${Math.abs(balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getTypeBadgeColor(type: string): string {
  switch (type) {
    case 'depository': return 'bg-green-100 text-green-700'
    case 'credit': return 'bg-red-100 text-red-700'
    case 'loan': return 'bg-yellow-100 text-yellow-700'
    case 'investment': return 'bg-blue-100 text-blue-700'
    default: return 'bg-gray-100 text-gray-700'
  }
}

function getScopeBadge(scope: PlaidAccount['scope']): { label: string; className: string } {
  switch (scope) {
    case 'personal': return { label: 'Personal', className: 'bg-purple-100 text-purple-700' }
    case 'business': return { label: 'Business', className: 'bg-blue-100 text-blue-700' }
    default: return { label: 'Unassigned', className: 'bg-gray-100 text-gray-500' }
  }
}

async function updateAccount(accountId: string, data: { is_hidden?: boolean; scope?: string | null }) {
  const response = await fetch(`/api/personal/banking/accounts/${encodeURIComponent(accountId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return response.json()
}

export function AccountCard({ item, onUnlink, onAccountUpdate }: AccountCardProps) {
  const [isUnlinking, setIsUnlinking] = useState(false)
  const [updatingAccounts, setUpdatingAccounts] = useState<Set<string>>(new Set())

  const handleUnlink = async () => {
    setIsUnlinking(true)
    try {
      await onUnlink(item.id)
    } finally {
      setIsUnlinking(false)
    }
  }

  const handleToggleHidden = async (account: PlaidAccount) => {
    setUpdatingAccounts((prev) => new Set(prev).add(account.id))
    try {
      const result = await updateAccount(account.id, { is_hidden: !account.isHidden })
      if (result.success) {
        toast.success(account.isHidden ? 'Account visible' : 'Account hidden')
        onAccountUpdate?.()
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setUpdatingAccounts((prev) => {
        const next = new Set(prev)
        next.delete(account.id)
        return next
      })
    }
  }

  const handleScopeChange = async (account: PlaidAccount, scope: string) => {
    const newScope = scope === '' ? null : scope
    setUpdatingAccounts((prev) => new Set(prev).add(account.id))
    try {
      const result = await updateAccount(account.id, { scope: newScope })
      if (result.success) {
        toast.success(`Account set to ${newScope || 'unassigned'}`)
        onAccountUpdate?.()
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setUpdatingAccounts((prev) => {
        const next = new Set(prev)
        next.delete(account.id)
        return next
      })
    }
  }

  const hasError = item.status !== 'active'

  return (
    <Card>
      <CardContent className="p-6">
        {/* Institution header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold">{item.institutionName || 'Unknown Institution'}</h3>
              <p className="text-xs text-muted-foreground">
                {item.lastSyncedAt
                  ? `Last synced: ${new Date(item.lastSyncedAt).toLocaleDateString()}`
                  : 'Never synced'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUnlink}
            disabled={isUnlinking}
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
            title="Unlink account"
          >
            {isUnlinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Error state */}
        {hasError && (
          <div className="flex items-center gap-2 mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>
              {item.status === 'login_required'
                ? 'Login required — please reconnect this account'
                : `Error: ${item.errorCode || item.status}`}
            </span>
          </div>
        )}

        {/* Account list */}
        <div className="space-y-3">
          {item.accounts.map((account) => {
            const isUpdating = updatingAccounts.has(account.id)
            const scopeBadge = getScopeBadge(account.scope)

            return (
              <div
                key={account.id}
                className={`flex items-center justify-between rounded-lg border p-3 transition-opacity ${
                  account.isHidden ? 'opacity-50 bg-muted/30' : ''
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Hide/show toggle */}
                  <button
                    onClick={() => handleToggleHidden(account)}
                    disabled={isUpdating}
                    className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                    title={account.isHidden ? 'Show account' : 'Hide account'}
                  >
                    {isUpdating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : account.isHidden ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{account.name}</span>
                      {account.mask && (
                        <span className="text-xs text-muted-foreground shrink-0">••{account.mask}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${getTypeBadgeColor(account.type)}`}>
                        {account.subtype || account.type}
                      </span>
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${scopeBadge.className}`}>
                        {scopeBadge.label}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  {/* Scope selector */}
                  <select
                    value={account.scope || ''}
                    onChange={(e) => handleScopeChange(account, e.target.value)}
                    disabled={isUpdating}
                    className="text-xs border rounded px-1.5 py-1 bg-background"
                  >
                    <option value="">Unassigned</option>
                    <option value="personal">Personal</option>
                    <option value="business">Business</option>
                  </select>

                  {/* Balance */}
                  <div className="text-right">
                    <div className="font-semibold text-sm">
                      {formatBalance(account.currentBalance)}
                    </div>
                    {account.availableBalance !== null && account.availableBalance !== account.currentBalance && (
                      <div className="text-xs text-muted-foreground">
                        Available: {formatBalance(account.availableBalance)}
                      </div>
                    )}
                    {account.type === 'credit' && account.creditLimit && (
                      <div className="text-xs text-muted-foreground">
                        Limit: {formatBalance(account.creditLimit)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
          {item.accounts.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">
              No accounts found
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
