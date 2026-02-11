'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@0ne/ui'
import { Loader2, Layers, RefreshCw } from 'lucide-react'
import { DAY_NAMES, type DayOfWeek } from '@0ne/db'
import { useCategories } from '../hooks/use-categories'
import { useVariationGroups } from '../hooks/use-variation-groups'

export interface SchedulerFormData {
  id?: string
  group_slug: string
  category: string
  category_id: string | null
  day_of_week: DayOfWeek
  time: string
  variation_group_id: string | null
  is_active: boolean
  note: string
}

interface SchedulerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  scheduler?: SchedulerFormData | null
  onSave: (data: SchedulerFormData) => Promise<void>
  isSaving?: boolean
}

const defaultFormData: SchedulerFormData = {
  group_slug: 'fruitful',
  category: '',
  category_id: null,
  day_of_week: 1, // Monday
  time: '09:00',
  variation_group_id: null,
  is_active: true,
  note: '',
}


export function SchedulerDialog({
  open,
  onOpenChange,
  scheduler,
  onSave,
  isSaving = false,
}: SchedulerDialogProps) {
  const [formData, setFormData] = useState<SchedulerFormData>(defaultFormData)
  const { categories, isLoading: categoriesLoading, isRefreshing, refresh: refreshCategories, source } = useCategories()
  const { groups: variationGroups, isLoading: groupsLoading } = useVariationGroups()
  const isEditMode = !!scheduler?.id

  // Reset form when dialog opens/closes or scheduler changes
  useEffect(() => {
    if (open && scheduler) {
      setFormData({
        id: scheduler.id,
        group_slug: scheduler.group_slug || 'fruitful',
        category: scheduler.category || '',
        category_id: scheduler.category_id || null,
        day_of_week: scheduler.day_of_week ?? 1,
        time: scheduler.time || '09:00',
        variation_group_id: scheduler.variation_group_id || null,
        is_active: scheduler.is_active ?? true,
        note: scheduler.note || '',
      })
    } else if (open && !scheduler) {
      setFormData(defaultFormData)
    }
  }, [open, scheduler])

  const handleSubmit = async () => {
    await onSave(formData)
  }

  const handleCategoryChange = (categoryName: string) => {
    const selectedCategory = categories.find((c) => c.name === categoryName)
    setFormData({
      ...formData,
      category: categoryName,
      category_id: selectedCategory?.id || null,
    })
  }

  const isValid = formData.category && formData.time && formData.variation_group_id

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Recurring Post' : 'Add Recurring Post'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the schedule slot details below.'
              : 'Create a new recurring schedule slot for automated posts.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Category */}
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="scheduler-category" className="text-sm font-medium">
                Skool Category (where to post)
              </label>
              <button
                type="button"
                onClick={refreshCategories}
                disabled={isRefreshing || categoriesLoading}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                title="Refresh categories from Skool"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                {isRefreshing ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            <Select
              value={formData.category}
              onValueChange={handleCategoryChange}
              disabled={categoriesLoading || isRefreshing}
            >
              <SelectTrigger id="scheduler-category">
                <SelectValue placeholder={categoriesLoading ? 'Loading...' : 'Select category'} />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.name} value={cat.name}>
                    {cat.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {source === 'fallback' && (
              <p className="text-xs text-amber-600">
                Using fallback categories. Click Refresh to fetch from Skool.
              </p>
            )}
          </div>

          {/* Day of Week and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label htmlFor="scheduler-day" className="text-sm font-medium">
                Day of Week
              </label>
              <Select
                value={String(formData.day_of_week)}
                onValueChange={(value) =>
                  setFormData({ ...formData, day_of_week: parseInt(value, 10) as DayOfWeek })
                }
              >
                <SelectTrigger id="scheduler-day">
                  <SelectValue placeholder="Select day" />
                </SelectTrigger>
                <SelectContent>
                  {DAY_NAMES.map((day, index) => (
                    <SelectItem key={day} value={String(index)}>
                      {day}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="scheduler-time" className="text-sm font-medium">
                Time (ET)
              </label>
              <Input
                id="scheduler-time"
                type="time"
                value={formData.time}
                onChange={(e) => setFormData({ ...formData, time: e.target.value })}
              />
            </div>
          </div>

          {/* Variation Group */}
          <div className="grid gap-2">
            <label htmlFor="scheduler-group" className="text-sm font-medium flex items-center gap-1">
              <Layers className="h-4 w-4" />
              Variation Group (content source)
            </label>
            <Select
              value={formData.variation_group_id || ''}
              onValueChange={(value) =>
                setFormData({ ...formData, variation_group_id: value || null })
              }
              disabled={groupsLoading}
            >
              <SelectTrigger id="scheduler-group">
                <SelectValue
                  placeholder={groupsLoading ? 'Loading...' : 'Select variation group'}
                />
              </SelectTrigger>
              <SelectContent>
                {variationGroups
                  .filter((g) => g.is_active)
                  .map((group) => (
                    <SelectItem key={group.id} value={group.id}>
                      {group.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Posts will be pulled from this variation group
            </p>
          </div>

          {/* Note */}
          <div className="grid gap-2">
            <label htmlFor="scheduler-note" className="text-sm font-medium">
              Note (optional)
            </label>
            <Input
              id="scheduler-note"
              placeholder="e.g., Monday motivation post"
              value={formData.note}
              onChange={(e) => setFormData({ ...formData, note: e.target.value })}
            />
          </div>

          {/* Active Toggle */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <label htmlFor="scheduler-active" className="text-sm font-medium">
                Active
              </label>
              <p className="text-xs text-muted-foreground">Enable automated posting for this slot</p>
            </div>
            <Switch
              id="scheduler-active"
              checked={formData.is_active}
              onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Save Changes' : 'Add Recurring Post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
