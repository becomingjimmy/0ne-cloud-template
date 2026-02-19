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
  Badge,
  Input,
} from '@0ne/ui'
import { Loader2, ExternalLink, Copy, Check } from 'lucide-react'
import { useManualMatch, useSyntheticCreate } from '../hooks/use-contact-mutations'
import type { ContactActivity } from '../hooks/use-contact-activity'

interface ContactEditDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: ContactActivity | null
  onSuccess?: () => void
}

function ContactTypeBadge({ type }: { type: string | null }) {
  if (type === 'community_member') {
    return <Badge className="bg-green-100 text-green-800 border-green-200">Member</Badge>
  }
  if (type === 'dm_contact') {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200">DM</Badge>
  }
  return <Badge className="bg-gray-100 text-gray-600">Unknown</Badge>
}

export function ContactEditDialog({
  open,
  onOpenChange,
  contact,
  onSuccess,
}: ContactEditDialogProps) {
  const [ghlContactId, setGhlContactId] = useState('')
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { manualMatch, isLoading: isMatching } = useManualMatch()
  const { createSynthetic, isLoading: isCreating } = useSyntheticCreate()

  const isMatched = !!contact?.ghl_contact_id
  const isSaving = isMatching || isCreating

  // Reset form when dialog opens — pre-fill with current GHL ID if matched
  useEffect(() => {
    if (open && contact) {
      setGhlContactId(contact.ghl_contact_id || '')
      setCopied(false)
      setError(null)
    }
  }, [open, contact])

  const handleManualMatch = async () => {
    if (!contact || !ghlContactId.trim()) return
    setError(null)

    const success = await manualMatch(contact.skool_user_id, ghlContactId.trim())
    if (success) {
      onSuccess?.()
      onOpenChange(false)
    } else {
      setError('Failed to match contact')
    }
  }

  const handleSyntheticCreate = async () => {
    if (!contact) return
    setError(null)

    const result = await createSynthetic(contact.skool_user_id)
    if (result) {
      onSuccess?.()
      onOpenChange(false)
    } else {
      setError('Failed to create synthetic contact')
    }
  }

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!contact) return null

  const displayName = contact.skool_display_name || contact.skool_username || 'Unknown'
  const hasChangedGhlId = ghlContactId.trim() !== (contact.ghl_contact_id || '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Edit Contact</DialogTitle>
          <DialogDescription>
            View and edit contact details. Change the GHL Contact ID to re-match.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Name */}
          <div className="grid gap-1">
            <label className="text-sm font-medium text-muted-foreground">Name</label>
            <div className="flex items-center gap-2">
              <span className="text-sm">{displayName}</span>
              <ContactTypeBadge type={contact.contact_type} />
            </div>
          </div>

          {/* Username */}
          <div className="grid gap-1">
            <label className="text-sm font-medium text-muted-foreground">Username</label>
            <span className="text-sm">{contact.skool_username ? `@${contact.skool_username}` : '-'}</span>
          </div>

          {/* Skool User ID */}
          <div className="grid gap-1">
            <label className="text-sm font-medium text-muted-foreground">Skool User ID</label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-mono text-xs">{contact.skool_user_id}</span>
              <button
                onClick={() => handleCopy(contact.skool_user_id)}
                className="text-muted-foreground hover:text-foreground"
                title="Copy"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          {/* Email */}
          {contact.email && (
            <div className="grid gap-1">
              <label className="text-sm font-medium text-muted-foreground">Email</label>
              <span className="text-sm">{contact.email}</span>
            </div>
          )}

          {/* Phone */}
          {contact.phone && (
            <div className="grid gap-1">
              <label className="text-sm font-medium text-muted-foreground">Phone</label>
              <span className="text-sm">{contact.phone}</span>
            </div>
          )}

          {/* GHL Contact ID — always editable */}
          <div className="grid gap-2">
            <label htmlFor="ghl-id" className="text-sm font-medium">
              GHL Contact ID
            </label>
            <div className="flex items-center gap-2">
              <Input
                id="ghl-id"
                placeholder="Paste GHL contact ID here..."
                value={ghlContactId}
                onChange={(e) => {
                  setGhlContactId(e.target.value)
                  setError(null)
                }}
                className="flex-1"
              />
              {isMatched && contact.ghl_location_id && contact.ghl_contact_id && (
                <a
                  href={`https://app.gohighlevel.com/v2/location/${contact.ghl_location_id}/contacts/detail/${contact.ghl_contact_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center h-9 w-9 rounded-md border text-primary hover:text-primary/80 hover:bg-muted shrink-0"
                  title="Open in GHL"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {isMatched
                ? 'Change this ID to re-match to a different GHL contact.'
                : 'Find the contact in GHL and paste their ID to manually link them.'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>

          {!isMatched && (
            <Button
              variant="secondary"
              onClick={handleSyntheticCreate}
              disabled={isSaving}
            >
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Synthetic
            </Button>
          )}

          <Button
            onClick={handleManualMatch}
            disabled={isSaving || !ghlContactId.trim() || !hasChangedGhlId}
          >
            {isMatching && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isMatched ? 'Update Match' : 'Match to GHL'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
