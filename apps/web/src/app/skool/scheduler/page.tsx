'use client'

import { useState, useCallback, useRef, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  Button,
  Badge,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Input,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  toast,
} from '@0ne/ui'
import { Plus, MoreHorizontal, Pencil, Trash2, Loader2, Send } from 'lucide-react'
import { DAY_NAMES, formatScheduleTime, type SkoolScheduledPost, type DayOfWeek, type OneOffPostStatus } from '@0ne/db'
import {
  useSchedulers,
  createScheduler,
  updateScheduler,
  deleteScheduler,
  useOneOffPosts,
  createOneOffPost,
  updateOneOffPost,
  deleteOneOffPost,
  useVariationGroups,
} from '@/features/skool/hooks'
import { SchedulerDialog, ConfirmDialog, OneOffPostDialog, type SchedulerFormData, type OneOffPostFormData } from '@/features/skool/components'
import type { OneOffPostWithCampaign } from '@/features/skool/hooks/use-oneoff-posts'
import type { VariationGroupWithStats } from '@/features/skool/hooks/use-variation-groups'

// Day options for the inline select
const DAY_OPTIONS = [
  { value: '0', label: 'Sunday' },
  { value: '1', label: 'Monday' },
  { value: '2', label: 'Tuesday' },
  { value: '3', label: 'Wednesday' },
  { value: '4', label: 'Thursday' },
  { value: '5', label: 'Friday' },
  { value: '6', label: 'Saturday' },
]

// Status options for editable one-off posts
const EDITABLE_ONEOFF_STATUSES: OneOffPostStatus[] = ['draft', 'approved', 'pending', 'posted_manually']
const READONLY_ONEOFF_STATUSES: OneOffPostStatus[] = ['published', 'failed', 'cancelled']

// Display labels for one-off post statuses
const STATUS_LABELS: Record<OneOffPostStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  pending: 'Scheduled',
  published: 'Published',
  posted_manually: 'Posted Manually',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

// Types for inline editing
type RecurringInlineChanges = {
  day_of_week?: DayOfWeek
  time?: string
  variation_group_id?: string | null
}

type OneOffInlineChanges = {
  scheduled_date?: string
  scheduled_time?: string
  status?: OneOffPostStatus
}

// Main page component with Suspense boundary for useSearchParams
export default function SchedulerPage() {
  return (
    <Suspense fallback={<SchedulerPageLoading />}>
      <SchedulerPageContent />
    </Suspense>
  )
}

// Loading fallback
function SchedulerPageLoading() {
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Scheduler</h1>
        <p className="text-muted-foreground">
          Manage recurring and one-off scheduled posts
        </p>
      </div>
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    </div>
  )
}

// Content component that uses useSearchParams
function SchedulerPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Recurring posts hooks and state
  const { schedulers, isLoading: schedulersLoading, refresh: refreshSchedulers } = useSchedulers()
  const { groups: variationGroups, isLoading: groupsLoading } = useVariationGroups()

  // One-off posts hooks and state
  const { posts: oneOffPosts, isLoading: oneOffLoading, refresh: refreshOneOff } = useOneOffPosts()

  // Recurring dialog state
  const [recurringDialogOpen, setRecurringDialogOpen] = useState(false)
  const [editingScheduler, setEditingScheduler] = useState<SkoolScheduledPost | null>(null)
  const [isRecurringSaving, setIsRecurringSaving] = useState(false)

  // One-off dialog state
  const [oneOffDialogOpen, setOneOffDialogOpen] = useState(false)
  const [editingOneOff, setEditingOneOff] = useState<OneOffPostFormData | null>(null)
  const [isOneOffSaving, setIsOneOffSaving] = useState(false)

  // Delete confirmation state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteType, setDeleteType] = useState<'recurring' | 'oneoff'>('recurring')
  const [isDeleting, setIsDeleting] = useState(false)

  // Post Now confirmation state
  const [postNowDialogOpen, setPostNowDialogOpen] = useState(false)
  const [postingNowPost, setPostingNowPost] = useState<OneOffPostWithCampaign | null>(null)
  const [isPostingNow, setIsPostingNow] = useState(false)

  // Toggle loading state per row (for recurring status toggle)
  const [togglingIds, setTogglingIds] = useState<Set<string>>(new Set())

  // Recurring inline editing state
  const [recurringPendingChanges, setRecurringPendingChanges] = useState<Record<string, RecurringInlineChanges>>({})
  const [recurringSavingRows, setRecurringSavingRows] = useState<Set<string>>(new Set())
  const recurringDebounceTimers = useRef<Record<string, NodeJS.Timeout>>({})

  // One-off inline editing state
  const [oneOffPendingChanges, setOneOffPendingChanges] = useState<Record<string, OneOffInlineChanges>>({})
  const [oneOffSavingRows, setOneOffSavingRows] = useState<Set<string>>(new Set())
  const oneOffDebounceTimers = useRef<Record<string, NodeJS.Timeout>>({})

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      Object.values(recurringDebounceTimers.current).forEach(clearTimeout)
      Object.values(oneOffDebounceTimers.current).forEach(clearTimeout)
    }
  }, [])

  // Handle query params to auto-open dialogs
  useEffect(() => {
    const newOneOff = searchParams.get('newOneOff')
    const newRecurring = searchParams.get('newRecurring')

    if (newOneOff === 'true') {
      setOneOffDialogOpen(true)
      // Clear the query param
      router.replace('/skool/scheduler', { scroll: false })
    } else if (newRecurring === 'true') {
      setRecurringDialogOpen(true)
      // Clear the query param
      router.replace('/skool/scheduler', { scroll: false })
    }
  }, [searchParams, router])

  // ===== RECURRING POSTS HANDLERS =====

  const handleAddRecurring = () => {
    setEditingScheduler(null)
    setRecurringDialogOpen(true)
  }

  const handleEditRecurring = (scheduler: SkoolScheduledPost) => {
    setEditingScheduler(scheduler)
    setRecurringDialogOpen(true)
  }

  const handleDeleteRecurring = (id: string) => {
    setDeletingId(id)
    setDeleteType('recurring')
    setDeleteDialogOpen(true)
  }

  const handleSaveRecurring = async (data: SchedulerFormData) => {
    setIsRecurringSaving(true)
    try {
      if (data.id) {
        const result = await updateScheduler(data.id, {
          category: data.category,
          category_id: data.category_id,
          day_of_week: data.day_of_week,
          time: data.time,
          is_active: data.is_active,
          note: data.note || null,
          variation_group_id: data.variation_group_id || null,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Schedule slot updated')
      } else {
        const result = await createScheduler({
          group_slug: data.group_slug,
          category: data.category,
          category_id: data.category_id,
          day_of_week: data.day_of_week,
          time: data.time,
          is_active: data.is_active,
          note: data.note || null,
          variation_group_id: data.variation_group_id || null,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Schedule slot created')
      }
      setRecurringDialogOpen(false)
      refreshSchedulers()
    } finally {
      setIsRecurringSaving(false)
    }
  }

  const handleToggleActive = async (scheduler: SkoolScheduledPost) => {
    setTogglingIds((prev) => new Set(prev).add(scheduler.id))
    try {
      const result = await updateScheduler(scheduler.id, {
        is_active: !scheduler.is_active,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      refreshSchedulers()
    } finally {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(scheduler.id)
        return next
      })
    }
  }

  // Debounced save for recurring inline editing
  const saveRecurringInlineChanges = useCallback(async (schedulerId: string, scheduler: SkoolScheduledPost, changesArg: RecurringInlineChanges) => {
    if (!changesArg) return

    setRecurringSavingRows((prev) => new Set(prev).add(schedulerId))
    try {
      const result = await updateScheduler(schedulerId, {
        day_of_week: changesArg.day_of_week ?? scheduler.day_of_week,
        time: changesArg.time ?? scheduler.time,
        variation_group_id: changesArg.variation_group_id !== undefined ? changesArg.variation_group_id : scheduler.variation_group_id,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Schedule updated')
      refreshSchedulers()
    } finally {
      setRecurringSavingRows((prev) => {
        const next = new Set(prev)
        next.delete(schedulerId)
        return next
      })
      setRecurringPendingChanges((prev) => {
        const next = { ...prev }
        delete next[schedulerId]
        return next
      })
    }
  }, [refreshSchedulers])

  // Handle inline day change with debounce
  const handleRecurringDayChange = useCallback((scheduler: SkoolScheduledPost, newDay: string) => {
    const dayOfWeek = parseInt(newDay, 10) as DayOfWeek

    const newChanges = {
      ...recurringPendingChanges[scheduler.id],
      day_of_week: dayOfWeek,
    }
    setRecurringPendingChanges((prev) => ({
      ...prev,
      [scheduler.id]: newChanges,
    }))

    if (recurringDebounceTimers.current[scheduler.id]) {
      clearTimeout(recurringDebounceTimers.current[scheduler.id])
    }

    recurringDebounceTimers.current[scheduler.id] = setTimeout(() => {
      saveRecurringInlineChanges(scheduler.id, scheduler, newChanges)
    }, 400)
  }, [recurringPendingChanges, saveRecurringInlineChanges])

  // Handle inline time change with debounce
  const handleRecurringTimeChange = useCallback((scheduler: SkoolScheduledPost, newTime: string) => {
    const newChanges = {
      ...recurringPendingChanges[scheduler.id],
      time: newTime,
    }
    setRecurringPendingChanges((prev) => ({
      ...prev,
      [scheduler.id]: newChanges,
    }))

    if (recurringDebounceTimers.current[scheduler.id]) {
      clearTimeout(recurringDebounceTimers.current[scheduler.id])
    }

    recurringDebounceTimers.current[scheduler.id] = setTimeout(() => {
      saveRecurringInlineChanges(scheduler.id, scheduler, newChanges)
    }, 400)
  }, [recurringPendingChanges, saveRecurringInlineChanges])

  // Handle inline variation group change with debounce
  const handleRecurringGroupChange = useCallback((scheduler: SkoolScheduledPost, newGroupId: string) => {
    const groupId = newGroupId === 'none' ? null : newGroupId

    const newChanges = {
      ...recurringPendingChanges[scheduler.id],
      variation_group_id: groupId,
    }
    setRecurringPendingChanges((prev) => ({
      ...prev,
      [scheduler.id]: newChanges,
    }))

    if (recurringDebounceTimers.current[scheduler.id]) {
      clearTimeout(recurringDebounceTimers.current[scheduler.id])
    }

    recurringDebounceTimers.current[scheduler.id] = setTimeout(() => {
      saveRecurringInlineChanges(scheduler.id, scheduler, newChanges)
    }, 400)
  }, [recurringPendingChanges, saveRecurringInlineChanges])

  // Get display values for recurring
  const getRecurringDisplayDay = (scheduler: SkoolScheduledPost) => {
    return recurringPendingChanges[scheduler.id]?.day_of_week ?? scheduler.day_of_week
  }

  const getRecurringDisplayTime = (scheduler: SkoolScheduledPost) => {
    return recurringPendingChanges[scheduler.id]?.time ?? scheduler.time
  }

  const getRecurringDisplayGroup = (scheduler: SkoolScheduledPost) => {
    const pendingGroup = recurringPendingChanges[scheduler.id]?.variation_group_id
    if (pendingGroup !== undefined) return pendingGroup
    return scheduler.variation_group_id
  }

  // ===== ONE-OFF POSTS HANDLERS =====

  const handleAddOneOff = () => {
    setEditingOneOff(null)
    setOneOffDialogOpen(true)
  }

  const handleEditOneOff = (post: OneOffPostWithCampaign) => {
    const { date, time } = parseScheduledAt(post.scheduled_at)
    setEditingOneOff({
      id: post.id,
      group_slug: post.group_slug,
      category: post.category,
      category_id: post.category_id,
      scheduled_date: date,
      scheduled_time: time,
      timezone: post.timezone,
      title: post.title,
      body: post.body,
      image_url: post.image_url || '',
      video_url: post.video_url || '',
      campaign_id: post.campaign_id,
      send_email_blast: post.send_email_blast,
      status: post.status,
    })
    setOneOffDialogOpen(true)
  }

  const handleDeleteOneOff = (id: string) => {
    setDeletingId(id)
    setDeleteType('oneoff')
    setDeleteDialogOpen(true)
  }

  const handleSaveOneOff = async (data: OneOffPostFormData) => {
    setIsOneOffSaving(true)
    try {
      const scheduledAt = `${data.scheduled_date}T${data.scheduled_time}:00`

      if (data.id) {
        const result = await updateOneOffPost(data.id, {
          group_slug: data.group_slug,
          category: data.category,
          category_id: data.category_id,
          scheduled_at: scheduledAt,
          timezone: data.timezone,
          title: data.title,
          body: data.body,
          image_url: data.image_url || null,
          video_url: data.video_url || null,
          campaign_id: data.campaign_id,
          send_email_blast: data.send_email_blast,
          status: data.status,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Scheduled post updated')
      } else {
        const result = await createOneOffPost({
          group_slug: data.group_slug,
          category: data.category,
          category_id: data.category_id,
          scheduled_at: scheduledAt,
          timezone: data.timezone,
          title: data.title,
          body: data.body,
          image_url: data.image_url || null,
          video_url: data.video_url || null,
          campaign_id: data.campaign_id,
          send_email_blast: data.send_email_blast,
          status: data.status,
        })
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Post scheduled')
      }
      setOneOffDialogOpen(false)
      refreshOneOff()
    } finally {
      setIsOneOffSaving(false)
    }
  }

  // Debounced save for one-off inline editing
  const saveOneOffInlineChanges = useCallback(async (postId: string, post: OneOffPostWithCampaign, changesArg: OneOffInlineChanges) => {
    if (!changesArg) return

    setOneOffSavingRows((prev) => new Set(prev).add(postId))
    try {
      // Build scheduled_at from changes or existing values
      const date = changesArg.scheduled_date ?? parseScheduledAt(post.scheduled_at).date
      const time = changesArg.scheduled_time ?? parseScheduledAt(post.scheduled_at).time
      const scheduledAt = `${date}T${time}:00`

      const result = await updateOneOffPost(postId, {
        scheduled_at: scheduledAt,
        status: changesArg.status ?? post.status,
      })
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success('Post updated')
      refreshOneOff()
    } finally {
      setOneOffSavingRows((prev) => {
        const next = new Set(prev)
        next.delete(postId)
        return next
      })
      setOneOffPendingChanges((prev) => {
        const next = { ...prev }
        delete next[postId]
        return next
      })
    }
  }, [refreshOneOff])

  // Handle inline date change with debounce
  const handleOneOffDateChange = useCallback((post: OneOffPostWithCampaign, newDate: string) => {
    const newChanges = {
      ...oneOffPendingChanges[post.id],
      scheduled_date: newDate,
    }
    setOneOffPendingChanges((prev) => ({
      ...prev,
      [post.id]: newChanges,
    }))

    if (oneOffDebounceTimers.current[post.id]) {
      clearTimeout(oneOffDebounceTimers.current[post.id])
    }

    oneOffDebounceTimers.current[post.id] = setTimeout(() => {
      saveOneOffInlineChanges(post.id, post, newChanges)
    }, 400)
  }, [oneOffPendingChanges, saveOneOffInlineChanges])

  // Handle inline time change with debounce
  const handleOneOffTimeChange = useCallback((post: OneOffPostWithCampaign, newTime: string) => {
    const newChanges = {
      ...oneOffPendingChanges[post.id],
      scheduled_time: newTime,
    }
    setOneOffPendingChanges((prev) => ({
      ...prev,
      [post.id]: newChanges,
    }))

    if (oneOffDebounceTimers.current[post.id]) {
      clearTimeout(oneOffDebounceTimers.current[post.id])
    }

    oneOffDebounceTimers.current[post.id] = setTimeout(() => {
      saveOneOffInlineChanges(post.id, post, newChanges)
    }, 400)
  }, [oneOffPendingChanges, saveOneOffInlineChanges])

  // Handle inline status change with debounce
  const handleOneOffStatusChange = useCallback((post: OneOffPostWithCampaign, newStatus: OneOffPostStatus) => {
    const newChanges = {
      ...oneOffPendingChanges[post.id],
      status: newStatus,
    }
    setOneOffPendingChanges((prev) => ({
      ...prev,
      [post.id]: newChanges,
    }))

    if (oneOffDebounceTimers.current[post.id]) {
      clearTimeout(oneOffDebounceTimers.current[post.id])
    }

    oneOffDebounceTimers.current[post.id] = setTimeout(() => {
      saveOneOffInlineChanges(post.id, post, newChanges)
    }, 400)
  }, [oneOffPendingChanges, saveOneOffInlineChanges])

  // Get display values for one-off
  const getOneOffDisplayDate = (post: OneOffPostWithCampaign) => {
    return oneOffPendingChanges[post.id]?.scheduled_date ?? parseScheduledAt(post.scheduled_at).date
  }

  const getOneOffDisplayTime = (post: OneOffPostWithCampaign) => {
    return oneOffPendingChanges[post.id]?.scheduled_time ?? parseScheduledAt(post.scheduled_at).time
  }

  const getOneOffDisplayStatus = (post: OneOffPostWithCampaign) => {
    return oneOffPendingChanges[post.id]?.status ?? post.status
  }

  // ===== DELETE HANDLER =====

  const handleDelete = async () => {
    if (!deletingId) return
    setIsDeleting(true)
    try {
      if (deleteType === 'recurring') {
        const result = await deleteScheduler(deletingId)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Schedule slot deleted')
        refreshSchedulers()
      } else {
        const result = await deleteOneOffPost(deletingId)
        if (result.error) {
          toast.error(result.error)
          return
        }
        toast.success('Scheduled post deleted')
        refreshOneOff()
      }
      setDeleteDialogOpen(false)
    } finally {
      setIsDeleting(false)
      setDeletingId(null)
    }
  }

  // ===== POST NOW HANDLER =====

  const handlePostNowClick = (post: OneOffPostWithCampaign) => {
    setPostingNowPost(post)
    setPostNowDialogOpen(true)
  }

  const handlePostNow = async () => {
    if (!postingNowPost) return
    setIsPostingNow(true)
    try {
      const response = await fetch('/api/skool/oneoff-posts/post-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: postingNowPost.id }),
      })

      const result = await response.json()

      if (!response.ok) {
        toast.error(result.error || 'Failed to post')
        return
      }

      toast.success(`Posted successfully! ${result.postUrl ? 'View on Skool' : ''}`)
      refreshOneOff()
      setPostNowDialogOpen(false)
    } catch (error) {
      toast.error('Failed to post. Please try again.')
    } finally {
      setIsPostingNow(false)
      setPostingNowPost(null)
    }
  }

  // ===== HELPERS =====

  const parseScheduledAt = (scheduledAt: string): { date: string; time: string } => {
    const dt = new Date(scheduledAt)
    const date = dt.toISOString().split('T')[0]
    const hours = dt.getHours().toString().padStart(2, '0')
    const minutes = dt.getMinutes().toString().padStart(2, '0')
    return { date, time: `${hours}:${minutes}` }
  }

  const getGroupName = (groupId: string | null, groups: VariationGroupWithStats[]): string => {
    if (!groupId) return 'None'
    const group = groups.find((g) => g.id === groupId)
    return group?.name || 'Unknown'
  }

  const isOneOffEditable = (status: OneOffPostStatus): boolean => {
    return EDITABLE_ONEOFF_STATUSES.includes(status)
  }

  // Group recurring by day of week for display
  const schedulersByDay = schedulers.reduce(
    (acc, s) => {
      if (!acc[s.day_of_week]) acc[s.day_of_week] = []
      acc[s.day_of_week].push(s)
      return acc
    },
    {} as Record<number, SkoolScheduledPost[]>
  )

  const isLoading = schedulersLoading || oneOffLoading

  return (
    <div className="p-6 space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Scheduler</h1>
        <p className="text-muted-foreground">
          Manage recurring and one-off scheduled posts
        </p>
      </div>

      {/* Section 1: Recurring Posts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold">Recurring Posts</CardTitle>
          <Button onClick={handleAddRecurring} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Schedule Recurring Post
          </Button>
        </CardHeader>
        <CardContent>
          {schedulersLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : schedulers.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/50">
              <p className="text-muted-foreground">No recurring posts configured yet.</p>
              <Button variant="outline" className="mt-4" onClick={handleAddRecurring}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Slot
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last Run</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.keys(schedulersByDay)
                    .map(Number)
                    .sort((a, b) => a - b)
                    .flatMap((dayIndex) =>
                      schedulersByDay[dayIndex].map((scheduler) => (
                        <TableRow key={scheduler.id}>
                          {/* Group Column - Inline Dropdown */}
                          <TableCell>
                            {recurringSavingRows.has(scheduler.id) ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-muted-foreground">
                                  {getGroupName(getRecurringDisplayGroup(scheduler), variationGroups)}
                                </span>
                              </div>
                            ) : (
                              <Select
                                value={getRecurringDisplayGroup(scheduler) || 'none'}
                                onValueChange={(value) => handleRecurringGroupChange(scheduler, value)}
                                disabled={recurringSavingRows.has(scheduler.id) || groupsLoading}
                              >
                                <SelectTrigger size="sm" className="min-w-[200px]">
                                  <SelectValue placeholder="Select group" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {variationGroups.map((group) => (
                                    <SelectItem key={group.id} value={group.id}>
                                      {group.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          {/* Day Column */}
                          <TableCell>
                            {recurringSavingRows.has(scheduler.id) ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-muted-foreground">
                                  {DAY_NAMES[getRecurringDisplayDay(scheduler)]}
                                </span>
                              </div>
                            ) : (
                              <Select
                                value={String(getRecurringDisplayDay(scheduler))}
                                onValueChange={(value) => handleRecurringDayChange(scheduler, value)}
                                disabled={recurringSavingRows.has(scheduler.id)}
                              >
                                <SelectTrigger size="sm" className="w-[110px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DAY_OPTIONS.map((day) => (
                                    <SelectItem key={day.value} value={day.value}>
                                      {day.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          {/* Time Column */}
                          <TableCell>
                            {recurringSavingRows.has(scheduler.id) ? (
                              <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-muted-foreground">
                                  {formatScheduleTime(getRecurringDisplayTime(scheduler))}
                                </span>
                              </div>
                            ) : (
                              <Input
                                type="time"
                                value={getRecurringDisplayTime(scheduler)}
                                onChange={(e) => handleRecurringTimeChange(scheduler, e.target.value)}
                                disabled={recurringSavingRows.has(scheduler.id)}
                                className="w-[100px] h-8 text-sm"
                              />
                            )}
                          </TableCell>
                          {/* Status Column */}
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {togglingIds.has(scheduler.id) ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Switch
                                  checked={scheduler.is_active}
                                  onCheckedChange={() => handleToggleActive(scheduler)}
                                />
                              )}
                              <Badge variant={scheduler.is_active ? 'default' : 'secondary'}>
                                {scheduler.is_active ? 'Active' : 'Paused'}
                              </Badge>
                            </div>
                          </TableCell>
                          {/* Last Run Column */}
                          <TableCell className="text-muted-foreground">
                            {scheduler.last_run_at
                              ? new Date(scheduler.last_run_at).toLocaleString()
                              : 'Never'}
                          </TableCell>
                          {/* Note Column */}
                          <TableCell className="text-muted-foreground max-w-[200px] truncate">
                            {scheduler.note || '-'}
                          </TableCell>
                          {/* Actions Column */}
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditRecurring(scheduler)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => handleDeleteRecurring(scheduler.id)}
                                  className="text-destructive"
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: One-Off Posts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <CardTitle className="text-lg font-semibold">One-Off Posts</CardTitle>
          <Button onClick={handleAddOneOff} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Schedule Post
          </Button>
        </CardHeader>
        <CardContent>
          {oneOffLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : oneOffPosts.length === 0 ? (
            <div className="text-center py-12 border rounded-lg bg-muted/50">
              <p className="text-muted-foreground">No one-off posts scheduled yet.</p>
              <Button variant="outline" className="mt-4" onClick={handleAddOneOff}>
                <Plus className="h-4 w-4 mr-2" />
                Schedule First Post
              </Button>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {oneOffPosts.map((post) => {
                    const editable = isOneOffEditable(post.status)
                    const displayStatus = getOneOffDisplayStatus(post)

                    return (
                      <TableRow key={post.id}>
                        {/* Title Column */}
                        <TableCell className="font-medium max-w-[250px] truncate">
                          {post.title}
                        </TableCell>
                        {/* Date Column */}
                        <TableCell>
                          {oneOffSavingRows.has(post.id) ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-muted-foreground">
                                {getOneOffDisplayDate(post)}
                              </span>
                            </div>
                          ) : editable ? (
                            <Input
                              type="date"
                              value={getOneOffDisplayDate(post)}
                              onChange={(e) => handleOneOffDateChange(post, e.target.value)}
                              disabled={oneOffSavingRows.has(post.id)}
                              className="w-[140px] h-8 text-sm"
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              {new Date(post.scheduled_at).toLocaleDateString()}
                            </span>
                          )}
                        </TableCell>
                        {/* Time Column */}
                        <TableCell>
                          {oneOffSavingRows.has(post.id) ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-muted-foreground">
                                {getOneOffDisplayTime(post)}
                              </span>
                            </div>
                          ) : editable ? (
                            <Input
                              type="time"
                              value={getOneOffDisplayTime(post)}
                              onChange={(e) => handleOneOffTimeChange(post, e.target.value)}
                              disabled={oneOffSavingRows.has(post.id)}
                              className="w-[100px] h-8 text-sm"
                            />
                          ) : (
                            <span className="text-muted-foreground">
                              {new Date(post.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          )}
                        </TableCell>
                        {/* Status Column */}
                        <TableCell>
                          {oneOffSavingRows.has(post.id) ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span className="text-muted-foreground">
                                {STATUS_LABELS[displayStatus]}
                              </span>
                            </div>
                          ) : editable ? (
                            <Select
                              value={displayStatus}
                              onValueChange={(value) => handleOneOffStatusChange(post, value as OneOffPostStatus)}
                              disabled={oneOffSavingRows.has(post.id)}
                            >
                              <SelectTrigger size="sm" className="w-[120px]">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="approved">Approved</SelectItem>
                                <SelectItem value="pending">Scheduled</SelectItem>
                                <SelectItem value="posted_manually">Posted Manually</SelectItem>
                              </SelectContent>
                            </Select>
                          ) : (
                            <Badge
                              variant={
                                displayStatus === 'published' || displayStatus === 'posted_manually'
                                  ? 'default'
                                  : displayStatus === 'failed'
                                  ? 'destructive'
                                  : 'secondary'
                              }
                            >
                              {STATUS_LABELS[displayStatus]}
                            </Badge>
                          )}
                        </TableCell>
                        {/* Actions Column */}
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {editable && (
                                <DropdownMenuItem
                                  onClick={() => handlePostNowClick(post)}
                                >
                                  <Send className="h-4 w-4 mr-2" />
                                  Post Now
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleEditOneOff(post)}
                                disabled={!editable}
                              >
                                <Pencil className="h-4 w-4 mr-2" />
                                Edit
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => handleDeleteOneOff(post.id)}
                                className="text-destructive"
                                disabled={!editable}
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recurring Post Dialog */}
      <SchedulerDialog
        open={recurringDialogOpen}
        onOpenChange={setRecurringDialogOpen}
        scheduler={
          editingScheduler
            ? {
                id: editingScheduler.id,
                group_slug: editingScheduler.group_slug,
                category: editingScheduler.category,
                category_id: editingScheduler.category_id,
                day_of_week: editingScheduler.day_of_week,
                time: editingScheduler.time,
                is_active: editingScheduler.is_active,
                note: editingScheduler.note || '',
                variation_group_id: editingScheduler.variation_group_id ?? null,
              }
            : null
        }
        onSave={handleSaveRecurring}
        isSaving={isRecurringSaving}
      />

      {/* One-Off Post Dialog */}
      <OneOffPostDialog
        open={oneOffDialogOpen}
        onOpenChange={setOneOffDialogOpen}
        post={editingOneOff}
        onSave={handleSaveOneOff}
        isSaving={isOneOffSaving}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title={deleteType === 'recurring' ? 'Delete Schedule Slot' : 'Delete Scheduled Post'}
        description={
          deleteType === 'recurring'
            ? 'Are you sure you want to delete this schedule slot? This action cannot be undone. Posts in the library for this slot will not be deleted.'
            : 'Are you sure you want to delete this scheduled post? This action cannot be undone.'
        }
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />

      {/* Post Now Confirmation Dialog */}
      <ConfirmDialog
        open={postNowDialogOpen}
        onOpenChange={setPostNowDialogOpen}
        title="Post Now"
        description={
          postingNowPost
            ? `Are you sure you want to post "${postingNowPost.title}" to Skool right now? This will bypass the scheduled time and post immediately.`
            : 'Post this content to Skool immediately?'
        }
        onConfirm={handlePostNow}
        isLoading={isPostingNow}
        confirmText="Post Now"
        variant="default"
      />
    </div>
  )
}
