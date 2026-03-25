'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, Button, toast } from '@0ne/ui'
import { RefreshCw, Loader2 } from 'lucide-react'
import { usePlaidBalances, type PlaidBalanceAccount } from '../hooks/use-plaid-balances'

function formatBalance(balance: number | null): string {
  if (balance === null || balance === undefined) return '—'
  return `$${Math.abs(balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function AccountRow({ account }: { account: PlaidBalanceAccount }) {
  const utilization =
    account.type === 'credit' && account.creditLimit && account.currentBalance
      ? Math.round((Math.abs(account.currentBalance) / account.creditLimit) * 100)
      : null

  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{account.name}</span>
          {account.mask && (
            <span className="text-xs text-muted-foreground">··{account.mask}</span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {account.institutionName || 'Unknown'}
        </span>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold">{formatBalance(account.currentBalance)}</div>
        {account.availableBalance !== null &&
          account.availableBalance !== account.currentBalance && (
            <div className="text-xs text-muted-foreground">
              Avail: {formatBalance(account.availableBalance)}
            </div>
          )}
        {utilization !== null && (
          <div className="text-xs text-muted-foreground">{utilization}% utilized</div>
        )}
      </div>
    </div>
  )
}

export function BalanceCards() {
  const { grouped, isLoading, refresh } = usePlaidBalances()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await refresh()
      toast.success('Balances refreshed')
    } catch {
      toast.error('Failed to refresh balances')
    } finally {
      setIsRefreshing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const hasAnyAccounts =
    grouped.checking.length > 0 || grouped.savings.length > 0 || grouped.credit.length > 0

  if (!hasAnyAccounts) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Account Balances</h2>
        <Button onClick={handleRefresh} disabled={isRefreshing} variant="outline" size="sm">
          {isRefreshing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Refresh Balances
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {grouped.checking.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Checking</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {grouped.checking.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </CardContent>
          </Card>
        )}

        {grouped.savings.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Savings</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {grouped.savings.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </CardContent>
          </Card>
        )}

        {grouped.credit.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Credit</CardTitle>
            </CardHeader>
            <CardContent className="divide-y">
              {grouped.credit.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
