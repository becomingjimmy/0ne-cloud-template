'use client'

import { useState, useMemo } from 'react'
import { startOfMonth } from 'date-fns'
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
import { ExpenseDialog, type ExpenseFormData } from '@/features/personal/components/ExpenseDialog'
import { CategoryDialog } from '@/features/personal/components/CategoryDialog'
import {
  usePersonalExpenses,
  addPersonalExpense,
  updatePersonalExpense,
  deletePersonalExpense,
  togglePersonalExpense,
  type PersonalExpenseItem,
} from '@/features/personal/hooks/use-personal-expenses'
import {
  usePersonalExpenseCategories,
  createPersonalCategory,
  updatePersonalCategory,
  deletePersonalCategory,
  type PersonalExpenseCategoryData,
} from '@/features/personal/hooks/use-personal-expense-categories'
import {
  Plus,
  DollarSign,
  Wallet,
  Tag,
  Pencil,
  Trash2,
  Loader2,
  Palette,
  Receipt,
  CalendarDays,
  Clock,
  ArrowRightCircle,
  CheckCircle2,
  ArrowDownUp,
} from 'lucide-react'
import { usePlaidBalances } from '@/features/personal/hooks/use-plaid-balances'
import {
  usePlaidTransactions,
  promoteToExpense,
  type PlaidTransaction,
} from '@/features/personal/hooks/use-plaid-transactions'

// Helper to generate light background from hex color
function hexToLightBg(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, 0.15)`
}

const createExpenseColumns = (
  onToggleActive: (id: string, isActive: boolean) => void,
  onEdit: (expense: PersonalExpenseItem) => void,
  onDelete: (id: string) => void,
  togglingIds: Set<string>,
  categoryColorMap: Record<string, string>
): Column<PersonalExpenseItem>[] => [
  {
    key: 'name',
    header: 'Name',
    render: (value) => (
      <span className="font-medium">{value as string}</span>
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
    align: 'right' as const,
    render: (value) => `$${(value as number).toLocaleString()}`,
  },
  {
    key: 'frequency',
    header: 'Frequency',
    render: (value) => (
      <span className="capitalize">{(value as string).replace('_', ' ')}</span>
    ),
  },
  {
    key: 'isActive',
    header: 'Active',
    align: 'center' as const,
    sortable: false,
    render: (value, row) => {
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
    align: 'right' as const,
    sortable: false,
    render: (_, row) => (
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
    ),
  },
]

export default function PersonalExpensesPage() {
  // Local filter state (separate from KPI filters)
  const [period, setPeriod] = useState('mtd')
  const [dateRange, setDateRange] = useState<{ from: Date; to: Date }>({
    from: startOfMonth(new Date()),
    to: new Date(),
  })

  // Fetch personal expenses data from API
  const { data: expensesData, isLoading: isExpensesLoading, refetch } = usePersonalExpenses({
    dateRange,
    period,
  })

  // Fetch personal expense categories
  const {
    categories: expenseCategoryList,
    isLoading: isCategoriesLoading,
    refetch: refetchCategories,
  } = usePersonalExpenseCategories()

  const { summary: balanceSummary } = usePlaidBalances({ scope: 'personal' })

  // Fetch all bank transactions from personal-scoped accounts
  const [txnPage, setTxnPage] = useState(1)
  const [txnSearch, setTxnSearch] = useState('')
  const {
    transactions: bankTransactions,
    total: bankTxnTotal,
    isLoading: isTxnLoading,
    refetch: refetchTxns,
  } = usePlaidTransactions({
    scope: 'personal',
    search: txnSearch || null,
    page: txnPage,
    limit: 20,
  })
  const [promotingIds, setPromotingIds] = useState<Set<string>>(new Set())

  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ExpenseFormData | null>(null)
  const [isSavingExpense, setIsSavingExpense] = useState(false)
  const [isCategoryDialogOpen, setIsCategoryDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<PersonalExpenseCategoryData | null>(null)
  const [isSavingCategory, setIsSavingCategory] = useState(false)
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Use expenses from API, fallback to empty array
  const expenses: PersonalExpenseItem[] = expensesData?.expenses || []

  // Handle saving expense (add or edit)
  const handleSaveExpense = async (formData: ExpenseFormData) => {
    setIsSavingExpense(true)
    try {
      const category = formData.category === 'other' ? formData.customCategory || '' : formData.category
      const isEdit = !!formData.id

      if (isEdit) {
        const result = await updatePersonalExpense({
          id: formData.id!,
          description: formData.name,
          amount: parseFloat(formData.amount),
          category,
          frequency: formData.frequency,
          notes: formData.notes,
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
        const result = await addPersonalExpense({
          description: formData.name,
          amount: parseFloat(formData.amount),
          category,
          expense_date: localDate,
          frequency: formData.frequency,
          notes: formData.notes,
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
  const handleEditExpense = (expense: PersonalExpenseItem) => {
    setEditingExpense({
      id: expense.id,
      name: expense.name,
      category: expense.category,
      amount: String(expense.amount),
      frequency: expense.frequency as 'monthly' | 'annual' | 'one_time',
      notes: expense.notes || '',
    })
    setIsExpenseDialogOpen(true)
  }

  const handleDeleteExpense = async (id: string) => {
    try {
      const result = await deletePersonalExpense(id)
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
    setTogglingIds((prev) => new Set(prev).add(id))

    try {
      const result = await togglePersonalExpense(id, isActive)

      if (!result.success) {
        throw new Error(result.error || 'Failed to update expense')
      }

      refetch()
      toast.success(`Expense ${isActive ? 'activated' : 'deactivated'}`)
    } catch (error) {
      console.error('Error toggling expense:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to update expense')
    } finally {
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
        const result = await updatePersonalCategory({
          id: editingCategory.id,
          ...data,
        })
        if (!result.success) {
          throw new Error(result.error)
        }
        toast.success('Category updated successfully')
      } else {
        const result = await createPersonalCategory(data)
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

  const handleEditCategory = (category: PersonalExpenseCategoryData) => {
    setEditingCategory(category)
    setIsCategoryDialogOpen(true)
  }

  const handleDeleteCategory = async (id: string) => {
    setDeletingCategoryId(id)
    try {
      const result = await deletePersonalCategory(id)
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

  // Promote a bank transaction to a tracked expense
  const handlePromoteTransaction = async (txn: PlaidTransaction) => {
    setPromotingIds((prev) => new Set(prev).add(txn.id))
    try {
      const result = await promoteToExpense(txn.id)
      if (result.success) {
        toast.success('Transaction added to expenses')
        refetchTxns()
        refetch() // refresh expenses too
      } else {
        throw new Error(result.error || 'Failed to add to expenses')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add to expenses')
    } finally {
      setPromotingIds((prev) => {
        const next = new Set(prev)
        next.delete(txn.id)
        return next
      })
    }
  }

  // Summary data
  const totalExpenses = expensesData?.summary.totalExpenses ?? 0
  const monthlyBurnRate = expensesData?.summary.monthlyBurnRate ?? 0

  // Cash on hand from cached Plaid balances (depository accounts only)
  const cashOnHand = balanceSummary
    ? balanceSummary.totalChecking + balanceSummary.totalSavings
    : 0
  const hasCash = balanceSummary && cashOnHand > 0
  const dailyBurnRate = monthlyBurnRate / 30
  const runwayDays = dailyBurnRate > 0 ? cashOnHand / dailyBurnRate : 0
  const runwayMonths = monthlyBurnRate > 0 ? cashOnHand / monthlyBurnRate : 0

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handlers are stable enough; togglingIds/categoryColorMap drive re-render
    [togglingIds, categoryColorMap]
  )

  // Display categories from API
  const displayCategories = expensesData?.categories || []

  // Prepare trend data from API monthly data
  const { trendData, trendLines } = useMemo(() => {
    if (!expensesData?.monthly || expensesData.monthly.length === 0 || !expensesData.categories) {
      return { trendData: [], trendLines: [] }
    }

    // Take top 4 categories by spend for the trend chart
    const topCategories = expensesData.categories.slice(0, 4)

    const lines = topCategories.map(cat => ({
      key: cat.name.toLowerCase().replace(/\s+/g, '_'),
      color: cat.color,
      label: cat.name,
    }))

    const data = expensesData.monthly.map(m => ({
      date: m.month,
      ...Object.fromEntries(
        Object.entries(m.byCategory).map(([cat, amount]) => [
          cat.toLowerCase().replace(/\s+/g, '_'),
          amount
        ])
      ),
    }))

    return { trendData: data, trendLines: lines }
  }, [expensesData?.monthly, expensesData?.categories])

  // Check if filters differ from defaults
  const hasActiveFilters = period !== 'mtd'

  const handleResetFilters = () => {
    setPeriod('mtd')
    setDateRange({
      from: startOfMonth(new Date()),
      to: new Date(),
    })
  }

  return (
    <AppShell title="Personal" appId="personal">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Personal Expenses</h1>
            <p className="text-sm text-muted-foreground">
              Track your personal spending and monthly burn rate
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
          showSourceFilter={false}
          hasActiveFilters={hasActiveFilters}
          onReset={handleResetFilters}
        />

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Cash On Hand"
            value={hasCash ? `$${cashOnHand.toLocaleString()}` : '—'}
            icon={DollarSign}
            description={hasCash ? 'Available cash from connected accounts' : 'Connect a bank account'}
          />
          <MetricCard
            title="Burn Rate"
            value={`$${monthlyBurnRate.toLocaleString()}/mo`}
            icon={Wallet}
            description="Total monthly expenses"
          />
          <MetricCard
            title="Runway In Days"
            value={hasCash && dailyBurnRate > 0 ? runwayDays.toFixed(2) : '—'}
            icon={CalendarDays}
            description={hasCash && dailyBurnRate > 0 ? 'Days until $0' : 'Needs cash + expenses'}
          />
          <MetricCard
            title="Runway In Months"
            value={hasCash && monthlyBurnRate > 0 ? runwayMonths.toFixed(2) : '—'}
            icon={Clock}
            description={hasCash && monthlyBurnRate > 0 ? 'Months until $0' : 'Needs cash + expenses'}
          />
        </div>

        {/* Tabs for different views */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="all">All Expenses</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
            <TabsTrigger value="transactions">All Transactions</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* Category Breakdown */}
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
                ) : displayCategories.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Tag className="h-8 w-8 text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No expense data for this period. Add expenses to see the breakdown.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {displayCategories.map((cat) => (
                      <div key={cat.id} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{cat.name}</span>
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
                              width: `${totalExpenses > 0 ? (cat.amount / totalExpenses) * 100 : 0}%`,
                              backgroundColor: cat.color || '#FF692D',
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Spend Trend Chart */}
            {trendData.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Spend Over Time</CardTitle>
                  <CardDescription>Monthly spend by category</CardDescription>
                </CardHeader>
                <CardContent>
                  <TrendChart
                    data={trendData}
                    lines={trendLines}
                    formatValue={(v) => `$${v.toLocaleString()}`}
                  />
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* All Expenses Tab */}
          <TabsContent value="all" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Expenses</CardTitle>
                <CardDescription>
                  Manage your recurring and one-time personal expenses.
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
                      Start tracking your personal spending by adding your first expense.
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
                    Manage categories used to organize your personal expenses.
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
                        key: 'expense_count',
                        header: 'Expenses',
                        align: 'right' as const,
                        render: (value) => value as number,
                      },
                      {
                        key: 'actions',
                        header: '',
                        align: 'right' as const,
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

          {/* All Transactions Tab */}
          <TabsContent value="transactions" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>All Transactions</CardTitle>
                <CardDescription>
                  Bank transactions from your personal accounts. Add transactions to &quot;All Expenses&quot; to track them in your burn rate.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {/* Search */}
                <div className="mb-4">
                  <input
                    type="text"
                    placeholder="Search transactions..."
                    value={txnSearch}
                    onChange={(e) => {
                      setTxnSearch(e.target.value)
                      setTxnPage(1)
                    }}
                    className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>

                {isTxnLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : bankTransactions.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <ArrowDownUp className="h-12 w-12 text-muted-foreground/50 mb-4" />
                    <h3 className="text-lg font-medium">No transactions</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      {txnSearch
                        ? 'No transactions match your search.'
                        : 'Connect a personal bank account and sync to see transactions here.'}
                    </p>
                  </div>
                ) : (
                  <>
                    <DataTable
                      columns={[
                        {
                          key: 'date',
                          header: 'Date',
                          render: (value) => (
                            <span className="text-sm tabular-nums">{value as string}</span>
                          ),
                        },
                        {
                          key: 'merchantName',
                          header: 'Name',
                          render: (value, row) => (
                            <div>
                              <span className="font-medium">
                                {(value as string) || (row as unknown as PlaidTransaction).name || 'Unknown'}
                              </span>
                              {(row as unknown as PlaidTransaction).isPending && (
                                <span className="ml-2 text-xs text-amber-600 font-medium">Pending</span>
                              )}
                            </div>
                          ),
                        },
                        {
                          key: 'amount',
                          header: 'Amount',
                          align: 'right' as const,
                          render: (value) => {
                            const amt = value as number
                            return (
                              <span className={cn('font-medium tabular-nums', amt > 0 ? 'text-red-600' : 'text-green-600')}>
                                {amt > 0 ? '-' : '+'}${Math.abs(amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </span>
                            )
                          },
                        },
                        {
                          key: 'accountName',
                          header: 'Account',
                          render: (value, row) => {
                            const txn = row as unknown as PlaidTransaction
                            return (
                              <span className="text-sm text-muted-foreground">
                                {(value as string) || 'Unknown'}{txn.accountMask ? ` ••${txn.accountMask}` : ''}
                              </span>
                            )
                          },
                        },
                        {
                          key: 'mappedCategory',
                          header: 'Category',
                          render: (value) => {
                            const cat = value as string | null
                            if (!cat) return <span className="text-muted-foreground">—</span>
                            const color = categoryColorMap[cat.toLowerCase()] || '#6b7280'
                            return (
                              <span
                                className="inline-flex rounded-full px-2 py-1 text-xs font-medium"
                                style={{ backgroundColor: hexToLightBg(color), color }}
                              >
                                {cat}
                              </span>
                            )
                          },
                        },
                        {
                          key: 'personalExpenseId',
                          header: '',
                          align: 'right' as const,
                          sortable: false,
                          render: (value, row) => {
                            const txn = row as unknown as PlaidTransaction
                            const isPromoted = !!value
                            const isPromoting = promotingIds.has(txn.id)

                            if (isPromoted) {
                              return (
                                <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Tracked
                                </span>
                              )
                            }

                            // Only show for money-out transactions (positive = money out in Plaid)
                            if (txn.amount <= 0) return null

                            return (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isPromoting}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handlePromoteTransaction(txn)
                                }}
                                className="text-primary hover:text-primary"
                                title="Add to tracked expenses (counts toward burn rate)"
                              >
                                {isPromoting ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <>
                                    <ArrowRightCircle className="h-4 w-4 mr-1" />
                                    <span className="text-xs">Add to Expenses</span>
                                  </>
                                )}
                              </Button>
                            )
                          },
                        },
                      ]}
                      data={bankTransactions}
                      keyField="id"
                      paginated={false}
                    />

                    {/* Pagination */}
                    {bankTxnTotal > 20 && (
                      <div className="flex items-center justify-between mt-4 pt-4 border-t">
                        <span className="text-sm text-muted-foreground">
                          Showing {(txnPage - 1) * 20 + 1}–{Math.min(txnPage * 20, bankTxnTotal)} of {bankTxnTotal}
                        </span>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={txnPage === 1}
                            onClick={() => setTxnPage((p) => p - 1)}
                          >
                            Previous
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={txnPage * 20 >= bankTxnTotal}
                            onClick={() => setTxnPage((p) => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
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
