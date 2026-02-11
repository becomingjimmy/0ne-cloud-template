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
import { Loader2, Image as ImageIcon, Video, Mail, AlertCircle, FolderOpen, RefreshCw } from 'lucide-react'
import { useCategories } from '../hooks/use-categories'
import { useCampaigns } from '../hooks/use-campaigns'
import { useGroupSettings } from '../hooks/use-group-settings'
import { MediaPickerDialog } from '@/features/media'
import type { OneOffPostStatus } from '@0ne/db'

export interface OneOffPostFormData {
  id?: string
  group_slug: string
  category: string
  category_id: string | null
  scheduled_date: string
  scheduled_time: string
  timezone: string
  title: string
  body: string
  image_url: string
  video_url: string
  campaign_id: string | null
  send_email_blast: boolean
  status: OneOffPostStatus
}

interface OneOffPostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  post?: OneOffPostFormData | null
  onSave: (data: OneOffPostFormData) => Promise<void>
  isSaving?: boolean
}

const defaultFormData: OneOffPostFormData = {
  group_slug: 'fruitful',
  category: '',
  category_id: null,
  scheduled_date: '',
  scheduled_time: '09:00',
  timezone: 'America/New_York',
  title: '',
  body: '',
  image_url: '',
  video_url: '',
  campaign_id: null,
  send_email_blast: false,
  status: 'pending',
}


export function OneOffPostDialog({
  open,
  onOpenChange,
  post,
  onSave,
  isSaving = false,
}: OneOffPostDialogProps) {
  const [formData, setFormData] = useState<OneOffPostFormData>(defaultFormData)
  const [imagePickerOpen, setImagePickerOpen] = useState(false)
  const [videoPickerOpen, setVideoPickerOpen] = useState(false)
  const { categories, isLoading: categoriesLoading, isRefreshing, refresh: refreshCategories, source } = useCategories()
  const { campaigns } = useCampaigns({ activeOnly: true })
  const { emailBlastStatus } = useGroupSettings(formData.group_slug)
  const isEditMode = !!post?.id

  // Reset form when dialog opens/closes or post changes
  useEffect(() => {
    if (open && post) {
      // Parse scheduled_at into date and time
      let scheduledDate = ''
      let scheduledTime = '09:00'
      if (post.id) {
        // Edit mode - parse from ISO string if needed
        // The form data should already have date/time separated
        scheduledDate = post.scheduled_date
        scheduledTime = post.scheduled_time
      }

      setFormData({
        id: post.id,
        group_slug: post.group_slug || 'fruitful',
        category: post.category || '',
        category_id: post.category_id || null,
        scheduled_date: scheduledDate,
        scheduled_time: scheduledTime,
        timezone: post.timezone || 'America/New_York',
        title: post.title || '',
        body: post.body || '',
        image_url: post.image_url || '',
        video_url: post.video_url || '',
        campaign_id: post.campaign_id || null,
        send_email_blast: post.send_email_blast ?? false,
        status: post.status || 'pending',
      })
    } else if (open && !post) {
      // Default to tomorrow
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = tomorrow.toISOString().split('T')[0]
      setFormData({ ...defaultFormData, scheduled_date: dateStr })
    }
  }, [open, post])

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

  const isValid =
    formData.category && formData.scheduled_date && formData.scheduled_time && formData.title && formData.body

  const blastCooldownActive = emailBlastStatus && !emailBlastStatus.available

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditMode ? 'Edit Scheduled Post' : 'Schedule Post'}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? 'Update the scheduled post details below.'
              : 'Schedule a one-time post for a specific date and time.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          {/* Category and Campaign */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <label htmlFor="oneoff-category" className="text-sm font-medium">
                  Skool Category
                </label>
                <button
                  type="button"
                  onClick={refreshCategories}
                  disabled={isRefreshing || categoriesLoading}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 disabled:opacity-50"
                  title="Refresh categories from Skool"
                >
                  <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <Select
                value={formData.category}
                onValueChange={handleCategoryChange}
                disabled={categoriesLoading || isRefreshing}
              >
                <SelectTrigger id="oneoff-category">
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
                <p className="text-xs text-amber-600">Using fallback. Click refresh.</p>
              )}
            </div>
            <div className="grid gap-2">
              <label htmlFor="oneoff-campaign" className="text-sm font-medium">
                Campaign (optional)
              </label>
              <Select
                value={formData.campaign_id || 'none'}
                onValueChange={(value) =>
                  setFormData({ ...formData, campaign_id: value === 'none' ? null : value })
                }
              >
                <SelectTrigger id="oneoff-campaign">
                  <SelectValue placeholder="No campaign" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No campaign</SelectItem>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date and Time */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label htmlFor="oneoff-date" className="text-sm font-medium">
                Date
              </label>
              <Input
                id="oneoff-date"
                type="date"
                value={formData.scheduled_date}
                onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <label htmlFor="oneoff-time" className="text-sm font-medium">
                Time (ET)
              </label>
              <Input
                id="oneoff-time"
                type="time"
                value={formData.scheduled_time}
                onChange={(e) => setFormData({ ...formData, scheduled_time: e.target.value })}
              />
            </div>
          </div>

          {/* Title */}
          <div className="grid gap-2">
            <label htmlFor="oneoff-title" className="text-sm font-medium">
              Title
            </label>
            <Input
              id="oneoff-title"
              placeholder="Post title (shows in Skool)"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            />
          </div>

          {/* Body */}
          <div className="grid gap-2">
            <label htmlFor="oneoff-body" className="text-sm font-medium">
              Body (Markdown)
            </label>
            <textarea
              id="oneoff-body"
              placeholder="Write your post content here. Supports Markdown formatting..."
              value={formData.body}
              onChange={(e) => setFormData({ ...formData, body: e.target.value })}
              rows={6}
              className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>

          {/* Media URLs */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <label htmlFor="oneoff-image" className="text-sm font-medium flex items-center gap-1">
                <ImageIcon className="h-4 w-4" />
                Image URL
              </label>
              <div className="flex gap-2">
                <Input
                  id="oneoff-image"
                  placeholder="https://... or use picker"
                  value={formData.image_url}
                  onChange={(e) => setFormData({ ...formData, image_url: e.target.value })}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setImagePickerOpen(true)}
                  title="Browse GHL Media"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="grid gap-2">
              <label htmlFor="oneoff-video" className="text-sm font-medium flex items-center gap-1">
                <Video className="h-4 w-4" />
                Video URL
              </label>
              <div className="flex gap-2">
                <Input
                  id="oneoff-video"
                  placeholder="https://... or use picker"
                  value={formData.video_url}
                  onChange={(e) => setFormData({ ...formData, video_url: e.target.value })}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setVideoPickerOpen(true)}
                  title="Browse GHL Media"
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {/* Image Preview */}
          {formData.image_url && (
            <div className="rounded-md border p-2">
              <p className="text-xs text-muted-foreground mb-2">Image Preview:</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={formData.image_url}
                alt="Preview"
                className="max-h-32 rounded-md object-contain"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
          )}

          {/* Email Blast Toggle */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <label htmlFor="oneoff-email" className="text-sm font-medium flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  Send Email Blast
                </label>
                <p className="text-xs text-muted-foreground">
                  Email all members when this post is published (72-hour cooldown)
                </p>
              </div>
              <Switch
                id="oneoff-email"
                checked={formData.send_email_blast}
                onCheckedChange={(checked) => setFormData({ ...formData, send_email_blast: checked })}
              />
            </div>
            {formData.send_email_blast && blastCooldownActive && (
              <div className="mt-2 flex items-center gap-2 text-amber-600 text-xs">
                <AlertCircle className="h-3 w-3" />
                Blast cooldown active. Available in {emailBlastStatus?.hours_until_available} hours.
              </div>
            )}
          </div>

          {/* Status (for editing) */}
          {isEditMode && (
            <div className="grid gap-2">
              <label htmlFor="oneoff-status" className="text-sm font-medium">
                Status
              </label>
              <Select
                value={formData.status}
                onValueChange={(value) =>
                  setFormData({ ...formData, status: value as OneOffPostStatus })
                }
              >
                <SelectTrigger id="oneoff-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="pending">Scheduled</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!isValid || isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Save Changes' : 'Schedule Post'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Media Picker Dialogs */}
      <MediaPickerDialog
        open={imagePickerOpen}
        onOpenChange={setImagePickerOpen}
        onSelect={(files) => {
          if (files.length > 0) {
            setFormData({ ...formData, image_url: files[0].url })
          }
        }}
        mode="single"
        allowedTypes={['image']}
      />
      <MediaPickerDialog
        open={videoPickerOpen}
        onOpenChange={setVideoPickerOpen}
        onSelect={(files) => {
          if (files.length > 0) {
            setFormData({ ...formData, video_url: files[0].url })
          }
        }}
        mode="single"
        allowedTypes={['video']}
      />
    </Dialog>
  )
}
