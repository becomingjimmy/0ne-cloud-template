/**
 * Skool Post API Client
 *
 * Functions for creating community posts and uploading attachments.
 * Uses the same cookie-based auth as skool-client.ts
 *
 * @example
 * // Upload an image and create a post
 * const upload = await uploadFileFromUrl('https://example.com/image.jpg', 'fruitful')
 * if ('fileId' in upload) {
 *   const result = await createPost({
 *     groupSlug: 'fruitful',
 *     title: 'My Post',
 *     body: 'Content here...',
 *     attachmentIds: [upload.fileId]
 *   })
 * }
 */

import { SKOOL_API } from './config'
import { getSkoolClient } from './skool-client'
import type {
  CreatePostParams,
  CreatePostResult,
  UploadResult,
  UploadError,
} from '../types'

// Re-export types for convenience
export type { CreatePostParams, CreatePostResult, UploadResult, UploadError }

// =============================================================================
// INTERNAL HELPERS
// =============================================================================

/**
 * Get group ID from group slug
 * The post API uses group ID, not slug
 */
async function getGroupId(groupSlug: string): Promise<string | null> {
  try {
    const client = getSkoolClient()
    const groups = await client.getGroups()
    const group = groups.find((g) => g.slug === groupSlug)
    return group?.id || null
  } catch (error) {
    console.error(`[PostClient] Error getting group ID for ${groupSlug}:`, error)
    return null
  }
}

/**
 * Extract AWS WAF token from cookies
 * Required for Skool API POST requests
 */
function getWafToken(cookies: string): string {
  const match = cookies.match(/aws-waf-token=([^;]+)/)
  return match ? match[1] : ''
}

/**
 * Make authenticated request to Skool API
 */
async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const cookies = process.env.SKOOL_COOKIES || ''
  if (!cookies) {
    throw new Error('SKOOL_COOKIES environment variable is not set')
  }

  // Extract WAF token for POST requests
  const wafToken = getWafToken(cookies)

  return fetch(url, {
    ...options,
    headers: {
      accept: '*/*',
      'content-type': 'application/json',
      cookie: cookies,
      origin: 'https://www.skool.com',
      referer: 'https://www.skool.com/',
      'x-aws-waf-token': wafToken, // Required for Skool API
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...options.headers,
    },
  })
}

/**
 * Fetch image from URL and return as blob
 */
async function fetchImageAsBlob(imageUrl: string): Promise<Blob> {
  const response = await fetch(imageUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
  }
  return response.blob()
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Upload an image from URL to Skool
 *
 * Downloads the image and uploads it to Skool's file storage.
 * Returns a file_id that can be used as an attachment in posts.
 *
 * @param imageUrl - Public URL of the image to upload
 * @param groupSlug - Group slug (e.g., 'fruitful')
 * @returns Object with fileId on success, or error message
 *
 * @example
 * const result = await uploadFileFromUrl('https://example.com/image.jpg', 'fruitful')
 * if ('fileId' in result) {
 *   console.log('Uploaded:', result.fileId)
 * } else {
 *   console.error('Error:', result.error)
 * }
 */
export async function uploadFileFromUrl(
  imageUrl: string,
  groupSlug: string
): Promise<UploadResult | UploadError> {
  console.log(`[PostClient] Uploading file from URL: ${imageUrl}`)

  try {
    // Get the group ID
    const groupId = await getGroupId(groupSlug)
    if (!groupId) {
      return { error: `Group not found: ${groupSlug}` }
    }

    // Download the image
    const imageBlob = await fetchImageAsBlob(imageUrl)
    console.log(`[PostClient] Downloaded image: ${imageBlob.size} bytes, type: ${imageBlob.type}`)

    // Determine file extension from content type
    const contentType = imageBlob.type || 'image/jpeg'
    const extension = contentType.split('/')[1] || 'jpg'
    const filename = `upload-${Date.now()}.${extension}`

    // Create FormData for upload
    const formData = new FormData()
    formData.append('file', imageBlob, filename)

    // Get cookies for auth
    const cookies = process.env.SKOOL_COOKIES || ''
    if (!cookies) {
      return { error: 'SKOOL_COOKIES environment variable is not set' }
    }

    // Extract WAF token for POST requests
    const wafToken = getWafToken(cookies)

    // Confirmed endpoint: POST https://api2.skool.com/files
    const endpoint = `${SKOOL_API.BASE_URL}/files`
    console.log(`[PostClient] Uploading to: ${endpoint}`)

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        cookie: cookies,
        origin: 'https://www.skool.com',
        referer: `https://www.skool.com/${groupSlug}`,
        'x-aws-waf-token': wafToken, // Required for Skool API
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        // Note: Don't set content-type for FormData - let browser set it with boundary
      },
      body: formData,
    })

    console.log(`[PostClient] Upload response: ${response.status} ${response.statusText}`)

    if (response.ok) {
      const data = await response.json()
      console.log(`[PostClient] Upload success:`, JSON.stringify(data, null, 2))

      // Look for file ID in various response formats
      const fileId =
        data.file_id ||
        data.fileId ||
        data.id ||
        data.attachment_id ||
        data.attachmentId ||
        data.file?.id ||
        data.data?.id

      if (fileId) {
        return {
          fileId: fileId,
          url: data.url || data.file?.url,
        }
      }

      // If we got a 200 but can't find the ID, return the raw response
      return {
        error: 'Upload succeeded but could not find file ID in response',
        details: data,
      }
    }

    // For errors, return the error
    const errorText = await response.text()
    console.log(`[PostClient] Upload error response:`, errorText)
    return {
      error: `Upload failed: HTTP ${response.status}`,
      details: errorText,
    }
  } catch (error) {
    console.error('[PostClient] Upload error:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown upload error',
      details: error,
    }
  }
}

/**
 * Create a community post in a Skool group
 *
 * **IMPORTANT:** Skool does NOT render HTML. Content must be plain text.
 * Use markdown-style links: `[Link Text](https://example.com)`
 *
 * @param params - Post creation parameters
 * @returns Result with postId and postUrl on success, or error message
 *
 * @example
 * const result = await createPost({
 *   groupSlug: 'fruitful',
 *   title: 'Exciting Announcement!',
 *   body: 'Plain text content with [a link](https://example.com)...',
 *   categoryId: 'abc123', // optional - get from /settings/categories
 *   attachmentIds: ['file123'], // optional - from uploadFileFromUrl
 *   videoLinks: ['https://youtube.com/watch?v=xxx'], // optional
 * })
 *
 * if (result.success) {
 *   console.log('Posted!', result.postUrl)
 * } else {
 *   console.error('Failed:', result.error)
 * }
 */
export async function createPost(params: CreatePostParams): Promise<CreatePostResult> {
  const { groupSlug, title, body, categoryId, attachmentIds, videoLinks } = params

  console.log(`[PostClient] Creating post in ${groupSlug}: "${title}"`)

  try {
    // Get the group ID
    const groupId = await getGroupId(groupSlug)
    if (!groupId) {
      return {
        success: false,
        error: `Group not found: ${groupSlug}`,
      }
    }

    console.log(`[PostClient] Group ID: ${groupId}`)

    // Build the post payload - confirmed structure from browser DevTools
    // Top level: post_type, group_id
    // Everything else in metadata object
    const payload = {
      post_type: 'generic',
      group_id: groupId,
      metadata: {
        title,
        content: body,
        attachments: attachmentIds?.join(',') || '',
        labels: categoryId || '',
        action: 0,
        video_ids: videoLinks?.join(',') || '',
      },
    }

    console.log(`[PostClient] Post payload:`, JSON.stringify(payload, null, 2))

    // Confirmed endpoint from browser DevTools capture
    // POST https://api2.skool.com/posts?follow=true
    const endpoint = `${SKOOL_API.BASE_URL}/posts?follow=true`
    console.log(`[PostClient] Creating post at: ${endpoint}`)

    const response = await fetchWithAuth(endpoint, {
      method: 'POST',
      body: JSON.stringify(payload),
    })

    console.log(`[PostClient] Post response: ${response.status} ${response.statusText}`)

    if (response.ok) {
      const data = await response.json()
      console.log(`[PostClient] Post created:`, JSON.stringify(data, null, 2))

      // Extract post ID from various response formats
      const postId =
        data.post_id ||
        data.postId ||
        data.id ||
        data.post?.id ||
        data.data?.id

      // Build post URL
      const postUrl = postId
        ? `https://www.skool.com/${groupSlug}/community?p=${postId}`
        : undefined

      return {
        success: true,
        postId,
        postUrl,
        rawResponse: data,
      }
    }

    // For errors, return the error details
    const errorText = await response.text()
    console.log(`[PostClient] Post error response:`, errorText)

    // Try to parse error JSON
    try {
      const errorJson = JSON.parse(errorText)
      return {
        success: false,
        error: errorJson.message || errorJson.error || `HTTP ${response.status}`,
        rawResponse: errorJson,
      }
    } catch {
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
      }
    }
  } catch (error) {
    console.error('[PostClient] Create post error:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating post',
    }
  }
}

/**
 * Get community categories/labels for a group by scraping the group's community page
 *
 * Skool embeds category data in the __NEXT_DATA__ script tag on the page.
 * We scrape this to get the actual live categories.
 *
 * @param groupSlug - Group slug (e.g., 'fruitful')
 * @returns Array of categories with id and name
 */
export async function getCategories(
  groupSlug: string
): Promise<{ id: string; name: string; position?: number }[] | { error: string }> {
  console.log(`[PostClient] Getting categories for ${groupSlug} via page scrape`)

  try {
    const cookies = process.env.SKOOL_COOKIES || ''
    if (!cookies) {
      return { error: 'SKOOL_COOKIES environment variable is not set' }
    }

    // Fetch the community page which contains __NEXT_DATA__
    const pageUrl = `https://www.skool.com/${groupSlug}/community`
    console.log(`[PostClient] Fetching page: ${pageUrl}`)

    const response = await fetch(pageUrl, {
      headers: {
        cookie: cookies,
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    })

    if (!response.ok) {
      return { error: `Failed to fetch page: HTTP ${response.status}` }
    }

    const html = await response.text()

    // Extract __NEXT_DATA__ JSON from the script tag
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/)
    if (!nextDataMatch) {
      console.error('[PostClient] Could not find __NEXT_DATA__ in page')
      return { error: 'Could not find __NEXT_DATA__ in page' }
    }

    const nextData = JSON.parse(nextDataMatch[1])
    console.log(`[PostClient] Parsed __NEXT_DATA__, looking for labels/categories...`)

    // Navigate to find labels in the page props
    // Structure: props.pageProps.group.labels or similar
    const pageProps = nextData?.props?.pageProps
    if (!pageProps) {
      return { error: 'Could not find pageProps in __NEXT_DATA__' }
    }

    // Try different paths where labels might be stored
    const labels =
      pageProps.group?.labels ||
      pageProps.labels ||
      pageProps.community?.labels ||
      pageProps.initialData?.group?.labels

    if (!labels || !Array.isArray(labels)) {
      console.log(`[PostClient] pageProps keys:`, Object.keys(pageProps))
      if (pageProps.group) {
        console.log(`[PostClient] group keys:`, Object.keys(pageProps.group))
      }
      return { error: 'Could not find labels array in page data' }
    }

    console.log(`[PostClient] Found ${labels.length} categories:`, JSON.stringify(labels, null, 2))

    // Map to our format
    return labels.map((label: { id: string; name: string; position?: number }, index: number) => ({
      id: label.id,
      name: label.name,
      position: label.position ?? index,
    }))
  } catch (error) {
    console.error('[PostClient] Error fetching categories:', error)
    return {
      error: error instanceof Error ? error.message : 'Unknown error fetching categories',
    }
  }
}

// =============================================================================
// DISCOVERY HELPER
// =============================================================================

/**
 * Debug helper to discover Skool API endpoints
 *
 * Run this function and follow the browser DevTools instructions
 * to discover the correct endpoints for your Skool account.
 *
 * @example
 * // In a test file or API route:
 * import { discoverEndpoints } from './post-client'
 * await discoverEndpoints('fruitful')
 */
export async function discoverEndpoints(groupSlug: string): Promise<{
  groupId: string | null
  instructions: string[]
}> {
  const groupId = await getGroupId(groupSlug)

  return {
    groupId,
    instructions: [
      '=== ENDPOINT DISCOVERY GUIDE ===',
      '',
      `Group ID for "${groupSlug}": ${groupId || 'NOT FOUND'}`,
      '',
      'To find the correct endpoints:',
      '',
      '1. UPLOAD ENDPOINT:',
      `   - Open https://www.skool.com/${groupSlug}`,
      '   - Open Chrome DevTools > Network tab',
      '   - Create a new post and attach an image',
      '   - Look for POST request with multipart/form-data',
      '   - Note the URL and check the Response for file_id format',
      '',
      '2. POST ENDPOINT:',
      `   - Open https://www.skool.com/${groupSlug}`,
      '   - Open Chrome DevTools > Network tab',
      '   - Create and submit a new post',
      '   - Look for POST request with JSON body containing title/body',
      '   - Note the URL and request payload format',
      '',
      '3. CATEGORIES ENDPOINT:',
      `   - Open https://www.skool.com/${groupSlug}/about`,
      '   - Open Chrome DevTools > Network tab',
      '   - Look for API calls containing categories or labels',
      '   - Or check the __NEXT_DATA__ script tag for category data',
      '',
      'Once discovered, update the endpoints in post-client.ts',
    ],
  }
}
