'use client'

import { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Switch,
  cn,
  toast,
} from '@0ne/ui'
import { AppShell } from '@/components/shell'
import { FilterBar } from '@/features/kpi/components/FilterBar'
import { DataTable, type Column } from '@/features/kpi/components/DataTable'
import { MetricCard } from '@/features/kpi/components/MetricCard'
import { TrendChart } from '@/features/kpi/charts/TrendChart'
import { usePersistedFilters } from '@/features/kpi/hooks/use-persisted-filters'
import { useExpensesData, addExpense, updateExpense, deleteExpense, type ExpenseCategory } from '@/features/kpi/hooks/use-kpi-data'
import { Plus, DollarSign, TrendingUp, PiggyBank, Target, Pencil, Trash2, Loader2, Lock, Zap, Palette, Receipt } from 'lucide-react'
import { CategoryDialog } from '@/features/kpi/components/CategoryDialog'
import { ExpenseDialog, type ExpenseFormData } from '@/features/kpi/components/ExpenseDialog'
import {
  useExpenseCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  type ExpenseCategoryData,
} from '@/features/kpi/hooks/use-expense-categories'

interface Expense {
  id: string
  name: string
  category: string
  amount: number
  frequency: 'monthly' | 'annual' | 'one_time'
  isActive: boolean
  isSystem?: boolean
  startDate?: string
}


// Helper to generate light background from hex color
function hexToLightBg(hex: string): string {
  // Convert hex to RGB, then create a light tinted background
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  // Return rgba with low opacity for background
  return `rgba(${r}, ${g}, ${b}, 0.15)`
}

// Color mapping for category visualization
const categoryDisplayColors: Record<string, string> = {
  'facebook ads': '#1877F2', // Facebook blue
  'facebook_ads': '#1877F2',
  marketing: '#22c55e',
  advertising: '#22c55e',
  labor: '#3b82f6',
  software: '#8b5cf6',
  operations: '#f59e0b',
}

const createExpenseColumns = (
  onToggleActive: (id: string, isActive: boolean) => void,
  onEdit: (expense: Expense) => void,
  onDelete: (id: string) => void,
  togglingIds: Set<string>,
  categoryColorMap: Record<string, string>
): Column<Expense>[] => [
  {
    key: 'name',
    header: 'Name',
    render: (value, row) => (
      <div className="flex items-center gap-2">
        <span className="font-medium">{value as string}</span>
        {row.isSystem && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="Auto-synced from Meta API">
            <Zap className="h-3 w-3" />
          </span>
        )}
      </div>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    render: (value) => {
      const categoryName = value as string
      const color = categoryColorMap[categoryName.toLowerCase()] || '#6b7280'
      return (
        <span
          className="inline-flex rounded-full px-2 py-1 text-xs font-medium"
          style={{
            backgroundColor: hexToLightBg(color),
            color: color,
          }}
        >
          {categoryName}
        </span>
      )
    },
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    render: (value, row) => row.isSystem
      ? <span className="text-muted-foreground italic">Auto</span>
      : `$${(value as number).toLocaleString()}`,
  },
  {
    key: 'frequency',
    header: 'Frequency',
    render: (value, row) => row.isSystem
      ? <span className="text-muted-foreground italic">Auto</span>
      : <span className="capitalize">{(value as string).replace('_', ' ')}</span>,
  },
  {
    key: 'isActive',
    header: 'Active',
    align: 'center',
    sortable: false,
    render: (value, row) => {
      // System expenses are always active and show a lock icon
      if (row.isSystem) {
        return (
          <div className="flex justify-center">
            <div className="relative">
              <Switch checked={true} disabled title="System expenses are always active" />
              <Lock className="h-3 w-3 text-muted-foreground absolute -right-4 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        )
      }
      const isToggling = togglingIds.has(row.id)
      return (
        <div className="flex justify-center">
          <Switch
            checked={value as boolean}
            disabled={isToggling}
            onCheckedChange={(checked) => {
              onToggleActive(row.id, checked)
            }}
            title={value ? 'Click to deactivate' : 'Click to activate'}
          />
        </div>
      )
    },
  },
  {
    key: 'actions',
    header: '',
    align: 'right',
    sortable: false,
    render: (_, row) => {
      // System expenses cannot be edited or deleted
      if (row.isSystem) {
        return null
      }
      return (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit(row)
            }}
            title="Edit expense"
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(row.id)
            }}
            className="text-red-500 hover:text-red-700 hover:bg-red-50"
            title="Delete expense"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      )
    },
  },
]

export default function ExpensesPage() {
  // Use persisted filters (shared across all KPI pages)
  const {
    period,
    dateRange,
    sources,
    isLoaded,
    hasActiveFilters,
    setPeriod,
    setDateRange,
    setSources,
    resetFilters,
  } = usePersistedFilters()

  // Fetch expenses data from API
  const { data: expensesData, isLoading: isExpensesLoading, refetch } = useExpensesData({
    dateRange,
    period,
  })

  // Fetch expense categories
  const {
    categories: expenseCategoryList,
    isLoading: isCategoriesLoading,
    refetch: refetchCategories,
  } = useExpenseCategories()

  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ExpenseFormData | null>(null)
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ExpenseCategoryData | null>(null)
  const [isSavingCategory, setIsSavingCategory] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Use expenses from API, fallback to empty array
  const expenses: Expense[] = expensesData?.expenses || []

  // Handle saving expense (add or edit)
  const handleSaveExpense = async (formData: ExpenseFormData) => {
    setIsSavingExpense(true)
    try {
      const category = formData.category === 'other' ? formData.customCategory || '' : formData.category
      const isEdit = !!formData.id

      if (isEdit) {
        // Update existing expense
        const result = await updateExpense({
          id: formData.id!,
          description: formData.name,
          amount: parseFloat(formData.amount),
          category,
          frequency: formData.frequency,
        })

        if (result.success) {
          refetch()
        } else {
          throw new Error(result.error || 'Failed to update expense')
        }
      } else {
        // Add new expense - use local date (not UTC) to avoid timezone issues
        const today = new Date()
        const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
        const result = await addExpense({
          description: formData.name,
          amount: parseFloat(formData.amount),
          category,
          expense_date: localDate,
        })

        if (result.success) {
          refetch()
        } else {
          throw new Error(result.error || 'Failed to add expense')
        }
      }

      setIsExpenseDialogOpen(false)
      setEditingExpense(null)
      toast.success(isEdit ? 'Expense updated successfully' : 'Expense added successfully')
    } catch (error) {
      console.error('Error saving expense:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to save expense')
    } finally {
      setIsSavingExpense(false)
    }
  }

  // Open dialog to add new expense
  const handleAddExpense = () => {
    setEditingExpense(null)
    setIsExpenseDialogOpen(true)
  }

  // Open dialog to edit existing expense
  const handleEditExpense = (expense: Expense) => {
    setEditingExpense({
      id: expense.id,
      name: expense.name,
      category: expense.category,
      amount: String(expense.amount),
      frequency: expense.frequency,
    })
    setIsExpenseDialogOpen(true)
  }

  const handleDeleteExpense = async (id: string) => {
    try {
      const result = await deleteExpense(id)
      if (result.success) {
        toast.success('Expense deleted successfully')
        refetch()
      } else {
        throw new Error(result.error || 'Failed to delete expense')
      }
    } catch (error) {
      console.error('Error deleting expense:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to delete expense')
    }
  }

  const handleToggleActive = async (id: string, isActive: boolean) => {
    // Add to toggling set for loading state
    setTogglingIds((prev) => new Set(prev).add(id))

    try {
      const response = await fetch('/api/kpi/expenses', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, is_active: isActive }),
      })

      const result = await response.json()

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to update expense')
      }

      // Refetch data on success
      refetch()
      toast.success(`Expense ${isActive ? 'activated' : 'deactivated'}`)
    } catch (error) {
      console.error('Error toggling expense:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update expense')
    } finally {
      // Remove from toggling set
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  // Category handlers
  const handleSaveCategory = async (data: { name: string; color?: string; description?: string }) => {
    setIsSavingCategory(true)
    try {
      if (editingCategory) {
        const result = await updateCategory({
          id: editingCategory.id,
          ...data,
        })
        if (!result.success) {
          throw new Error(result.error)
        }
        toast.success('Category updated successfully')
      } else {
        const result = await createCategory(data)
        if (!result.success) {
          throw new Error(result.error)
        }
        toast.success('Category created successfully')
      }
      refetchCategories()
      setIsCategoryDialogOpen(false)
      setEditingCategory(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save category')
    } finally {
      setIsSavingCategory(false)
    }
  }

  const handleEditCategory = (category: ExpenseCategoryData) => {
    setEditingCategory(category)
    setIsCategoryDialogOpen(true)
  }

  const handleDeleteCategory = async (id: string) => {
    setDeletingCategoryId(id)
    try {
      const result = await deleteCategory(id)
      if (!result.success) {
        toast.error(result.error || 'Failed to delete category')
      } else {
        toast.success('Category deleted successfully')
        refetchCategories()
      }
    } finally {
      setDeletingCategoryId(null)
    }
  }

  const handleAddCategory = () => {
    setEditingCategory(null)
    setIsCategoryDialogOpen(true)
  }

  // Use API data when available - pull from categories for accurate totals
  const totalMonthly = expensesData?.summary.totalExpenses ?? 0

  // Get Facebook Ads total from categories (case-insensitive match)
  const facebookAdsCategory = expensesData?.categories?.find(
    c => c.name.toLowerCase() === 'facebook ads'
  )
  const totalFacebookAds = facebookAdsCategory?.amount ?? 0

  // Get Labor total from categories (case-insensitive match)
  const laborCategory = expensesData?.categories?.find(
    c => c.name.toLowerCase() === 'labor'
  )
  const totalLabor = laborCategory?.amount ?? 0

  const totalRevenue = 47250 // From sample data - would come from revenue API
  const roi = totalMonthly > 0 ? totalRevenue / totalMonthly : 0

  // Build category color map from loaded categories
  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    expenseCategoryList.forEach(cat => {
      if (cat.color) {
        map[cat.name.toLowerCase()] = cat.color
      }
    })
    return map
  }, [expenseCategoryList])

  const expenseColumns = useMemo(
    () => createExpenseColumns(handleToggleActive, handleEditExpense, handleDeleteExpense, togglingIds, categoryColorMap),
    [expenses, togglingIds, categoryColorMap]
  )

  // Prepare trend data from API
  const spendTrendData = useMemo(() => {
    if (expensesData?.monthly && expensesData.monthly.length > 0) {
      return expensesData.monthly.map((d) => ({
        date: d.month,
        advertising: d.ads,
        tools: d.tools,
        content: d.content,
        team: d.team,
      }))
    }
    // Fallback sample data
    return [
      { date: '2025-09', advertising: 2400, tools: 850, content: 1100, team: 3500 },
      { date: '2025-10', advertising: 2800, tools: 860, content: 1150, team: 3500 },
      { date: '2025-11', advertising: 3200, tools: 870, content: 1200, team: 3500 },
      { date: '2025-12', advertising: 3600, tools: 880, content: 1250, team: 3500 },
      { date: '2026-01', advertising: 4260, tools: 890, content: 1200, team: 3500 },
    ]
  }, [expensesData?.monthly])

  // Prepare categories from API
  const displayCategories: ExpenseCategory[] = useMemo(() => {
    if (expensesData?.categories && expensesData.categories.length > 0) {
      return expensesData.categories
    }
    // Fallback sample data
    return [
      { id: 'facebook_ads', name: 'Facebook Ads', amount: 4260, change: 18.3, trend: 'up' as const, isSystem: true },
      { id: 'tools', name: 'Software/Tools', amount: 890, change: 2.1, trend: 'neutral' as const },
      { id: 'content', name: 'Content Creation', amount: 1200, change: -5.0, trend: 'down' as const },
      { id: 'team', name: 'Team/Contractors', amount: 3500, change: 0, trend: 'neutral' as const },
    ]
  }, [expensesData?.categories])

  // Channel data from API
  const channelData = useMemo(() => {
    if (expensesData?.byChannel && expensesData.byChannel.length > 0) {
      return expensesData.byChannel.map((c, i) => ({
        id: String(i + 1),
        channel: c.channel,
        spend: c.spend,
        leads: c.leads,
        cpl: c.cpl,
        clients: c.clients,
        cac: c.cpc,
        roi: c.leads > 0 && c.spend > 0 ? (c.leads * 100) / c.spend : 0,
      }))
    }
    // Fallback sample data
    return [
      { id: '1', channel: 'Facebook Ads', spend: 2800, leads: 180, cpl: 15.56, clients: 8, cac: 350, roi: 2.4 },
      { id: '2', channel: 'Google Ads', spend: 960, leads: 85, cpl: 11.29, clients: 4, cac: 240, roi: 3.1 },
    ]
  }, [expensesData?.byChannel])

  const channelColumns: Column<(typeof channelData)[0]>[] = [
    {
      key: 'channel',
      header: 'Channel',
      render: (value) => <span className="font-medium">{value as string}</span>,
    },
    {
      key: 'spend',
      header: 'Spend',
      align: 'right',
      render: (value) => `$${(value as number).toLocaleString()}`,
    },
    {
      key: 'leads',
      header: 'Leads',
      align: 'right',
      render: (value) => (value as number).toLocaleString(),
    },
    {
      key: 'cpl',
      header: 'CPL',
      align: 'right',
      render: (value) => (value as number > 0 ? `$${(value as number).toFixed(2)}` : '-'),
    },
    {
      key: 'clients',
      header: 'Clients',
      align: 'right',
      render: (value) => (value as number).toLocaleString(),
    },
    {
      key: 'cac',
      header: 'CAC',
      align: 'right',
      render: (value) => (value as number > 0 ? `$${(value as number).toLocaleString()}` : '-'),
    },
    {
      key: 'roi',
      header: 'ROI',
      align: 'right',
      render: (value) => {
        const roiValue = value as number
        if (roiValue === Infinity) return <span className="text-green-600 font-medium">∞</span>
        return <span className={cn(roiValue >= 2 ? 'text-green-600' : 'text-amber-600')}>{roiValue.toFixed(1)}x</span>
      },
    },
  ]

  if (!isLoaded) {
    return (
      <AppShell title="KPI Dashboard" appId="kpi">
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell title="KPI Dashboard" appId="kpi">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Expenses & ROI</h1>
            <p className="text-sm text-muted-foreground">
              Track spending, cost per acquisition, and return on investment
            </p>
          </div>
          <Button onClick={handleAddExpense}>
            <Plus className="mr-2 h-4 w-4" />
            Add Expense
          </Button>
        </div>

        {/* Filters */}
        <FilterBar
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onPeriodChange={setPeriod}
          period={period}
          sources={sources}
          onSourcesChange={setSources}
          showSourceFilter
          hasActiveFilters={hasActiveFilters}
          onReset={resetFilters}
        />

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Monthly Total"
            value={`$${totalMonthly.toLocaleString()}`}
            change={5.2}
            trend="up"
            icon={DollarSign}
            positiveIsGood={false}
          />
          <MetricCard
            title="Facebook Ads"
            value={`$${totalFacebookAds.toLocaleString()}`}
            change={facebookAdsCategory?.change ?? 0}
            trend={facebookAdsCategory?.trend === 'up' ? 'up' : facebookAdsCategory?.trend === 'down' ? 'down' : 'neutral'}
            icon={Target}
            positiveIsGood={false}
            description={facebookAdsCategory?.isSystem ? 'Auto-synced from Meta' : undefined}
          />
          <MetricCard
            title="Labor Costs"
            value={`$${totalLabor.toLocaleString()}`}
            change={laborCategory?.change ?? 0}
            trend={laborCategory?.trend === 'up' ? 'up' : laborCategory?.trend === 'down' ? 'down' : 'neutral'}
            icon={PiggyBank}
          />
          <MetricCard
            title="Overall ROI"
            value={`${roi.toFixed(1)}x`}
            change={8.3}
            trend="up"
            icon={TrendingUp}
          />
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="channels">By Channel</TabsTrigger>
            <TabsTrigger value="all">All Expenses</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Category Breakdown */}
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Spend by Category</CardTitle>
                  <CardDescription>Breakdown by expense type</CardDescription>
                </CardHeader>
                <CardContent>
                  {isExpensesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {displayCategories.map((cat) => (
                        <div key={cat.id} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{cat.name}</span>
                              {cat.isSystem && (
                                <span className="inline-flex items-center gap-1 text-xs text-blue-600" title="Auto-synced from Meta API">
                                  <Zap className="h-3 w-3" />
                                  <span>Auto</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span>${cat.amount.toLocaleString()}</span>
                              <span
                                className={cn(
                                  'text-xs',
                                  cat.trend === 'up' && 'text-red-500',
                                  cat.trend === 'down' && 'text-green-600',
                                  cat.trend === 'neutral' && 'text-muted-foreground'
                                )}
                              >
                                {cat.change > 0 ? '+' : ''}
                                {cat.change}%
                              </span>
                            </div>
                          </div>
                          <div className="h-2 w-full rounded-full bg-muted">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${totalMonthly > 0 ? (cat.amount / totalMonthly) * 100 : 0}%`,
                                backgroundColor: cat.color || categoryDisplayColors[cat.id.toLowerCase()] || categoryDisplayColors[cat.name.toLowerCase()] || '#FF692D',
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Cost Metrics</CardTitle>
                  <CardDescription>Key acquisition costs</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Cost Per Lead</div>
                        <div className="text-2xl font-bold">${expensesData?.summary.costPerLead?.toFixed(2) ?? '12.45'}</div>
                      </div>
                      <span className="text-sm text-green-600">-12.3% vs last month</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Cost Per Hand Raiser</div>
                        <div className="text-2xl font-bold">$34.60</div>
                      </div>
                      <span className="text-sm text-green-600">-8.1% vs last month</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">Customer Acquisition Cost</div>
                        <div className="text-2xl font-bold">${expensesData?.summary.costPerClient?.toFixed(2) ?? '152.30'}</div>
                      </div>
                      <span className="text-sm text-red-500">+5.0% vs last month</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Spend Trend Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Spend Over Time</CardTitle>
                <CardDescription>Monthly spend by category</CardDescription>
              </CardHeader>
              <CardContent>
                <TrendChart
                  data={spendTrendData}
                  lines={[
                    { key: 'advertising', color: '#1877F2', label: 'Facebook Ads' },
                    { key: 'team', color: '#3b82f6', label: 'Team' },
                    { key: 'content', color: '#f59e0b', label: 'Content' },
                    { key: 'tools', color: '#8b5cf6', label: 'Tools' },
                  ]}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Channels Tab */}
          <TabsContent value="channels" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Channel Performance</CardTitle>
                <CardDescription>Spend, leads, and ROI by acquisition channel</CardDescription>
              </CardHeader>
              <CardContent>
                {isExpensesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <DataTable
                    columns={channelColumns}
                    data={channelData}
                    keyField="id"
                    paginated={false}
                  />
                )}
              </CardContent>
            </Card>

            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Best Performing Channel</CardTitle>
                  <CardDescription>By ROI</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">Organic/SEO</span>
                      <span className="text-lg text-green-600 font-medium">∞ ROI</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      35 leads, 14 clients at $0 spend
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Lowest CPL Channel</CardTitle>
                  <CardDescription>Best cost efficiency</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold">Google Ads</span>
                      <span className="text-lg text-blue-600 font-medium">$11.29 CPL</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      85 leads from $960 spend
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* All Expenses Tab */}
          <TabsContent value="all" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Expenses</CardTitle>
                <CardDescription>
                  Manage your recurring and one-time expenses.
                  <span className="inline-flex items-center gap-1 ml-2 text-blue-600">
                    <Zap className="h-3 w-3" />
                    Auto-synced expenses
                  </span>
                  {' '}cannot be deleted.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isExpensesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : expenses.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Receipt className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No expenses yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 mb-4">
                      Track your business costs by adding your first expense.
                    </p>
                    <Button onClick={handleAddExpense}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Expense
                    </Button>
                  </div>
                ) : (
                  <DataTable
                    columns={expenseColumns}
                    data={expenses}
                    keyField="id"
                    pageSize={10}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Categories Tab */}
          <TabsContent value="categories" className="mt-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>Expense Categories</CardTitle>
                  <CardDescription>
                    Manage categories used to organize your expenses.
                    <span className="inline-flex items-center gap-1 ml-2 text-blue-600">
                      <Lock className="h-3 w-3" />
                      System categories
                    </span>
                    {' '}cannot be deleted.
                  </CardDescription>
                </div>
                <Button onClick={handleAddCategory}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Category
                </Button>
              </CardHeader>
              <CardContent>
                {isCategoriesLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : expenseCategoryList.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <Palette className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No categories yet</h3>
                    <p className="text-sm text-muted-foreground mt-1 mb-4">
                      Create your first category to organize expenses.
                    </p>
                    <Button onClick={handleAddCategory}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add Category
                    </Button>
                  </div>
                ) : (
                  <DataTable
                    columns={[
                      {
                        key: 'name',
                        header: 'Name',
                        render: (value, row) => (
                          <div className="flex items-center gap-2">
                            <div
                              className="h-3 w-3 rounded-full shrink-0"
                              style={{ backgroundColor: row.color || '#6b7280' }}
                            />
                            <span className="font-medium">{value as string}</span>
                            {row.isSystem && (
                              <span title="System category">
                                <Lock className="h-3 w-3 text-blue-600" />
                              </span>
                            )}
                          </div>
                        ),
                      },
                      {
                        key: 'description',
                        header: 'Description',
                        render: (value) => (
                          <span className="text-muted-foreground">{(value as string) || '-'}</span>
                        ),
                      },
                      {
                        key: 'expenseCount',
                        header: 'Expenses',
                        align: 'right',
                        render: (value) => value as number,
                      },
                      {
                        key: 'actions',
                        header: '',
                        align: 'right',
                        sortable: false,
                        render: (_, row) => (
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditCategory(row)}
                              title="Edit category"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            {!row.isSystem && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDeleteCategory(row.id)}
                                disabled={deletingCategoryId === row.id}
                                className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                title="Delete category"
                              >
                                {deletingCategoryId === row.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </Button>
                            )}
                          </div>
                        ),
                      },
                    ]}
                    data={expenseCategoryList}
                    keyField="id"
                    paginated={false}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Category Dialog */}
        <CategoryDialog
          open={isCategoryDialogOpen}
          onOpenChange={(open) => {
            setIsCategoryDialogOpen(open)
            if (!open) setEditingCategory(null)
          }}
          category={editingCategory}
          onSave={handleSaveCategory}
          isSaving={isSavingCategory}
        />

        {/* Expense Dialog (Add/Edit) */}
        <ExpenseDialog
          open={isExpenseDialogOpen}
          onOpenChange={(open) => {
            setIsExpenseDialogOpen(open)
            if (!open) setEditingExpense(null)
          }}
          expense={editingExpense}
          onSave={handleSaveExpense}
          isSaving={isSavingExpense}
          categories={expenseCategoryList.map(c => c.name)}
        />
      </div>
    </AppShell>
  )
}
