
import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API_URL = 'http://localhost:3000/api/emails'
const SETTINGS_URL = 'http://localhost:3000/api/settings'
const AUTH_URL = 'http://localhost:3000/auth'

type Email = {
  id: number
  sender_email: string
  recipient_email: string
  subject: string
  body: string
  scheduled_at: string
  sent_at: string | null
  status: 'scheduled' | 'processing' | 'sent' | 'failed'
}

type Settings = {
  minimumDelaySeconds: number
  globalHourlyLimit: number
  senderHourlyLimit: number
}

type AuthUser = {
  name?: string
  displayName?: string
  email?: string
  picture?: string
  photos?: Array<{ value?: string }>
}

function extractEmails(text: string): string[] {
  const matches =
    text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []

  return [...new Set(matches.map((email) => email.toLowerCase()))]
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [authError, setAuthError] = useState('')
  const [loggingOut, setLoggingOut] = useState(false)

  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [message, setMessage] = useState('')
  const [filter, setFilter] = useState('all')

  const [senderEmail, setSenderEmail] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [scheduledAt, setScheduledAt] = useState('')

  const [leadEmails, setLeadEmails] = useState<string[]>([])
  const [leadFileName, setLeadFileName] = useState('')

  const [minimumDelaySeconds, setMinimumDelaySeconds] = useState(2)
  const [globalHourlyLimit, setGlobalHourlyLimit] = useState(100)
  const [senderHourlyLimit, setSenderHourlyLimit] = useState(30)

  const loadEmails = useCallback(async () => {
    try {
      const response = await fetch(API_URL, { credentials: 'include' })

      if (!response.ok) {
        throw new Error('Could not load emails')
      }

      const data: Email[] = await response.json()
      setEmails(data)
      setError('')
    } catch {
      setError(
        'Cannot connect to the backend. Make sure the API is running on port 3000.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(SETTINGS_URL, { credentials: 'include' })

      if (!response.ok) {
        throw new Error('Could not load sending settings')
      }

      const settings: Settings = await response.json()

      setMinimumDelaySeconds(settings.minimumDelaySeconds)
      setGlobalHourlyLimit(settings.globalHourlyLimit)
      setSenderHourlyLimit(settings.senderHourlyLimit)
    } catch (err) {
      console.error('Unable to load settings:', err)
    }
  }, [])

  useEffect(() => {
    let active = true

    async function checkAuth() {
      try {
        const response = await fetch(`${AUTH_URL}/me`, {
          credentials: 'include',
        })
        const data = await response.json().catch(() => ({}))

        if (!active) return

        if (response.ok && data.authenticated === true) {
          setUser(data.user ?? data.profile ?? data)
          setAuthError('')
        } else {
          setUser(null)
        }
      } catch {
        if (active) {
          setUser(null)
          setAuthError('Cannot connect to the authentication server. Make sure the backend is running on port 3000.')
        }
      } finally {
        if (active) setAuthLoading(false)
      }
    }

    void checkAuth()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!user) return
    void loadEmails()
    void loadSettings()
  }, [user, loadEmails, loadSettings])

  function signInWithGoogle() {
    window.location.href = `${AUTH_URL}/google`
  }

  async function logout() {
    setLoggingOut(true)
    setAuthError('')
    try {
      // Try POST first; if the backend exposes logout as GET, use that route instead.
      let response = await fetch(`${AUTH_URL}/logout`, {
        method: 'POST',
        credentials: 'include',
      })
      if (response.status === 404 || response.status === 405) {
        response = await fetch(`${AUTH_URL}/logout`, {
          method: 'GET',
          credentials: 'include',
        })
      }
      if (!response.ok) {
        throw new Error('The server could not complete logout. Check the backend /auth/logout route.')
      }
      setUser(null)
      setEmails([])
      setMessage('You have been signed out.')
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Unable to log out.')
    } finally {
      setLoggingOut(false)
    }
  }

  async function saveSettings() {
    setSavingSettings(true)
    setMessage('')
    setError('')

    try {
      if (
        !Number.isInteger(minimumDelaySeconds) ||
        minimumDelaySeconds < 0 ||
        minimumDelaySeconds > 3600 ||
        !Number.isInteger(globalHourlyLimit) ||
        globalHourlyLimit < 1 ||
        globalHourlyLimit > 100000 ||
        !Number.isInteger(senderHourlyLimit) ||
        senderHourlyLimit < 1 ||
        senderHourlyLimit > 100000
      ) {
        throw new Error('Please enter valid sending-limit values.')
      }

      if (senderHourlyLimit > globalHourlyLimit) {
        throw new Error(
          'The per-sender hourly limit cannot exceed the global hourly limit.',
        )
      }

      const response = await fetch(SETTINGS_URL, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minimumDelaySeconds,
          globalHourlyLimit,
          senderHourlyLimit,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to save settings')
      }

      setMessage('Sending limits saved successfully.')
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to save settings',
      )
    } finally {
      setSavingSettings(false)
    }
  }

  async function scheduleEmail(
    event: React.FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault()
    setSubmitting(true)
    setMessage('')
    setError('')

    try {
      if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) {
        throw new Error('Please select a valid delivery date and time.')
      }

      if (new Date(scheduledAt).getTime() < Date.now()) {
        throw new Error('The scheduled time must be in the future.')
      }

      if (leadFileName && leadEmails.length === 0) {
        throw new Error(
          'The uploaded file contains no recognizable email addresses.',
        )
      }

      if (!senderEmail.trim() || !subject.trim() || !body.trim()) {
        throw new Error('Please complete the sender, subject, and message.')
      }

      const isBulk = leadEmails.length > 0

      if (!isBulk && !recipientEmail.trim()) {
        throw new Error('Please enter a recipient email address.')
      }

      const payload = isBulk
        ? {
            senderEmail: senderEmail.trim(),
            recipientEmails: leadEmails,
            subject: subject.trim(),
            body: body.trim(),
            scheduledAt: new Date(scheduledAt).toISOString(),
            idempotencyKey: crypto.randomUUID(),
          }
        : {
            senderEmail: senderEmail.trim(),
            recipientEmail: recipientEmail.trim(),
            subject: subject.trim(),
            body: body.trim(),
            scheduledAt: new Date(scheduledAt).toISOString(),
            idempotencyKey: crypto.randomUUID(),
          }

      const response = await fetch(
        isBulk ? `${API_URL}/bulk` : API_URL,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Unable to schedule email')
      }

      if (isBulk) {
        setMessage(
          `Bulk scheduling complete: ${result.scheduledCount} email(s) scheduled; ${result.skippedDuplicates ?? 0} duplicate(s) skipped.`,
        )
      } else {
        setMessage('Email scheduled successfully.')
      }

      setRecipientEmail('')
      setSubject('')
      setBody('')
      setScheduledAt('')
      setLeadEmails([])
      setLeadFileName('')

      const fileInput = document.getElementById(
        'leadFile',
      ) as HTMLInputElement | null

      if (fileInput) fileInput.value = ''

      await loadEmails()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Something went wrong',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function handleLeadFile(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0]

    setMessage('')
    setError('')

    if (!file) {
      setLeadEmails([])
      setLeadFileName('')
      return
    }

    const extension = file.name.split('.').pop()?.toLowerCase()

    if (extension !== 'csv' && extension !== 'txt') {
      setLeadEmails([])
      setLeadFileName('')
      event.target.value = ''
      setError('Please upload a CSV or TXT file.')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setLeadEmails([])
      setLeadFileName('')
      event.target.value = ''
      setError('The file is too large. Maximum file size is 5 MB.')
      return
    }

    void file.text().then((text) => {
      const extractedEmails = extractEmails(text)

      if (extractedEmails.length > 1000) {
        setLeadEmails([])
        setLeadFileName('')
        setError('A maximum of 1000 unique recipients is allowed.')
        return
      }

      setLeadEmails(extractedEmails)
      setLeadFileName(file.name)

      if (extractedEmails.length === 0) {
        setError('No email addresses were found in this file.')
      } else {
        setMessage(
          `Found ${extractedEmails.length} unique email address(es).`,
        )
      }
    }).catch(() => {
      setLeadEmails([])
      setLeadFileName('')
      setError('Unable to read this file. Please try another file.')
    })
  }

  const counts = {
    all: emails.length,
    scheduled: emails.filter(
      (email) => email.status === 'scheduled',
    ).length,
    sent: emails.filter(
      (email) => email.status === 'sent',
    ).length,
    failed: emails.filter(
      (email) => email.status === 'failed',
    ).length,
  }

  const visibleEmails =
    filter === 'all'
      ? emails
      : emails.filter((email) => email.status === filter)

  function formatDate(value: string) {
    return new Date(value).toLocaleString()
  }

  const minDateTime = new Date(
    Date.now() - new Date().getTimezoneOffset() * 60000,
  ).toISOString().slice(0, 16)

  if (authLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center' }}>
          <h1>ReachInbox</h1>
          <p>Checking your sign-in session...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: '#f5f7fb' }}>
        <div style={{ width: '100%', maxWidth: 420, padding: 32, borderRadius: 18, background: '#fff', boxShadow: '0 12px 40px rgba(20, 30, 60, 0.10)', textAlign: 'center' }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: '0 auto 16px', display: 'grid', placeItems: 'center', background: '#4169e1', color: '#fff', fontSize: 28, fontWeight: 700 }}>R</div>
          <h1 style={{ marginBottom: 8 }}>Welcome to ReachInbox</h1>
          <p style={{ color: '#64748b', marginBottom: 24 }}>Sign in with Google to open your email workspace.</p>
          {authError && <div role="alert" style={{ color: '#b91c1c', background: '#fef2f2', padding: 12, borderRadius: 8, marginBottom: 16 }}>{authError}</div>}
          <button type="button" onClick={signInWithGoogle} style={{ width: '100%', padding: '12px 16px', border: '1px solid #d1d5db', borderRadius: 10, background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
            Continue with Google
          </button>
          <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 20 }}>Local development · OAuth session</p>
        </div>
      </div>
    )
  }

  const displayName = user.name || user.displayName || user.email || 'Signed-in user'
  const avatarUrl = user.picture || user.photos?.[0]?.value

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">R</div>
          <div>
            <strong>ReachInbox</strong>
            <span>Email workspace</span>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>

        <button className="nav-item active" type="button">
          <span>▦</span> Email scheduler
        </button>

        <div className="sidebar-note">
          <span className="online-dot" /> Local development
        </div>

        <div className="sidebar-bottom" style={{ gap: 10 }}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="Google profile" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
          ) : (
            <div className="avatar">{displayName.slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <strong>{displayName}</strong>
            <span>{user.email || 'Google account'}</span>
          </div>
          <button type="button" className="secondary-button" onClick={() => void logout()} disabled={loggingOut}>
            {loggingOut ? 'Signing out...' : 'Logout'}
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <span className="breadcrumb">
              Workspace / Email scheduler
            </span>
            <h1>Email scheduler</h1>
            <p>Compose, schedule and track your outbound emails.</p>
          </div>

          <button
            className="refresh-button"
            onClick={() => {
              void loadEmails()
              void loadSettings()
            }}
            type="button"
          >
            ↻ Refresh
          </button>
        </header>

        {authError && <div className="alert error-alert">{authError}</div>}
        {error && <div className="alert error-alert">{error}</div>}
        {message && <div className="alert success-alert">{message}</div>}

        <section className="stats-grid">
          <article className="stat-card">
            <span className="stat-label">Total emails</span>
            <strong>{counts.all}</strong>
            <span className="stat-foot">Stored in PostgreSQL</span>
          </article>

          <article className="stat-card">
            <span className="stat-label">Scheduled</span>
            <strong>{counts.scheduled}</strong>
            <span className="stat-foot">
              <span className="mini-dot amber" /> Awaiting delivery
            </span>
          </article>

          <article className="stat-card">
            <span className="stat-label">Sent</span>
            <strong>{counts.sent}</strong>
            <span className="stat-foot">
              <span className="mini-dot green" /> Successfully sent
            </span>
          </article>

          <article className="stat-card">
            <span className="stat-label">Failed</span>
            <strong>{counts.failed}</strong>
            <span className="stat-foot">
              <span className="mini-dot red" /> Need attention
            </span>
          </article>
        </section>

        <section className="workspace-grid">
          <article className="panel compose-panel">
            <div className="panel-heading">
              <div>
                <h2>Compose email</h2>
                <p>Choose recipients and a delivery time.</p>
              </div>
              <span className="heading-icon">✉</span>
            </div>

            <form onSubmit={scheduleEmail}>
              <label htmlFor="sender">From email</label>
              <input
                id="sender"
                type="email"
                placeholder="you@example.com"
                value={senderEmail}
                onChange={(event) => setSenderEmail(event.target.value)}
                required
              />

              <label htmlFor="recipient">Recipient email</label>
              <input
                id="recipient"
                type="email"
                placeholder="recipient@example.com"
                value={recipientEmail}
                onChange={(event) => setRecipientEmail(event.target.value)}
                required={leadEmails.length === 0}
                disabled={leadEmails.length > 0}
              />

              <label htmlFor="leadFile">Upload leads (CSV or TXT)</label>
              <input
                id="leadFile"
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                onChange={handleLeadFile}
              />

              {leadFileName && (
                <div className="form-footnote">
                  <p>File: <strong>{leadFileName}</strong></p>
                  <p>{leadEmails.length} unique email address(es) found.</p>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      setLeadEmails([])
                      setLeadFileName('')
                      setMessage('')
                      setError('')
                      const input = document.getElementById(
                        'leadFile',
                      ) as HTMLInputElement | null
                      if (input) input.value = ''
                    }}
                  >
                    Remove uploaded file
                  </button>
                </div>
              )}

              <p className="form-footnote">
                Upload a CSV or text file to schedule one email per unique
                address. Maximum 1000 recipients per batch.
              </p>

              <label htmlFor="subject">Subject</label>
              <input
                id="subject"
                placeholder="What's this email about?"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                required
              />

              <label htmlFor="body">Message</label>
              <textarea
                id="body"
                placeholder="Write your email here..."
                rows={5}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                required
              />

              <label htmlFor="scheduledAt">Schedule delivery</label>
              <input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(event) => setScheduledAt(event.target.value)}
                min={minDateTime}
                required
              />

              <div className="settings-section">
                <div className="panel-heading">
                  <div>
                    <h2>Sending limits</h2>
                    <p>Configure the worker's rate limits.</p>
                  </div>
                </div>

                <label htmlFor="minimumDelaySeconds">
                  Minimum delay between sends (seconds)
                </label>
                <input
                  id="minimumDelaySeconds"
                  type="number"
                  min={0}
                  max={3600}
                  step={1}
                  value={minimumDelaySeconds}
                  onChange={(event) =>
                    setMinimumDelaySeconds(Number(event.target.value))
                  }
                  required
                />

                <label htmlFor="globalHourlyLimit">
                  Global hourly limit
                </label>
                <input
                  id="globalHourlyLimit"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={globalHourlyLimit}
                  onChange={(event) =>
                    setGlobalHourlyLimit(Number(event.target.value))
                  }
                  required
                />

                <label htmlFor="senderHourlyLimit">
                  Per-sender hourly limit
                </label>
                <input
                  id="senderHourlyLimit"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={senderHourlyLimit}
                  onChange={(event) =>
                    setSenderHourlyLimit(Number(event.target.value))
                  }
                  required
                />

                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => void saveSettings()}
                  disabled={savingSettings}
                >
                  {savingSettings ? 'Saving settings...' : 'Save sending limits'}
                </button>

                <p className="form-footnote">
                  Settings are stored in Redis and shared by workers.
                  Hourly limits use fixed hourly windows.
                </p>
              </div>

              <button
                className="primary-button"
                disabled={submitting}
                type="submit"
              >
                {submitting
                  ? 'Scheduling...'
                  : leadEmails.length > 0
                    ? `↗ Schedule ${leadEmails.length} emails`
                    : '↗ Schedule email'}
              </button>
            </form>

            <p className="form-footnote">
              Emails are stored in PostgreSQL and queued for the background
              worker.
            </p>
          </article>

          <article className="panel email-list-panel">
            <div className="panel-heading">
              <div>
                <h2>Email activity</h2>
                <p>Your latest scheduled and sent messages.</p>
              </div>
              <span className="count-pill">{emails.length} total</span>
            </div>

            <div className="filter-row">
              {[
                ['all', 'All'],
                ['scheduled', 'Scheduled'],
                ['processing', 'Processing'],
                ['sent', 'Sent'],
                ['failed', 'Failed'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`filter-button ${filter === value ? 'selected' : ''}`}
                  onClick={() => setFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            {loading ? (
              <div className="empty-state">Loading emails...</div>
            ) : visibleEmails.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">✉</div>
                <strong>No emails here yet</strong>
                <span>
                  Scheduled and sent messages will appear here.
                </span>
              </div>
            ) : (
              <div className="email-list">
                {visibleEmails.map((email) => (
                  <div className="email-row" key={email.id}>
                    <div className="email-symbol">✉</div>

                    <div className="email-details">
                      <strong>{email.subject}</strong>
                      <span>To: {email.recipient_email}</span>
                      <span className="email-date">
                        {email.sent_at
                          ? `Sent ${formatDate(email.sent_at)}`
                          : `Scheduled ${formatDate(email.scheduled_at)}`}
                      </span>
                    </div>

                    <span className={`status-badge status-${email.status}`}>
                      {email.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <button
              className="secondary-button"
              type="button"
              onClick={() => void loadEmails()}
            >
              Load latest activity
            </button>
          </article>
        </section>

        <footer className="page-footer">
          <span>ReachInbox Scheduler</span>
          <span>Powered by Express · PostgreSQL · BullMQ</span>
        </footer>
      </main>
    </div>
  )
}

export default App
