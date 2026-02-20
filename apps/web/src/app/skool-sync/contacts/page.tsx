'use client'

import { useState } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@0ne/ui'
import {
  RefreshCw,
  Loader2,
  Users,
  MessageSquare,
  Clock,
  AlertCircle,
  ExternalLink,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  XCircle,
  Search,
  Pencil,
  Zap,
  HelpCircle,
  Inbox,
} from 'lucide-react'
import { useContactActivity, type ContactActivity } from '@/features/dm-sync'
import { useSyntheticCreate } from '@/features/dm-sync/hooks/use-contact-mutations'
import { ContactEditDialog } from '@/features/dm-sync/components/ContactEditDialog'

// Match method options for filter
const MATCH_METHODS = [
  { value: 'all', label: 'All Methods' },
  { value: 'skool_id', label: 'Skool ID' },
  { value: 'email', label: 'Email' },
  { value: 'name', label: 'Name' },
  { value: 'synthetic', label: 'Synthetic' },
  { value: 'manual', label: 'Manual' },
  { value: 'no_email', label: 'No Email' },
]

// Status options for filter
const STATUS_OPTIONS = [
  { value: 'all', label: 'All Status' },
  { value: 'synced', label: 'Synced' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
]

// Helper to build GHL contact URL
function buildGhlContactUrl(locationId: string, contactId: string): string {
  return `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contactId}`
}

// Helper to convert username to display name
function usernameToDisplayName(username: string | null): string {
  if (!username) return ''
  let name = username.replace(/^@/, '')
  name = name.replace(/-\d+$/, '')
  return name
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
}

// Helper to build Skool member search URL (for group members — gives admin options)
function buildSkoolSearchUrl(communitySlug: string, username: string | null): string {
  if (!communitySlug || !username) return ''
  const searchName = usernameToDisplayName(username)
  return `https://www.skool.com/${communitySlug}/-/search?q=${encodeURIComponent(searchName)}&t=members`
}

// Helper to build direct Skool profile URL (for non-members)
function buildSkoolProfileUrl(username: string | null): string {
  if (!username) return ''
  return `https://www.skool.com/@${username.replace(/^@/, '')}`
}

// Contact type badge
function ContactTypeBadge({ type }: { type: string | null }) {
  if (type === 'community_member') {
    return <Badge className="bg-green-100 text-green-800 border-green-200 text-[10px] px-1.5 py-0">Member</Badge>
  }
  if (type === 'dm_contact') {
    return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px] px-1.5 py-0">DM</Badge>
  }
  return null
}

// Match method badge component
function MatchMethodBadge({ method }: { method: ContactActivity['match_method'] }) {
  const variants: Record<string, { className: string; label: string }> = {
    skool_id: { className: 'bg-blue-100 text-blue-800 border-blue-200', label: 'Skool ID' },
    email: { className: 'bg-green-100 text-green-800 border-green-200', label: 'Email' },
    name: { className: 'bg-purple-100 text-purple-800 border-purple-200', label: 'Name' },
    synthetic: { className: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Synthetic' },
    manual: { className: 'bg-orange-100 text-orange-800 border-orange-200', label: 'Manual' },
    skool_members: { className: 'bg-teal-100 text-teal-800 border-teal-200', label: 'Members' },
    no_email: { className: 'bg-gray-100 text-gray-600', label: 'No Email' },
  }

  const fallback = { className: 'bg-gray-100 text-gray-600', label: method || '-' }
  const config = (method && variants[method]) || fallback

  return <Badge className={config.className}>{config.label}</Badge>
}

// Status indicator component
function StatusIndicator({ contact }: { contact: ContactActivity }) {
  const { synced_count, pending_count, failed_count } = contact.stats

  if (failed_count > 0) {
    return (
      <div className="flex items-center gap-1 text-red-600">
        <XCircle className="h-4 w-4" />
        <span className="text-sm font-medium">{failed_count} failed</span>
      </div>
    )
  }

  if (pending_count > 0) {
    return (
      <div className="flex items-center gap-1 text-yellow-600">
        <Clock className="h-4 w-4" />
        <span className="text-sm font-medium">{pending_count} pending</span>
      </div>
    )
  }

  if (synced_count > 0) {
    return (
      <div className="flex items-center gap-1 text-green-600">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-sm font-medium">{synced_count} synced</span>
      </div>
    )
  }

  return <span className="text-sm text-muted-foreground">-</span>
}

// Message count display
function MessageCounts({ contact }: { contact: ContactActivity }) {
  const { inbound_count, outbound_count } = contact.stats

  if (inbound_count === 0 && outbound_count === 0) {
    return <span className="text-sm text-muted-foreground">-</span>
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex items-center gap-0.5" title="Inbound messages">
        <ArrowDownLeft className="h-3 w-3 text-muted-foreground" />
        {inbound_count}
      </span>
      <span className="flex items-center gap-0.5" title="Outbound messages">
        <ArrowUpRight className="h-3 w-3 text-muted-foreground" />
        {outbound_count}
      </span>
    </div>
  )
}

// Stats card component
function StatsCard({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: React.ElementType
  label: string
  value: number
  className?: string
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${className || 'bg-muted'}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Action links for each contact row
function ContactActions({
  contact,
  onEdit,
  onSynthetic,
  showSynthetic,
}: {
  contact: ContactActivity
  onEdit: () => void
  onSynthetic?: () => void
  showSynthetic: boolean
}) {
  const isMatched = !!contact.ghl_contact_id

  const channelId = contact.channels?.[0]?.skool_channel_id
  const channelCount = contact.channels?.length || 0
  const channelTooltip = channelCount > 1
    ? `${channelCount} staff channels`
    : channelCount === 1
      ? `DM via ${contact.channels[0].staff_display_name || 'staff'}`
      : 'No DM channel'

  return (
    <div className="flex items-center justify-end gap-1.5">
      {/* Skool DM deep link */}
      {channelId ? (
        <a
          href={`https://www.skool.com/${contact.skool_community_slug || 'fruitful'}/-/dm?channel=${channelId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-7 w-7 rounded text-blue-600 hover:text-blue-700 hover:bg-blue-50 relative"
          title={channelTooltip}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {channelCount > 1 && (
            <span className="absolute -top-0.5 -right-0.5 bg-blue-600 text-white text-[8px] rounded-full h-3 w-3 flex items-center justify-center">
              {channelCount}
            </span>
          )}
        </a>
      ) : (
        <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/30" title={channelTooltip}>
          <MessageSquare className="h-3.5 w-3.5" />
        </span>
      )}

      {/* Inbox deep link */}
      {contact.skool_conversation_id ? (
        <a
          href={`/skool-sync/inbox?conversation=${contact.skool_conversation_id}`}
          className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          title="Open in Inbox"
        >
          <Inbox className="h-3.5 w-3.5" />
        </a>
      ) : (
        <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/30">
          <Inbox className="h-3.5 w-3.5" />
        </span>
      )}

      {/* Skool Link — member search for group members, direct profile for non-members */}
      {contact.skool_username ? (
        <a
          href={
            contact.contact_type === 'community_member' && contact.skool_community_slug
              ? buildSkoolSearchUrl(contact.skool_community_slug, contact.skool_username)
              : buildSkoolProfileUrl(contact.skool_username)
          }
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
          title={contact.contact_type === 'community_member' ? 'Search in Skool' : 'Skool profile'}
        >
          <span className="text-xs font-semibold">S</span>
        </a>
      ) : (
        <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/30">
          <span className="text-xs font-semibold">S</span>
        </span>
      )}

      {/* GHL Link */}
      {isMatched && contact.ghl_location_id && contact.ghl_contact_id ? (
        <a
          href={buildGhlContactUrl(contact.ghl_location_id, contact.ghl_contact_id)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center h-7 w-7 rounded text-primary hover:text-primary/80 hover:bg-muted"
          title="Open in GHL"
        >
          <span className="text-xs font-semibold">G</span>
        </a>
      ) : (
        <span className="inline-flex items-center justify-center h-7 w-7 text-muted-foreground/30">
          <span className="text-xs font-semibold">G</span>
        </span>
      )}

      {/* Edit button */}
      <button
        onClick={onEdit}
        className="inline-flex items-center justify-center h-7 w-7 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
        title="Edit contact"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>

      {/* Synthetic button (unmatched only) */}
      {showSynthetic && onSynthetic && (
        <button
          onClick={onSynthetic}
          className="inline-flex items-center justify-center h-7 w-7 rounded text-yellow-600 hover:text-yellow-700 hover:bg-yellow-50"
          title="Create synthetic GHL contact"
        >
          <Zap className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// Contacts table for matched tab
function MatchedTable({
  contacts,
  isLoading,
  onEditContact,
}: {
  contacts: ContactActivity[]
  isLoading: boolean
  onEditContact: (contact: ContactActivity) => void
}) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (contacts.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-center border rounded-lg bg-muted/50">
        <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <p className="text-muted-foreground">No matched contacts found</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Name</TableHead>
            <TableHead className="w-[140px]">Username</TableHead>
            <TableHead className="w-[180px]">Email</TableHead>
            <TableHead className="w-[90px]">Method</TableHead>
            <TableHead className="w-[100px]">Messages</TableHead>
            <TableHead className="w-[120px]">Status</TableHead>
            <TableHead className="w-[160px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const displayName =
              contact.skool_display_name || usernameToDisplayName(contact.skool_username)

            return (
              <TableRow key={contact.id}>
                <TableCell className="max-w-[200px]">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="font-medium text-sm truncate">
                      {displayName || (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <HelpCircle className="h-3 w-3" />
                          {contact.skool_user_id.slice(0, 8)}...
                        </span>
                      )}
                    </span>
                    <ContactTypeBadge type={contact.contact_type} />
                  </div>
                </TableCell>
                <TableCell className="text-sm max-w-[140px] truncate overflow-hidden">
                  {contact.skool_username ? (
                    <a
                      href={buildSkoolProfileUrl(contact.skool_username)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      @{contact.skool_username}
                    </a>
                  ) : '-'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[180px]">
                  {contact.email || '-'}
                </TableCell>
                <TableCell>
                  <MatchMethodBadge method={contact.match_method} />
                </TableCell>
                <TableCell>
                  <MessageCounts contact={contact} />
                </TableCell>
                <TableCell>
                  <StatusIndicator contact={contact} />
                </TableCell>
                <TableCell className="text-right">
                  <ContactActions
                    contact={contact}
                    onEdit={() => onEditContact(contact)}
                    showSynthetic={false}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// Contacts table for unmatched tab
function UnmatchedTable({
  contacts,
  isLoading,
  onEditContact,
  onSyntheticCreate,
}: {
  contacts: ContactActivity[]
  isLoading: boolean
  onEditContact: (contact: ContactActivity) => void
  onSyntheticCreate: (contact: ContactActivity) => void
}) {
  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (contacts.length === 0) {
    return (
      <div className="flex h-48 flex-col items-center justify-center text-center border rounded-lg bg-muted/50">
        <CheckCircle2 className="h-12 w-12 text-green-500/50 mb-4" />
        <p className="text-muted-foreground">All contacts are matched!</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[200px]">Name</TableHead>
            <TableHead className="w-[140px]">Username</TableHead>
            <TableHead className="w-[180px]">Email</TableHead>
            <TableHead className="w-[100px]">Type</TableHead>
            <TableHead className="w-[160px] text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts.map((contact) => {
            const displayName =
              contact.skool_display_name || usernameToDisplayName(contact.skool_username)

            return (
              <TableRow key={contact.id}>
                <TableCell className="max-w-[200px]">
                  <div className="flex items-center gap-1.5 overflow-hidden">
                    <span className="font-medium text-sm truncate">
                      {displayName || (
                        <span className="flex items-center gap-1 text-muted-foreground">
                          <HelpCircle className="h-3 w-3" />
                          {contact.skool_user_id.slice(0, 8)}...
                        </span>
                      )}
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-sm max-w-[140px] truncate overflow-hidden">
                  {contact.skool_username ? (
                    <a
                      href={buildSkoolProfileUrl(contact.skool_username)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground hover:underline"
                    >
                      @{contact.skool_username}
                    </a>
                  ) : '-'}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground truncate max-w-[180px]">
                  {contact.email || '-'}
                </TableCell>
                <TableCell>
                  <ContactTypeBadge type={contact.contact_type} />
                </TableCell>
                <TableCell className="text-right">
                  <ContactActions
                    contact={contact}
                    onEdit={() => onEditContact(contact)}
                    onSynthetic={() => onSyntheticCreate(contact)}
                    showSynthetic={true}
                  />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// Main page component
export default function ContactActivityPage() {
  const [search, setSearch] = useState('')
  const [matchMethod, setMatchMethod] = useState('all')
  const [status, setStatus] = useState('all')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [activeTab, setActiveTab] = useState('matched')
  const [editContact, setEditContact] = useState<ContactActivity | null>(null)
  const [editDialogOpen, setEditDialogOpen] = useState(false)

  const { createSynthetic, isLoading: isSyntheticLoading } = useSyntheticCreate()

  // Debounce search input
  const handleSearchChange = (value: string) => {
    setSearch(value)
    const timeoutId = setTimeout(() => {
      setDebouncedSearch(value)
    }, 300)
    return () => clearTimeout(timeoutId)
  }

  const matchStatus = activeTab === 'matched' ? 'matched' : activeTab === 'unmatched' ? 'unmatched' : 'all'

  const { contacts, summary, isLoading, error, refresh } = useContactActivity({
    search: debouncedSearch,
    matchMethod: activeTab === 'matched' ? matchMethod : undefined,
    matchStatus,
    status: activeTab === 'matched' ? status : undefined,
  })

  const handleEditContact = (contact: ContactActivity) => {
    setEditContact(contact)
    setEditDialogOpen(true)
  }

  const handleSyntheticCreate = async (contact: ContactActivity) => {
    await createSynthetic(contact.skool_user_id)
    refresh()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contact Sync Activity</h1>
          <p className="text-sm text-muted-foreground">
            Manage Skool contacts and their GHL mappings
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refresh()} disabled={isLoading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatsCard
          icon={Users}
          label="Matched"
          value={summary.matched_contacts}
          className="bg-green-100 text-green-600"
        />
        <StatsCard
          icon={AlertCircle}
          label="Unmatched"
          value={summary.unmatched_contacts}
          className="bg-yellow-100 text-yellow-600"
        />
        <StatsCard
          icon={MessageSquare}
          label="Messages"
          value={summary.total_messages}
          className="bg-blue-100 text-blue-600"
        />
        <StatsCard
          icon={Clock}
          label="Pending"
          value={summary.contacts_with_pending}
          className="bg-orange-100 text-orange-600"
        />
      </div>

      {/* Error State */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
          <p className="font-medium">Failed to load contact activity</p>
          <p className="text-sm mt-1">{error.message}</p>
        </div>
      )}

      {/* Main Content Card with Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Contacts
          </CardTitle>
          <CardDescription>
            Skool contacts with GHL mapping status
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <TabsList>
                <TabsTrigger value="matched">
                  Matched ({summary.matched_contacts})
                </TabsTrigger>
                <TabsTrigger value="unmatched">
                  Unmatched ({summary.unmatched_contacts})
                </TabsTrigger>
              </TabsList>

              {/* Filters — only show for matched tab */}
              {activeTab === 'matched' && (
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Search by name..."
                      value={search}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      className="pl-9"
                    />
                  </div>
                  <Select value={matchMethod} onValueChange={setMatchMethod}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Method" />
                    </SelectTrigger>
                    <SelectContent>
                      {MATCH_METHODS.map((method) => (
                        <SelectItem key={method.value} value={method.value}>
                          {method.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger className="w-[130px]">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      {STATUS_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Search for unmatched tab */}
              {activeTab === 'unmatched' && (
                <div className="relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    value={search}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    className="pl-9"
                  />
                </div>
              )}
            </div>

            <TabsContent value="matched" className="mt-4">
              <MatchedTable
                contacts={contacts}
                isLoading={isLoading}
                onEditContact={handleEditContact}
              />
            </TabsContent>

            <TabsContent value="unmatched" className="mt-4">
              <UnmatchedTable
                contacts={contacts}
                isLoading={isLoading}
                onEditContact={handleEditContact}
                onSyntheticCreate={handleSyntheticCreate}
              />
            </TabsContent>
          </Tabs>

          <p className="text-xs text-muted-foreground text-center">
            Auto-refreshes every 30 seconds
          </p>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <ContactEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        contact={editContact}
        onSuccess={() => refresh()}
      />

      {/* Synthetic loading overlay */}
      {isSyntheticLoading && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 shadow-lg flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="text-sm font-medium">Creating synthetic contact...</span>
          </div>
        </div>
      )}
    </div>
  )
}
