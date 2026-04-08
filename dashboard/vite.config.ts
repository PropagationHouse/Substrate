import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { readFileSync, existsSync, statSync, writeFileSync, mkdirSync, readdirSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

// Substrate backend — all API and WebSocket traffic is proxied here
const substrateTarget = process.env.SUBSTRATE_URL || 'http://localhost:8765'
const port = parseInt(process.env.VITE_PORT || '3000', 10)
const workspaceRoot = process.env.SUBSTRATE_WORKSPACE || path.resolve(__dirname, '..')

// Helpers for reading conversation history
function loadConversations(): Array<{ timestamp: number; user_message?: string; assistant_response?: string; model?: string }> {
  const paths = [
    path.join(workspaceRoot, 'data', 'conversation_history.json'),
    path.join(workspaceRoot, 'conversation_history.json'),
  ]
  const seen = new Set<number>()
  const all: Array<{ timestamp: number; user_message?: string; assistant_response?: string; model?: string }> = []
  for (const p of paths) {
    if (!existsSync(p)) continue
    try {
      const raw = JSON.parse(readFileSync(p, 'utf-8'))
      for (const c of (raw?.conversations || [])) {
        const ts = c.timestamp
        if (!ts || seen.has(Math.floor(ts))) continue
        seen.add(Math.floor(ts))
        all.push({ timestamp: ts, user_message: c.user_message, assistant_response: c.assistant_response, model: c.model })
      }
    } catch { /* skip */ }
  }
  return all.sort((a, b) => a.timestamp - b.timestamp)
}

function safeReadJSON(p: string): any {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf-8')) : null } catch { return null }
}
function safeReadText(p: string): string | null {
  try { return existsSync(p) ? readFileSync(p, 'utf-8') : null } catch { return null }
}

function parseUrl(req: any): URL {
  return new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
}

// Vite plugin: serve Substrate workspace data directly from disk
function substrateLocalPlugin() {
  return {
    name: 'substrate-local-data',
    configureServer(server: any) {
      // 1) Chat date distribution
      server.middlewares.use('/api/local/chat-dates', (_req: any, res: any) => {
        const all = loadConversations()
        const dateMap = new Map<string, number>()
        for (const c of all) {
          const d = new Date(c.timestamp * 1000).toISOString().split('T')[0]
          dateMap.set(d, (dateMap.get(d) || 0) + 1)
        }
        const result = [...dateMap.entries()]
          .map(([date, count]) => ({ date, count }))
          .sort((a, b) => b.date.localeCompare(a.date))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, dates: result }))
      })

      // 2) Chat messages for a specific day
      server.middlewares.use('/api/local/chat-day', (req: any, res: any) => {
        const url = parseUrl(req)
        const date = url.searchParams.get('date')
        if (!date) { res.statusCode = 400; res.end('{"error":"date required"}'); return }
        const all = loadConversations()
        const msgs = all.filter(c => new Date(c.timestamp * 1000).toISOString().split('T')[0] === date)
          .map(c => ({
            timestamp: c.timestamp,
            time: new Date(c.timestamp * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
            user: (c.user_message || '').slice(0, 200),
            assistant: (c.assistant_response || '').slice(0, 300),
            model: c.model,
          }))
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ ok: true, date, count: msgs.length, messages: msgs }))
      })

      // 3) Real memory structure — user_facts, lessons, config, system docs
      server.middlewares.use('/api/local/memory', (_req: any, res: any) => {
        const userFacts = safeReadText(path.join(workspaceRoot, 'data', 'user_facts.md'))
        const lessons = safeReadJSON(path.join(workspaceRoot, 'workspace', 'state', 'lessons.json'))
        const config = safeReadJSON(path.join(workspaceRoot, 'custom_settings.json'))
        const memoryJson = safeReadJSON(path.join(workspaceRoot, 'memory.json'))

        // Parse user_facts.md into structured entries
        const facts = (userFacts || '').split('\n')
          .filter((l: string) => l.startsWith('- '))
          .map((l: string) => {
            const m = l.match(/^- (\w+):\s*(.+)/)
            return m ? { key: m[1], value: m[2].trim() } : { key: 'note', value: l.slice(2).trim() }
          })

        // Extract lesson summaries
        const lessonList = (lessons?.lessons || []).map((l: any) => ({
          id: l.id, pattern: l.pattern, lesson: l.lesson, confidence: l.confidence, type: l.type,
        }))

        // Count memory.json entries
        const memoryEntries = (memoryJson?.entries || []).length

        // Config settings — key + summary value
        const configEntries: Array<{ key: string; preview: string }> = []
        if (config) {
          for (const [k, v] of Object.entries(config)) {
            let preview = ''
            if (typeof v === 'string') preview = v.length > 60 ? v.slice(0, 60) + '…' : v
            else if (typeof v === 'number' || typeof v === 'boolean') preview = String(v)
            else if (Array.isArray(v)) preview = `[${v.length} items]`
            else if (v && typeof v === 'object') preview = `{${Object.keys(v as any).length} keys}`
            else preview = String(v)
            configEntries.push({ key: k, preview })
          }
        }

        // System .md docs
        const mdFiles = ['PRIME.md', 'CIRCUITS.md', 'SUBSTRATE.md', 'TOOL_PROMPT.md', 'ORIGIN.md', 'README.md', 'CHANGELOG.md']
        const systemDocs: Array<{ name: string; path: string; size: number }> = []
        for (const f of mdFiles) {
          const full = path.join(workspaceRoot, f)
          if (existsSync(full)) {
            try {
              const stat = statSync(full)
              systemDocs.push({ name: f, path: f, size: stat.size })
            } catch { /* skip */ }
          }
        }

        // Visual memory — images from visual_memory/images/ and screenshots/
        const visualMemory: Array<{ name: string; path: string; size: number; timestamp?: number }> = []
        const imgExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])
        for (const dir of ['visual_memory/images', 'screenshots']) {
          const full = path.join(workspaceRoot, dir)
          if (existsSync(full)) {
            try {
              const files = readdirSync(full).filter((f: string) => imgExts.has(path.extname(f).toLowerCase()))
              for (const f of files.slice(-30)) {
                const fp = path.join(full, f)
                try {
                  const st = statSync(fp)
                  const tsMatch = f.match(/(\d{13})/)
                  visualMemory.push({ name: f, path: `${dir}/${f}`, size: st.size, timestamp: tsMatch ? parseInt(tsMatch[1]) : undefined })
                } catch { /* skip */ }
              }
            } catch { /* skip */ }
          }
        }

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({
          ok: true,
          facts,
          lessons: lessonList,
          memoryEntryCount: memoryEntries,
          configEntries,
          configKeys: config ? Object.keys(config) : [],
          systemDocs,
          visualMemory,
        }))
      })

      // 4) Read a workspace file (text or image)
      server.middlewares.use('/api/local/file-read', (req: any, res: any) => {
        const url = parseUrl(req)
        const filePath = url.searchParams.get('path')
        if (!filePath) { res.statusCode = 400; res.end('{"error":"path required"}'); return }
        const full = path.resolve(workspaceRoot, filePath)
        if (!full.startsWith(workspaceRoot)) { res.statusCode = 403; res.end('{"error":"forbidden"}'); return }
        if (!existsSync(full)) { res.statusCode = 404; res.end('{"error":"not found"}'); return }

        const ext = filePath.split('.').pop()?.toLowerCase() || ''
        const IMAGE_EXTS: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon' }
        const AUDIO_EXTS: Record<string, string> = { mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4', aac: 'audio/aac', wma: 'audio/x-ms-wma', mid: 'audio/midi', midi: 'audio/midi' }
        const imgMime = IMAGE_EXTS[ext]
        const audMime = AUDIO_EXTS[ext]

        if (imgMime) {
          // Return image as base64 data URL
          try {
            const buf = readFileSync(full)
            const b64 = buf.toString('base64')
            const dataUrl = ext === 'svg' ? `data:image/svg+xml;base64,${b64}` : `data:${imgMime};base64,${b64}`
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: filePath, type: 'image', mime: imgMime, content: dataUrl }))
          } catch { res.statusCode = 500; res.end('{"error":"failed to read image"}'); return }
        } else if (audMime) {
          // Return audio as base64 data URL
          try {
            const buf = readFileSync(full)
            const b64 = buf.toString('base64')
            const dataUrl = `data:${audMime};base64,${b64}`
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, path: filePath, type: 'audio', mime: audMime, content: dataUrl }))
          } catch { res.statusCode = 500; res.end('{"error":"failed to read audio"}'); return }
        } else {
          // Text file
          const content = safeReadText(full)
          if (content === null) { res.statusCode = 404; res.end('{"error":"not found"}'); return }
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: filePath, type: 'text', content }))
        }
      })

      // 5) List directory contents
      server.middlewares.use('/api/local/dir', (req: any, res: any) => {
        const url = parseUrl(req)
        const dirPath = url.searchParams.get('path') || ''
        const full = path.resolve(workspaceRoot, dirPath)
        if (!full.startsWith(workspaceRoot)) { res.statusCode = 403; res.end('{"error":"forbidden"}'); return }
        if (!existsSync(full)) { res.statusCode = 404; res.end('{"error":"not found"}'); return }
        try {
          const entries = readdirSync(full, { withFileTypes: true })
            .filter((e: any) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== '__pycache__' && e.name !== 'venv' && e.name !== '.git')
            .map((e: any) => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
              path: dirPath ? `${dirPath}/${e.name}` : e.name,
              size: e.isDirectory() ? 0 : (() => { try { return statSync(path.join(full, e.name)).size } catch { return 0 } })(),
            }))
            .sort((a: any, b: any) => {
              if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
              return a.name.localeCompare(b.name)
            })
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, path: dirPath, entries }))
        } catch (e: any) {
          res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
        }
      })

      // 6) Write a workspace file
      server.middlewares.use('/api/local/file-write', (req: any, res: any) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"POST only"}'); return }
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const { path: filePath, content } = JSON.parse(body)
            const full = path.resolve(workspaceRoot, filePath)
            if (!full.startsWith(workspaceRoot)) { res.statusCode = 403; res.end('{"error":"forbidden"}'); return }
            mkdirSync(path.dirname(full), { recursive: true })
            writeFileSync(full, content, 'utf-8')
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true }))
          } catch (e: any) {
            res.statusCode = 500; res.end(JSON.stringify({ error: e.message }))
          }
        })
      })
      // ── Tasks API — CRUD + Notion sync + Agent context ──────────────
      const tasksFile = path.join(workspaceRoot, 'data', 'tasks.json')

      function loadTasksFromDisk(): any[] {
        const d = safeReadJSON(tasksFile)
        return d?.tasks || []
      }
      function saveTasksToDisk(tasks: any[]) {
        mkdirSync(path.dirname(tasksFile), { recursive: true })
        writeFileSync(tasksFile, JSON.stringify({ tasks, updatedAt: Date.now() }, null, 2), 'utf-8')
      }
      function getNotionToken(): string | null {
        const cfg = safeReadJSON(path.join(workspaceRoot, 'custom_settings.json'))
        return cfg?.remote_api_keys?.notion_api_key || cfg?.notion_api_key || null
      }
      function getNotionDbId(): string | null {
        const cfg = safeReadJSON(path.join(workspaceRoot, 'data', 'tasks.json'))
        return cfg?.notionDatabaseId || null
      }
      function setNotionDbId(dbId: string) {
        const d = safeReadJSON(tasksFile) || { tasks: [] }
        d.notionDatabaseId = dbId
        d.updatedAt = Date.now()
        mkdirSync(path.dirname(tasksFile), { recursive: true })
        writeFileSync(tasksFile, JSON.stringify(d, null, 2), 'utf-8')
      }

      // Helper: Notion API request
      async function notionFetch(endpoint: string, method: string = 'GET', body?: any): Promise<any> {
        const token = getNotionToken()
        if (!token) return { error: 'no_token' }
        const opts: any = {
          method,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
        }
        if (body) opts.body = JSON.stringify(body)
        try {
          const r = await fetch(`https://api.notion.com/v1${endpoint}`, opts)
          return await r.json()
        } catch (e: any) { return { error: e.message } }
      }

      // Helper: map local task to Notion page properties
      function taskToNotionProps(task: any) {
        const props: any = {
          'Title': { title: [{ text: { content: task.title || 'Untitled' } }] },
          'Status': { select: { name: task.column === 'done' ? 'Done' : task.column === 'in_progress' ? 'In Progress' : 'Backlog' } },
          'Owner': { select: { name: task.owner === 'agent' ? 'Agent' : 'Human' } },
          'Priority': { select: { name: task.priority ? task.priority.charAt(0).toUpperCase() + task.priority.slice(1) : 'Medium' } },
          'Schedule': { select: { name: task.schedule ? task.schedule.charAt(0).toUpperCase() + task.schedule.slice(1) : 'Whenever' } },
        }
        if (task.description) {
          props['Description'] = { rich_text: [{ text: { content: task.description.slice(0, 2000) } }] }
        }
        if (task.dueDate) {
          props['Due Date'] = { date: { start: task.dueDate } }
        }
        return props
      }

      // Helper: extract value from any Notion property by its type
      function extractNotionValue(prop: any): string {
        if (!prop) return ''
        switch (prop.type) {
          case 'title': return (prop.title || []).map((t: any) => t.plain_text || '').join('')
          case 'rich_text': return (prop.rich_text || []).map((t: any) => t.plain_text || '').join('')
          case 'select': return prop.select?.name || ''
          case 'status': return prop.status?.name || ''
          case 'multi_select': return (prop.multi_select || []).map((s: any) => s.name).join(', ')
          case 'date': return prop.date?.start || ''
          case 'number': return prop.number != null ? String(prop.number) : ''
          case 'checkbox': return prop.checkbox ? 'true' : 'false'
          case 'url': return prop.url || ''
          case 'email': return prop.email || ''
          case 'phone_number': return prop.phone_number || ''
          case 'people': return (prop.people || []).map((p: any) => p.name || p.id).join(', ')
          case 'formula': return prop.formula?.string || prop.formula?.number?.toString() || ''
          case 'rollup': return prop.rollup?.number?.toString() || ''
          case 'created_time': return prop.created_time || ''
          case 'last_edited_time': return prop.last_edited_time || ''
          default: return ''
        }
      }

      // Helper: find a property by searching for keywords in property names (case-insensitive)
      function findPropByKeywords(props: Record<string, any>, keywords: string[], preferTypes?: string[]): any {
        const entries = Object.entries(props)
        // First: try exact keyword match in name + preferred type
        for (const [name, prop] of entries) {
          const lower = name.toLowerCase()
          if (keywords.some(k => lower === k)) {
            if (!preferTypes || preferTypes.includes(prop.type)) return prop
          }
        }
        // Second: try keyword-contains match + preferred type
        for (const [name, prop] of entries) {
          const lower = name.toLowerCase()
          if (keywords.some(k => lower.includes(k))) {
            if (!preferTypes || preferTypes.includes(prop.type)) return prop
          }
        }
        // Third: keyword match without type constraint
        for (const [name, prop] of entries) {
          const lower = name.toLowerCase()
          if (keywords.some(k => lower.includes(k))) return prop
        }
        return null
      }

      // Helper: find the title property (every Notion DB has exactly one)
      function findTitleProp(props: Record<string, any>): any {
        for (const prop of Object.values(props)) {
          if (prop.type === 'title') return prop
        }
        return null
      }

      // Helper: parse Notion page into local task (dynamic property discovery)
      function notionPageToTask(page: any): any {
        const p = page.properties || {}

        // Extract title — every Notion DB has one title property
        const titleProp = findTitleProp(p)
        const title = extractNotionValue(titleProp)

        // Extract status/column — look for 'status' or 'select' type props with status-like names
        const statusProp = findPropByKeywords(p, ['status', 'stage', 'state', 'column', 'progress'], ['status', 'select'])
        const statusVal = extractNotionValue(statusProp).toLowerCase()
        const backlogWords = ['not started', 'backlog', 'todo', 'to do', 'to-do', 'pending', 'queued', 'new', 'open', 'planned']
        const doneWords = ['done', 'complete', 'completed', 'finished', 'closed', 'resolved', 'shipped', 'archived']
        const inProgressWords = ['in progress', 'in-progress', 'doing', 'active', 'working', 'wip', 'started', 'underway', 'ongoing']
        // Check backlog first so "not started" doesn't false-match on "started"
        const column = backlogWords.some(w => statusVal.includes(w)) ? 'backlog'
          : doneWords.some(w => statusVal.includes(w)) ? 'done'
          : inProgressWords.some(w => statusVal.includes(w)) ? 'in_progress'
          : 'backlog'

        // Extract description — rich_text property with description-like name, or first rich_text
        const descProp = findPropByKeywords(p, ['description', 'desc', 'details', 'notes', 'note', 'summary', 'body'], ['rich_text'])
        const description = extractNotionValue(descProp)

        // Extract priority
        const priProp = findPropByKeywords(p, ['priority', 'urgency', 'importance'], ['select', 'status'])
        const priVal = extractNotionValue(priProp).toLowerCase()
        const priority = priVal.includes('critical') ? 'critical'
          : priVal.includes('high') || priVal.includes('urgent') ? 'high'
          : priVal.includes('low') ? 'low'
          : 'medium'

        // Extract owner/assignee
        const ownerProp = findPropByKeywords(p, ['owner', 'assign', 'assignee', 'responsible', 'who'], ['select', 'people', 'multi_select'])
        const ownerVal = extractNotionValue(ownerProp).toLowerCase()
        const owner = ownerVal.includes('agent') || ownerVal.includes('bot') || ownerVal.includes('ai') ? 'agent' : 'human'

        // Extract due date
        const dateProp = findPropByKeywords(p, ['due', 'end date', 'deadline', 'target date', 'date'], ['date'])
        const dueDate = extractNotionValue(dateProp) || null

        // Extract schedule
        const schedProp = findPropByKeywords(p, ['schedule', 'timing', 'when', 'frequency'], ['select'])
        const schedVal = extractNotionValue(schedProp).toLowerCase()
        const schedule = schedVal.includes('immediate') || schedVal.includes('now') || schedVal.includes('asap') ? 'immediate'
          : schedVal.includes('recurring') || schedVal.includes('repeat') ? 'recurring'
          : schedVal.includes('scheduled') || schedVal.includes('planned') ? 'scheduled'
          : 'whenever'

        // Build all remaining text fields into description if main description is empty
        let fullDescription = description
        if (!fullDescription) {
          const extras: string[] = []
          for (const [name, prop] of Object.entries(p) as [string, any][]) {
            if (prop === titleProp || prop === statusProp || prop === descProp || prop === priProp || prop === ownerProp || prop === dateProp || prop === schedProp) continue
            const val = extractNotionValue(prop)
            if (val && val.length > 0 && prop.type !== 'formula' && prop.type !== 'rollup') {
              extras.push(`${name}: ${val}`)
            }
          }
          if (extras.length > 0) fullDescription = extras.join('\n')
        }

        return {
          id: `notion-${page.id}`,
          notionId: page.id,
          title: title || 'Untitled',
          description: fullDescription || undefined,
          column,
          owner,
          priority,
          schedule,
          dueDate,
          createdAt: new Date(page.created_time).getTime(),
          updatedAt: new Date(page.last_edited_time).getTime(),
          notionUrl: page.url,
        }
      }

      // 7a-pre) Agent context: summary of task board for agent awareness
      // NOTE: must be registered BEFORE /api/local/tasks since Connect uses prefix matching
      server.middlewares.use('/api/local/tasks/agent-context', (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        const tasks = loadTasksFromDisk()
        const now = Date.now()

        const backlog = tasks.filter((t: any) => t.column === 'backlog')
        const inProgress = tasks.filter((t: any) => t.column === 'in_progress')
        const done = tasks.filter((t: any) => t.column === 'done')
        const overdue = tasks.filter((t: any) => t.dueDate && new Date(t.dueDate).getTime() < now && t.column !== 'done')
        const urgent = tasks.filter((t: any) => (t.priority === 'critical' || t.priority === 'high') && t.column !== 'done')
        const agentTasks = tasks.filter((t: any) => t.owner === 'agent' && t.column !== 'done')
        const humanTasks = tasks.filter((t: any) => t.owner === 'human' && t.column !== 'done')
        const recentlyDone = done.filter((t: any) => t.completedAt && (now - t.completedAt) < 24 * 60 * 60 * 1000)

        const formatTask = (t: any) => ({
          id: t.id, title: t.title, description: t.description, owner: t.owner,
          priority: t.priority, schedule: t.schedule, column: t.column,
          dueDate: t.dueDate, progress: t.progress, statusNote: t.statusNote,
          recurringConfig: t.recurringConfig,
        })

        const summary = {
          totalActive: backlog.length + inProgress.length,
          overdue: overdue.map(formatTask),
          urgent: urgent.map(formatTask),
          agentTasks: agentTasks.map(formatTask),
          humanInProgress: humanTasks.filter((t: any) => t.column === 'in_progress').map(formatTask),
          humanBacklog: humanTasks.filter((t: any) => t.column === 'backlog').map(formatTask),
          recentlyCompleted: recentlyDone.map(formatTask),
          hint: overdue.length > 0
            ? `There are ${overdue.length} overdue task(s). Consider gently reminding the user.`
            : agentTasks.length > 0
              ? `You have ${agentTasks.length} task(s) assigned to you. Check if any need attention.`
              : humanTasks.length > 0
                ? `The user has ${humanTasks.length} active task(s). You could offer help if relevant.`
                : 'No active tasks. The board is clear.',
        }

        res.end(JSON.stringify({ ok: true, ...summary }))
      })

      // 7a) Tasks CRUD
      server.middlewares.use('/api/local/tasks', (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')

        if (req.method === 'GET') {
          const tasks = loadTasksFromDisk()
          const dbId = getNotionDbId()
          res.end(JSON.stringify({ ok: true, tasks, notionDatabaseId: dbId }))
          return
        }

        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const action = data.action || 'save'

              if (action === 'save') {
                // Full replace
                saveTasksToDisk(data.tasks || [])
                res.end(JSON.stringify({ ok: true }))
              } else if (action === 'upsert') {
                // Upsert single task
                const tasks = loadTasksFromDisk()
                const idx = tasks.findIndex((t: any) => t.id === data.task.id)
                if (idx >= 0) tasks[idx] = { ...tasks[idx], ...data.task, updatedAt: Date.now() }
                else tasks.push({ ...data.task, createdAt: Date.now(), updatedAt: Date.now() })
                saveTasksToDisk(tasks)
                res.end(JSON.stringify({ ok: true, task: data.task }))
              } else if (action === 'delete') {
                const tasks = loadTasksFromDisk().filter((t: any) => t.id !== data.taskId)
                saveTasksToDisk(tasks)
                res.end(JSON.stringify({ ok: true }))
              } else {
                res.end(JSON.stringify({ error: 'unknown action' }))
              }
            } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          })
          return
        }
        res.statusCode = 405; res.end('{"error":"method not allowed"}')
      })

      // 7b) Notion: search databases the integration has access to
      server.middlewares.use('/api/local/notion/databases', async (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        const result = await notionFetch('/search', 'POST', { filter: { property: 'object', value: 'database' }, page_size: 20 })
        if (result.error) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: result.error })); return }
        const dbs = (result.results || []).map((db: any) => ({
          id: db.id,
          title: db.title?.[0]?.plain_text || 'Untitled',
          url: db.url,
        }))
        res.end(JSON.stringify({ ok: true, databases: dbs }))
      })

      // 7c) Notion: link a database ID for sync
      server.middlewares.use('/api/local/notion/link', (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"POST only"}'); return }
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', () => {
          try {
            const { databaseId } = JSON.parse(body)
            if (!databaseId) { res.statusCode = 400; res.end('{"error":"databaseId required"}'); return }
            setNotionDbId(databaseId)
            res.end(JSON.stringify({ ok: true, databaseId }))
          } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })
      })

      // 7d) Notion: pull tasks from linked database
      server.middlewares.use('/api/local/notion/pull', async (_req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        const dbId = getNotionDbId()
        if (!dbId) { res.end(JSON.stringify({ ok: false, error: 'no database linked' })); return }

        const result = await notionFetch(`/databases/${dbId}/query`, 'POST', { page_size: 100 })
        if (result.error) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: result.error })); return }

        const notionTasks = (result.results || []).map(notionPageToTask)
        // Merge: Notion tasks override local tasks with same notionId, keep local-only tasks
        const localTasks = loadTasksFromDisk()
        const notionIds = new Set(notionTasks.map((t: any) => t.notionId))
        const localOnly = localTasks.filter((t: any) => !t.notionId || !notionIds.has(t.notionId))
        const merged = [...localOnly, ...notionTasks]
        saveTasksToDisk(merged)
        res.end(JSON.stringify({ ok: true, pulled: notionTasks.length, total: merged.length, tasks: merged }))
      })

      // 7e) Notion: push a task to linked database (create or update)
      server.middlewares.use('/api/local/notion/push', (req: any, res: any) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') { res.statusCode = 405; res.end('{"error":"POST only"}'); return }
        let body = ''
        req.on('data', (chunk: string) => { body += chunk })
        req.on('end', async () => {
          try {
            const { task } = JSON.parse(body)
            const dbId = getNotionDbId()
            if (!dbId) { res.end(JSON.stringify({ ok: false, error: 'no database linked' })); return }

            if (task.notionId) {
              // Update existing page
              const result = await notionFetch(`/pages/${task.notionId}`, 'PATCH', { properties: taskToNotionProps(task) })
              if (result.error) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: result.error })); return }
              res.end(JSON.stringify({ ok: true, action: 'updated', notionId: task.notionId }))
            } else {
              // Create new page
              const result = await notionFetch('/pages', 'POST', {
                parent: { database_id: dbId },
                properties: taskToNotionProps(task),
              })
              if (result.error || !result.id) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, error: result.error || 'no id returned' })); return }
              // Update local task with notionId
              const tasks = loadTasksFromDisk()
              const idx = tasks.findIndex((t: any) => t.id === task.id)
              if (idx >= 0) {
                tasks[idx].notionId = result.id
                tasks[idx].notionUrl = result.url
                saveTasksToDisk(tasks)
              }
              res.end(JSON.stringify({ ok: true, action: 'created', notionId: result.id, notionUrl: result.url }))
            }
          } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
        })
      })

      // 7) Research topics — read/write user topic subscriptions
      server.middlewares.use('/api/local/research-topics', (req: any, res: any) => {
        const topicsFile = path.join(workspaceRoot, 'data', 'research_topics.json')
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              mkdirSync(path.dirname(topicsFile), { recursive: true })
              writeFileSync(topicsFile, JSON.stringify(data, null, 2), 'utf-8')
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          })
        } else {
          const data = safeReadJSON(topicsFile)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, topics: data?.topics || [], feeds: data?.feeds || [] }))
        }
      })

      // 8) Research feed — read/write research results + deferred workspace sync
      const researchDir = path.join(workspaceRoot, 'workspace', 'research')
      let _researchSyncTimer: ReturnType<typeof setTimeout> | null = null
      const _syncResearchToWorkspace = (data: any) => {
        const items: any[] = data?.items || []
        const completed = items.filter((i: any) => !i.pending && i.title)
        if (completed.length === 0) return
        try {
          mkdirSync(researchDir, { recursive: true })
          const topicMap: Record<string, string[]> = {}
          for (const item of completed) {
            for (const t of (item.topics || [])) {
              const key = t.toLowerCase()
              if (!topicMap[key]) topicMap[key] = []
              topicMap[key].push(item.id)
            }
          }
          for (const item of completed) {
            const slug = item.id || String(item.timestamp || Date.now())
            const filePath = path.join(researchDir, `${slug}.md`)
            const connectedIds = new Set<string>()
            for (const t of (item.topics || [])) {
              for (const cid of (topicMap[t.toLowerCase()] || [])) {
                if (cid !== item.id) connectedIds.add(cid)
              }
            }
            const connections = Array.from(connectedIds).slice(0, 10)
            const connectedTitles = connections.map(cid => {
              const c = completed.find((ci: any) => ci.id === cid)
              return c ? c.title : cid
            })
            const date = new Date(item.timestamp || Date.now()).toISOString()
            const tags = (item.topics || []).map((t: string) => t.replace(/['"]/g, ''))
            const sources = (item.sourceUrls || []).map((s: any) => s.url || s).filter(Boolean)
            let md = '---\n'
            md += `title: "${(item.title || '').replace(/"/g, '\\"')}"\n`
            md += `type: ${item.type || 'research'}\n`
            md += `date: ${date}\n`
            md += `tags: [${tags.map((t: string) => `"${t}"`).join(', ')}]\n`
            if (item.saved) md += `saved: true\n`
            if (connections.length > 0) {
              md += `connections:\n`
              for (const ct of connectedTitles) {
                md += `  - "${ct.replace(/"/g, '\\"')}"\n`
              }
            }
            if (sources.length > 0) {
              md += `sources:\n`
              for (const src of sources.slice(0, 20)) {
                md += `  - ${src}\n`
              }
            }
            md += '---\n\n'
            md += `# ${item.title || 'Untitled Research'}\n\n`
            if (item.summary) md += `> ${item.summary}\n\n`
            if (item.sections && item.sections.length > 0) {
              for (const s of item.sections) {
                md += `## ${s.heading || 'Section'}\n\n${s.body || ''}\n\n`
              }
            } else if (item.content) {
              md += item.content + '\n'
            }
            if (sources.length > 0) {
              md += `\n## Sources\n\n`
              for (const src of sources) { md += `- ${src}\n` }
            }
            writeFileSync(filePath, md, 'utf-8')
          }
          // Write research index
          const indexPath = path.join(researchDir, 'INDEX.md')
          let idx = '# Research Library\n\n'
          idx += `> ${completed.length} entries | Last updated: ${new Date().toLocaleString()}\n\n`
          const byTopic: Record<string, any[]> = {}
          for (const item of completed) {
            for (const t of (item.topics || ['uncategorized'])) {
              const key = t.toLowerCase()
              if (!byTopic[key]) byTopic[key] = []
              byTopic[key].push(item)
            }
          }
          for (const [topic, topicItems] of Object.entries(byTopic).sort((a, b) => b[1].length - a[1].length)) {
            idx += `## ${topic} (${topicItems.length})\n\n`
            for (const ti of topicItems.slice(0, 20)) {
              const d = new Date(ti.timestamp || 0).toLocaleDateString()
              idx += `- [${ti.title}](./${ti.id}.md) — ${d}${ti.saved ? ' ★' : ''}\n`
            }
            idx += '\n'
          }
          writeFileSync(indexPath, idx, 'utf-8')
        } catch (syncErr: any) {
          console.warn('[research-feed] Workspace sync warning:', syncErr.message)
        }
      }
      server.middlewares.use('/api/local/research-feed', (req: any, res: any) => {
        const feedFile = path.join(workspaceRoot, 'data', 'research_feed.json')
        if (req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: string) => { body += chunk })
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              mkdirSync(path.dirname(feedFile), { recursive: true })
              writeFileSync(feedFile, JSON.stringify(data, null, 2), 'utf-8')
              // Respond immediately — don't block on workspace sync
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
              // Debounced deferred workspace sync (2s after last POST)
              if (_researchSyncTimer) clearTimeout(_researchSyncTimer)
              _researchSyncTimer = setTimeout(() => {
                _researchSyncTimer = null
                _syncResearchToWorkspace(data)
              }, 2000)
            } catch (e: any) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })) }
          })
        } else {
          const data = safeReadJSON(feedFile)
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, items: data?.items || [], briefs: data?.briefs || [] }))
        }
      })
    },
  }
}

export default defineConfig({
  base: process.env.NODE_ENV === 'production' ? '/dashboard/' : '/',
  plugins: [react(), tailwindcss(), substrateLocalPlugin()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port,
    host: process.env.VITE_HOST || '0.0.0.0',
    proxy: {
      '/api': substrateTarget,
      '/ws': {
        target: substrateTarget,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'markdown': ['react-markdown', 'remark-gfm', 'highlight.js'],
          'ui-vendor': ['lucide-react'],
          'utils': ['clsx', 'tailwind-merge', 'class-variance-authority', 'dompurify'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
