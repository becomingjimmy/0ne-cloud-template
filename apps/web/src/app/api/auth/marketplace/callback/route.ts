/**
 * GHL OAuth Callback
 *
 * Handles the OAuth callback from GHL Marketplace app installation.
 * Exchanges authorization code for access + refresh tokens.
 *
 * Flow:
 * 1. User installs app in GHL Marketplace
 * 2. GHL redirects to this callback with ?code=xxx
 * 3. We exchange code for tokens
 * 4. Display tokens for manual env setup (or store in DB for multi-tenant)
 */

import { NextResponse } from 'next/server'

const GHL_OAUTH_URL = 'https://services.leadconnectorhq.com/oauth/token'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Handle OAuth errors
  if (error) {
    return NextResponse.json(
      { error, description: searchParams.get('error_description') },
      { status: 400 }
    )
  }

  // Require authorization code
  if (!code) {
    // If no code, show instructions to start OAuth flow
    const clientId = process.env.GHL_MARKETPLACE_CLIENT_ID
    const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/marketplace/callback`

    const authUrl = `https://marketplace.gohighlevel.com/oauth/chooselocation?response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&client_id=${clientId}&scope=conversations.readonly%20conversations.write%20conversations/message.readonly%20conversations/message.write%20contacts.readonly%20contacts.write`

    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>GHL OAuth Setup</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
    h1 { color: #333; }
    a { color: #FF692D; }
    code { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>GHL Marketplace OAuth Setup</h1>
  <p>Click the button below to authorize the app and get your OAuth tokens:</p>
  <p><a href="${authUrl}" style="display: inline-block; background: #FF692D; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Authorize with GHL</a></p>
  <h2>After Authorization</h2>
  <p>You'll be redirected back here with your tokens. Copy them to your <code>.env.local</code> file.</p>
</body>
</html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    })
  }

  // Exchange code for tokens
  try {
    const clientId = process.env.GHL_MARKETPLACE_CLIENT_ID!
    const clientSecret = process.env.GHL_MARKETPLACE_CLIENT_SECRET!

    // Log for debugging (will show in Vercel logs)
    console.log('[OAuth] Exchanging code for tokens', {
      hasClientId: !!clientId,
      clientIdLength: clientId?.length,
      hasClientSecret: !!clientSecret,
      code: code?.substring(0, 10) + '...',
    })

    // Try with Basic Auth header (some OAuth providers require this)
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

    const response = await fetch(GHL_OAUTH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/marketplace/callback`,
        user_type: 'Location',
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>OAuth Error</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; }
    .error { background: #fee; border: 1px solid #fcc; padding: 16px; border-radius: 8px; }
    pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; }
  </style>
</head>
<body>
  <h1>OAuth Error</h1>
  <div class="error">
    <p><strong>Error:</strong> ${data.error || 'Unknown error'}</p>
    <p>${data.error_description || ''}</p>
  </div>
  <h3>Debug Info</h3>
  <pre>Client ID set: ${!!process.env.GHL_MARKETPLACE_CLIENT_ID}
Client ID length: ${process.env.GHL_MARKETPLACE_CLIENT_ID?.length || 0}
Client ID preview: ${process.env.GHL_MARKETPLACE_CLIENT_ID?.substring(0, 10)}...
App URL: ${process.env.NEXT_PUBLIC_APP_URL}
Redirect URI: ${process.env.NEXT_PUBLIC_APP_URL}/api/auth/marketplace/callback</pre>
  <h3>Full Response</h3>
  <pre>${JSON.stringify(data, null, 2)}</pre>
</body>
</html>
      `, {
        status: 400,
        headers: { 'Content-Type': 'text/html' }
      })
    }

    // Success - display tokens
    return new Response(`
<!DOCTYPE html>
<html>
<head>
  <title>OAuth Success</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 20px; }
    h1 { color: #22c55e; }
    .success { background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; border-radius: 8px; margin-bottom: 20px; }
    pre { background: #1e1e1e; color: #d4d4d4; padding: 16px; border-radius: 8px; overflow-x: auto; }
    .copy-btn { background: #FF692D; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; margin-top: 8px; }
    .warning { background: #fef3c7; border: 1px solid #fcd34d; padding: 12px; border-radius: 6px; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>✅ OAuth Authorization Successful!</h1>
  <div class="success">
    <p><strong>Location ID:</strong> ${data.locationId || 'N/A'}</p>
    <p><strong>User ID:</strong> ${data.userId || 'N/A'}</p>
    <p><strong>Scopes:</strong> ${data.scope || 'N/A'}</p>
  </div>

  <h2>Add to .env.local</h2>
  <pre id="env-vars">
# GHL OAuth Tokens (obtained ${new Date().toISOString()})
GHL_MARKETPLACE_ACCESS_TOKEN=${data.access_token}
GHL_MARKETPLACE_REFRESH_TOKEN=${data.refresh_token}
GHL_MARKETPLACE_TOKEN_EXPIRES=${Date.now() + (data.expires_in * 1000)}
  </pre>
  <button class="copy-btn" onclick="navigator.clipboard.writeText(document.getElementById('env-vars').textContent)">
    Copy to Clipboard
  </button>

  <div class="warning">
    <strong>⚠️ Important:</strong>
    <ul>
      <li>Add these to <code>.env.local</code> AND Vercel environment variables</li>
      <li>The refresh token is permanent - guard it carefully</li>
      <li>After adding, run: <code>bun run scripts/register-ghl-provider.ts</code></li>
    </ul>
  </div>

  <h2>Full Response</h2>
  <pre>${JSON.stringify(data, null, 2)}</pre>
</body>
</html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    })

  } catch (error) {
    console.error('OAuth error:', error)
    return NextResponse.json(
      { error: 'Token exchange failed', details: String(error) },
      { status: 500 }
    )
  }
}
