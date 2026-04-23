import { useState, useCallback, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { useLocale } from '@/i18n/context'

// ── Types ──────────────────────────────────────────────────────────

type TicketType = 'bug' | 'feature'
type TicketStatus = 'open' | 'in_progress' | 'closed'

interface Ticket {
  id: string
  title: string
  description: string
  status: TicketStatus
  type: TicketType
  priority: string
  creator_id: string
  creator_name: string
  labels: string[]
  created_at: string
  updated_at: string
  closed_at: string | null
}

interface TimelineEntry {
  type: 'comment' | 'status_change'
  created_at: string
  data: {
    id: string
    content?: string
    author_id?: string
    author_name?: string
    author_role?: string
    attachments?: string[]
    from_status?: string
    to_status?: string
    changed_by_id?: string
    changed_by_name?: string
  }
}

type PanelView = 'list' | 'create' | 'detail'

interface TicketPanelProps {
  onClose: () => void
}

// ── Helpers ────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

// ── Component ──────────────────────────────────────────────────────

export function TicketPanel({ onClose }: TicketPanelProps) {
  const { t } = useLocale()

  const [view, setView] = useState<PanelView>('list')
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all')
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [ticketsTotal, setTicketsTotal] = useState(0)
  const [ticketsLoading, setTicketsLoading] = useState(true)
  const [ticketsError, setTicketsError] = useState(false)

  // Detail view
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [timelineLoading, setTimelineLoading] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSending, setCommentSending] = useState(false)

  // Create form
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formType, setFormType] = useState<TicketType>('bug')
  const [formSubmitting, setFormSubmitting] = useState(false)
  const [formMsg, setFormMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const timelineEndRef = useRef<HTMLDivElement>(null)

  // ── Fetch tickets ──

  const fetchTickets = useCallback(async () => {
    setTicketsLoading(true)
    setTicketsError(false)
    try {
      const params = new URLSearchParams({ page: '1', limit: '50' })
      if (filter !== 'all') params.set('status', filter)
      const res = await window.electronAPI.ticket.list(params.toString())
      if (res.status >= 200 && res.status < 300) {
        const data = res.data as { data?: Ticket[]; total?: number }
        setTickets(data.data || [])
        setTicketsTotal(data.total || 0)
      } else {
        setTicketsError(true)
      }
    } catch {
      setTicketsError(true)
    } finally {
      setTicketsLoading(false)
    }
  }, [filter])

  useEffect(() => {
    if (view === 'list') fetchTickets()
  }, [view, fetchTickets])

  // ── Fetch timeline ──

  const fetchTimeline = useCallback(
    async (ticketId: string) => {
      setTimelineLoading(true)
      try {
        const res = await window.electronAPI.ticket.timeline(ticketId)
        if (res.status >= 200 && res.status < 300) {
          const data = res.data
          setTimeline(Array.isArray(data) ? data : [])
        }
      } catch {
        /* ignore */
      } finally {
        setTimelineLoading(false)
      }
    },
    []
  )

  const openDetail = useCallback(
    (ticket: Ticket) => {
      setSelectedTicket(ticket)
      setView('detail')
      setCommentText('')
      fetchTimeline(ticket.id)
    },
    [fetchTimeline]
  )

  // Auto-scroll timeline
  useEffect(() => {
    if (view === 'detail' && !timelineLoading) {
      timelineEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [timeline, view, timelineLoading])

  // ── Create ticket ──

  const handleCreate = useCallback(async () => {
    if (!formTitle.trim() || !formDesc.trim()) return
    setFormSubmitting(true)
    setFormMsg(null)
    try {
      const res = await window.electronAPI.ticket.create({
        title: formTitle.trim(),
        description: formDesc.trim(),
        type: formType,
      })
      if (res.status >= 200 && res.status < 300) {
        setFormMsg({ ok: true, text: t.ticket.formSuccess })
        setFormTitle('')
        setFormDesc('')
        setFormType('bug')
        setTimeout(() => {
          setFormMsg(null)
          setView('list')
        }, 1000)
      } else {
        setFormMsg({ ok: false, text: t.ticket.formError })
      }
    } catch {
      setFormMsg({ ok: false, text: t.ticket.formError })
    } finally {
      setFormSubmitting(false)
    }
  }, [formTitle, formDesc, formType, t])

  // ── Post comment ──

  const handleComment = useCallback(async () => {
    if (!commentText.trim() || !selectedTicket) return
    setCommentSending(true)
    try {
      const res = await window.electronAPI.ticket.comment(
        selectedTicket.id,
        commentText.trim()
      )
      if (res.status >= 200 && res.status < 300) {
        setCommentText('')
        fetchTimeline(selectedTicket.id)
      }
    } catch {
      /* ignore */
    } finally {
      setCommentSending(false)
    }
  }, [commentText, selectedTicket, fetchTimeline])

  // ── Status helpers ──

  const statusColor = (s: TicketStatus) => {
    if (s === 'open') return 'bg-amber-100 text-amber-700'
    if (s === 'in_progress') return 'bg-blue-100 text-blue-700'
    return 'bg-gray-100 text-gray-500'
  }

  const statusLabel = (s: string) => {
    if (s === 'open') return t.ticket.statusOpen
    if (s === 'in_progress') return t.ticket.statusInProgress
    return t.ticket.statusClosed
  }

  const typeLabel = (ty: TicketType) => (ty === 'bug' ? t.ticket.typeBug : t.ticket.typeFeature)

  // ── Filter tabs ──

  const filters: { key: TicketStatus | 'all'; label: string }[] = [
    { key: 'all', label: t.ticket.filterAll },
    { key: 'open', label: t.ticket.filterOpen },
    { key: 'in_progress', label: t.ticket.filterInProgress },
    { key: 'closed', label: t.ticket.filterClosed },
  ]

  // ── Render ──

  const isWindows = window.electronAPI.platform === 'win32'

  return (
    <div className={`fixed inset-0 z-50 flex items-stretch ${isWindows ? 'justify-start' : 'justify-end'}`} style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/25"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        className={`relative z-10 w-full max-w-[480px] bg-bg ${isWindows ? 'border-r' : 'border-l'} border-border flex flex-col shadow-xl`}
        initial={{ x: isWindows ? '-100%' : '100%' }}
        animate={{ x: 0 }}
        exit={{ x: isWindows ? '-100%' : '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-border shrink-0">
          <div className="flex items-center gap-3 h-full">
            {view !== 'list' && (
              <button
                onClick={() => setView('list')}
                className="text-xs text-text-muted hover:text-text-secondary cursor-pointer bg-transparent border-none leading-none"
              >
                &larr; {t.ticket.backToList}
              </button>
            )}
            <h2 className="font-serif text-sm text-text leading-none -translate-y-px">
              {view === 'create'
                ? t.ticket.createTicket
                : view === 'detail' && selectedTicket
                  ? `#${selectedTicket.id.slice(0, 8)}`
                  : t.ticket.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-text-faint hover:text-text-secondary cursor-pointer bg-transparent border-none text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* ── List View ── */}
        {view === 'list' && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Actions + Filters */}
            <div className="px-5 pt-4 pb-3 space-y-3 shrink-0">
              <button
                onClick={() => {
                  setFormMsg(null)
                  setView('create')
                }}
                className="w-full py-2 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity"
              >
                + {t.ticket.createTicket}
              </button>
              <div className="flex gap-1.5">
                {filters.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`px-3 py-1.5 rounded-full text-[11px] cursor-pointer transition-colors border-none ${
                      filter === f.key
                        ? 'bg-brand text-white'
                        : 'bg-black/[0.04] text-text-muted hover:bg-black/[0.08]'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Ticket List */}
            <div className="flex-1 overflow-y-auto px-5 pb-5">
              {ticketsLoading ? (
                <div className="flex justify-center py-10">
                  <div className="w-5 h-5 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                </div>
              ) : ticketsError ? (
                <p className="text-sm text-red-500 text-center py-10">{t.ticket.loadError}</p>
              ) : tickets.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-sm text-text-faint">{t.ticket.empty}</p>
                  <p className="text-xs text-text-faint mt-1">{t.ticket.emptyDesc}</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {tickets.map((ticket) => (
                    <button
                      key={ticket.id}
                      onClick={() => openDetail(ticket)}
                      className="w-full text-left rounded-xl border border-border bg-bg-card p-4 cursor-pointer hover:border-brand/30 transition-colors block"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <h3 className="text-sm text-text font-medium line-clamp-1 flex-1">
                          {ticket.title}
                        </h3>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${statusColor(ticket.status)}`}
                        >
                          {statusLabel(ticket.status)}
                        </span>
                      </div>
                      <p className="text-xs text-text-muted line-clamp-2 mb-3">
                        {ticket.description}
                      </p>
                      <div className="flex items-center gap-3 text-[10px] text-text-faint font-mono">
                        <span>{typeLabel(ticket.type)}</span>
                        <span className="ml-auto">{relativeTime(ticket.created_at)}</span>
                      </div>
                    </button>
                  ))}
                  {ticketsTotal > tickets.length && (
                    <p className="text-[10px] text-text-faint text-center pt-2">
                      {tickets.length} / {ticketsTotal}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Create View ── */}
        {view === 'create' && (
          <div className="flex-1 overflow-y-auto px-5 py-5">
            <div className="space-y-4">
              {/* Type */}
              <div>
                <label className="text-xs text-text-faint font-mono block mb-1.5">
                  {t.ticket.formType}
                </label>
                <div className="flex gap-2">
                  {(['bug', 'feature'] as TicketType[]).map((ty) => (
                    <button
                      key={ty}
                      onClick={() => setFormType(ty)}
                      className={`flex-1 py-2 rounded-lg text-xs cursor-pointer transition-colors border ${
                        formType === ty
                          ? 'border-brand bg-brand/[0.06] text-brand'
                          : 'border-border text-text-muted hover:border-brand/30'
                      }`}
                    >
                      {typeLabel(ty)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className="text-xs text-text-faint font-mono block mb-1.5">
                  {t.ticket.formTitle}
                </label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder={t.ticket.formTitlePlaceholder}
                  maxLength={200}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-sm text-text placeholder:text-text-faint/50 outline-none focus:border-brand/40 transition-colors"
                />
              </div>

              {/* Description */}
              <div>
                <label className="text-xs text-text-faint font-mono block mb-1.5">
                  {t.ticket.formDescription}
                </label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder={t.ticket.formDescriptionPlaceholder}
                  rows={5}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg-card text-sm text-text placeholder:text-text-faint/50 outline-none focus:border-brand/40 transition-colors resize-none"
                />
              </div>

              {/* Submit */}
              <button
                onClick={handleCreate}
                disabled={formSubmitting || !formTitle.trim() || !formDesc.trim()}
                className="w-full py-2.5 rounded-lg text-sm bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {formSubmitting ? t.ticket.formSubmitting : t.ticket.formSubmit}
              </button>

              {formMsg && (
                <p className={`text-xs text-center ${formMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {formMsg.text}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Detail View ── */}
        {view === 'detail' && selectedTicket && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Ticket info */}
            <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm text-text font-medium flex-1">{selectedTicket.title}</h3>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${statusColor(selectedTicket.status)}`}
                >
                  {statusLabel(selectedTicket.status)}
                </span>
              </div>
              <p className="text-xs text-text-muted mb-3 whitespace-pre-wrap">
                {selectedTicket.description}
              </p>
              <div className="flex items-center gap-4 text-[10px] text-text-faint font-mono">
                <span>{typeLabel(selectedTicket.type)}</span>
                <span>
                  {t.ticket.detailCreated} {new Date(selectedTicket.created_at).toLocaleString()}
                </span>
              </div>
            </div>

            {/* Timeline */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <h4 className="text-xs text-text-faint font-mono mb-3">{t.ticket.detailTimeline}</h4>
              {timelineLoading ? (
                <div className="flex justify-center py-6">
                  <div className="w-4 h-4 border-2 border-brand/30 border-t-brand rounded-full animate-spin" />
                </div>
              ) : timeline.length === 0 ? (
                <p className="text-xs text-text-faint text-center py-6">{t.ticket.detailNoTimeline}</p>
              ) : (
                <div className="space-y-3">
                  {timeline.map((entry, i) => (
                    <div key={`${entry.type}-${entry.data.id}-${i}`} className="flex gap-3">
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center pt-1.5">
                        <div
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            entry.type === 'comment' ? 'bg-brand' : 'bg-blue-500'
                          }`}
                        />
                        {i < timeline.length - 1 && (
                          <div className="w-px flex-1 bg-border mt-1" />
                        )}
                      </div>
                      {/* Content */}
                      <div className="flex-1 pb-3">
                        {entry.type === 'comment' ? (
                          <>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-text">
                                {entry.data.author_name || 'User'}
                              </span>
                              {entry.data.author_role === 'admin' && (
                                <span className="text-[9px] px-1.5 py-0.5 rounded bg-brand/10 text-brand">
                                  Admin
                                </span>
                              )}
                              <span className="text-[10px] text-text-faint font-mono">
                                {relativeTime(entry.created_at)}
                              </span>
                            </div>
                            <p className="text-xs text-text-muted whitespace-pre-wrap">
                              {entry.data.content}
                            </p>
                          </>
                        ) : (
                          <div className="flex items-center gap-2">
                            <p className="text-[11px] text-text-faint">
                              {t.ticket.detailStatusChange
                                .replace('{name}', entry.data.changed_by_name || 'System')
                                .replace('{from}', statusLabel(entry.data.from_status || ''))
                                .replace('{to}', statusLabel(entry.data.to_status || ''))}
                            </p>
                            <span className="text-[10px] text-text-faint font-mono">
                              {relativeTime(entry.created_at)}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  <div ref={timelineEndRef} />
                </div>
              )}
            </div>

            {/* Comment input */}
            {selectedTicket.status !== 'closed' && (
              <div className="px-5 py-3 border-t border-border shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleComment()
                      }
                    }}
                    placeholder={t.ticket.detailCommentPlaceholder}
                    className="flex-1 px-3 py-2 rounded-lg border border-border bg-bg-card text-xs text-text placeholder:text-text-faint/50 outline-none focus:border-brand/40 transition-colors"
                  />
                  <button
                    onClick={handleComment}
                    disabled={commentSending || !commentText.trim()}
                    className="px-4 py-2 rounded-lg text-xs bg-brand text-white cursor-pointer hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                  >
                    {t.ticket.detailCommentSubmit}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  )
}
