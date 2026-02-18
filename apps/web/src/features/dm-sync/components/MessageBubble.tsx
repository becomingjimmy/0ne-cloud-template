'use client'

/**
 * MessageBubble Component
 *
 * Individual message bubble for the conversation thread.
 * - Inbound: left-aligned, gray background
 * - Outbound: right-aligned, orange background
 */

import type { ConversationMessage } from '../hooks/use-conversation-detail'

// =============================================================================
// TYPES
// =============================================================================

interface MessageBubbleProps {
  message: ConversationMessage
}

// =============================================================================
// HELPERS
// =============================================================================

function formatTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function StatusIndicator({ status }: { status: 'synced' | 'pending' | 'failed' }) {
  switch (status) {
    case 'synced':
      return <span className="text-green-600" title="Synced to GHL">✓</span>
    case 'pending':
      return <span className="text-yellow-600 animate-pulse" title="Pending">⏳</span>
    case 'failed':
      return <span className="text-red-600" title="Failed to sync">✗</span>
    default:
      return null
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function MessageBubble({ message }: MessageBubbleProps) {
  const isOutbound = message.direction === 'outbound'

  return (
    <div
      className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}
    >
      <div
        className={`
          max-w-[75%] rounded-2xl px-4 py-2.5 shadow-sm
          ${
            isOutbound
              ? 'bg-[#FF692D] text-white rounded-br-md'
              : 'bg-[#F3F4F6] text-gray-900 rounded-bl-md'
          }
        `}
      >
        {/* Message Text */}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.message_text || 'Image Attachment(s)'}
        </p>

        {/* Timestamp + Status */}
        <div
          className={`
            flex items-center gap-1.5 mt-1 text-xs
            ${isOutbound ? 'text-white/70 justify-end' : 'text-gray-500'}
          `}
        >
          <span>{formatTime(message.created_at)}</span>
          {isOutbound && <StatusIndicator status={message.status} />}
        </div>
      </div>
    </div>
  )
}
