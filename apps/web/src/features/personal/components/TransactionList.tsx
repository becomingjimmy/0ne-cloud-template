'use client'

import { useState } from 'react'
import { Button, cn, toast } from '@0ne/ui'
import { DataTable, type Column } from '@/features/kpi/components/DataTable'
import { Loader2, EyeOff, Eye } from 'lucide-react'
import {
  usePlaidTransactions,
  updatePlaidTransaction,
  type PlaidTransaction,
} from '../hooks/use-plaid-transactions'

function hexToLightBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.15)`
}

const CATEGORY_COLORS: Record<string, string> = {
  housing: '#3b82f6',
  food: '#22c55e',
  transportation: '#f59e0b',
  subscriptions: '#8b5cf6',
}

export function TransactionList() {
  const { transactions, isLoading, refetch } = usePlaidTransactions()
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  const handleToggleExclude = async (id: string, currentlyExcluded: boolean) => {
    setTogglingIds((prev) => new Set(prev).add(id))
    try {
      const result = await updatePlaidTransaction(id, { isExcluded: !currentlyExcluded })
      if (result.success) {
        toast.success(currentlyExcluded ? 'Transaction included' : 'Transaction excluded')
        refetch()
      } else {
        throw new Error(result.error)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update')
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const columns: Column<PlaidTransaction>[] = [
    {
      key: 'date',
      header: 'Date',
      render: (value) => new Date(value as string).toLocaleDateString(),
    },
    {
      key: 'merchantName',
      header: 'Merchant',
      render: (value, row) => (
        <span className={cn(row.isExcluded && 'text-muted-foreground line-through')}>
          {(value as string) || row.name || 'Unknown'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right' as const,
      render: (value, row) => (
        <span className={cn(
          'font-medium',
          row.isExcluded && 'text-muted-foreground',
          (value as number) > 0 ? 'text-red-600' : 'text-green-600'
        )}>
          {(value as number) > 0 ? '-' : '+'}${Math.abs(value as number).toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      ),
    },
    {
      key: 'mappedCategory',
      header: 'Category',
      render: (value) => {
        if (!value) return <span className="text-muted-foreground text-xs">Unmapped</span>
        const color = CATEGORY_COLORS[value as string] || '#6b7280'
        return (
          <span
            className="inline-flex rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ backgroundColor: hexToLightBg(color), color }}
          >
            {(value as string).charAt(0).toUpperCase() + (value as string).slice(1)}
          </span>
        )
      },
    },
    {
      key: 'accountName',
      header: 'Account',
      render: (value, row) => {
        return (
          <span className="text-xs text-muted-foreground">
            {(value as string) || 'Unknown'}{row.accountMask ? ` ••${row.accountMask}` : ''}
          </span>
        )
      },
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      sortable: false,
      render: (_, row) => {
        const isToggling = togglingIds.has(row.id)
        return (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggleExclude(row.id, row.isExcluded)}
            disabled={isToggling}
            title={row.isExcluded ? 'Include transaction' : 'Exclude transaction'}
          >
            {isToggling ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : row.isExcluded ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
        )
      },
    },
  ]

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (transactions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No transactions yet. Click Sync to pull transactions from your connected accounts.
        </p>
      </div>
    )
  }

  return (
    <DataTable
      columns={columns}
      data={transactions}
      keyField="id"
      pageSize={20}
    />
  )
}
