'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  toast,
} from '@0ne/ui'
import { AppShell } from '@/components/shell'
import { DataTable, type Column } from '@/features/kpi/components/DataTable'
import { Loader2, Landmark, Trash2 } from 'lucide-react'
import { PlaidLinkButton } from '@/features/personal/components/PlaidLinkButton'
import { AccountCard } from '@/features/personal/components/AccountCard'
import { TransactionList } from '@/features/personal/components/TransactionList'
import { SyncButton } from '@/features/personal/components/SyncButton'
import { usePlaidAccounts, unlinkItem } from '@/features/personal/hooks/use-plaid-accounts'

interface CategoryMapping {
  id: string
  plaidPrimary: string
  plaidDetailed: string | null
  expenseCategorySlug: string
}

export default function IntegrationsPage() {
  const { items, isLoading, refetch, hasAccounts } = usePlaidAccounts()
  const [mappings, setMappings] = useState<CategoryMapping[]>([])
  const [isMappingsLoading, setIsMappingsLoading] = useState(false)

  // Get latest sync time across all items
  const lastSyncedAt = items.reduce<string | null>((latest, item) => {
    if (!item.lastSyncedAt) return latest
    if (!latest) return item.lastSyncedAt
    return item.lastSyncedAt > latest ? item.lastSyncedAt : latest
  }, null)

  const fetchMappings = useCallback(async () => {
    setIsMappingsLoading(true)
    try {
      const response = await fetch('/api/personal/banking/category-mappings')
      const data = await response.json()
      setMappings(data.mappings || [])
    } catch (error) {
      console.error('Error fetching mappings:', error)
    } finally {
      setIsMappingsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (hasAccounts) {
      fetchMappings()
    }
  }, [hasAccounts, fetchMappings])

  const handleUnlink = async (itemId: string) => {
    try {
      const result = await unlinkItem(itemId)
      if (result.success) {
        toast.success('Account unlinked successfully')
        refetch()
      } else {
        throw new Error(result.error || 'Failed to unlink account')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to unlink account')
    }
  }

  const handleDeleteMapping = async (id: string) => {
    try {
      const response = await fetch(`/api/personal/banking/category-mappings?id=${id}`, {
        method: 'DELETE',
      })
      const data = await response.json()
      if (data.success) {
        toast.success('Mapping deleted')
        fetchMappings()
      } else {
        throw new Error(data.error)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete mapping')
    }
  }

  const mappingColumns: Column<CategoryMapping>[] = [
    {
      key: 'plaidPrimary',
      header: 'Plaid Category',
      render: (value) => (
        <span className="font-medium">{(value as string).replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'plaidDetailed',
      header: 'Detailed',
      render: (value) => value ? (
        <span className="text-xs text-muted-foreground">{(value as string).replace(/_/g, ' ')}</span>
      ) : (
        <span className="text-xs text-muted-foreground">—</span>
      ),
    },
    {
      key: 'expenseCategorySlug',
      header: 'Maps To',
      render: (value) => (
        <span className="capitalize font-medium">{(value as string).replace(/_/g, ' ')}</span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right' as const,
      sortable: false,
      render: (_, row) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDeleteMapping(row.id)}
          className="text-red-500 hover:text-red-700 hover:bg-red-50"
          title="Delete mapping"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ]

  return (
    <AppShell title="0ne">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
            <p className="text-sm text-muted-foreground">
              Connect external services and manage account settings
            </p>
          </div>
          <PlaidLinkButton onSuccess={refetch} />
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAccounts ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <Landmark className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-medium">No bank accounts connected</h3>
              <p className="text-sm text-muted-foreground mt-1 mb-4 max-w-sm">
                Connect your bank accounts via Plaid to auto-import transactions and track balances across personal and business apps.
              </p>
              <PlaidLinkButton onSuccess={refetch} />
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="accounts">
            <TabsList>
              <TabsTrigger value="accounts">Accounts</TabsTrigger>
              <TabsTrigger value="transactions">Transactions</TabsTrigger>
              <TabsTrigger value="mappings">Category Mappings</TabsTrigger>
            </TabsList>

            {/* Accounts Tab */}
            <TabsContent value="accounts" className="mt-4 space-y-4">
              <p className="text-sm text-muted-foreground">
                Use the eye icon to show/hide accounts. Assign each account as Personal or Business to control which app sees it.
              </p>
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((item) => (
                  <AccountCard
                    key={item.id}
                    item={item}
                    onUnlink={handleUnlink}
                    onAccountUpdate={refetch}
                  />
                ))}
              </div>
            </TabsContent>

            {/* Transactions Tab */}
            <TabsContent value="transactions" className="space-y-4 mt-4">
              <div className="flex justify-end">
                <SyncButton lastSyncedAt={lastSyncedAt} onSyncComplete={refetch} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Transactions</CardTitle>
                  <CardDescription>
                    Bank transactions synced from your connected accounts
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <TransactionList />
                </CardContent>
              </Card>
            </TabsContent>

            {/* Category Mappings Tab */}
            <TabsContent value="mappings" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle>Category Mappings</CardTitle>
                  <CardDescription>
                    Map Plaid transaction categories to your expense categories for auto-import
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {isMappingsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : mappings.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">
                      No category mappings configured.
                    </p>
                  ) : (
                    <DataTable
                      columns={mappingColumns}
                      data={mappings}
                      keyField="id"
                      paginated={false}
                    />
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </AppShell>
  )
}
