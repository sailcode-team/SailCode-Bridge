import express from 'express'
import cors from 'cors'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { execSync } from 'node:child_process'

const APP_VERSION = '0.2.0'
const DEFAULT_PORT = 3737
const CONFIG_DIR = path.join(os.homedir(), '.sailcode')
const CONFIG_PATH = path.join(CONFIG_DIR, 'bridge.config.json')

const DEFAULT_CONFIG = {
  token: '',
  allowedPaths: [],
  activeProjectRoot: '',
  port: DEFAULT_PORT,
  allowOrigins: [
    'http://localhost:1722',
    'http://127.0.0.1:1722',
    'http://localhost:722',
    'http://127.0.0.1:722'
  ],
  maxFileSize: 1024 * 1024,
  maxReadLines: 10000,
  maxDepth: 4,
  maxEntries: 800,
  forbiddenExtensions: [
    '.env', '.env.local', '.env.production',
    '.key', '.pem', '.p12', '.pfx',
    '.exe', '.dll', '.so', '.dylib',
    '.zip', '.tar', '.gz', '.rar'
  ],
  ignoredDirs: [
    'node_modules', '.git', '.next', '.turbo',
    'dist', 'build', 'out'
  ]
}

const ensureConfig = async () => {
  if (!existsSync(CONFIG_DIR)) {
    await fs.mkdir(CONFIG_DIR, { recursive: true })
  }

  if (!existsSync(CONFIG_PATH)) {
    const token = randomBytes(16).toString('hex')
    const config = { ...DEFAULT_CONFIG, token }
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    return config
  }

  const raw = await fs.readFile(CONFIG_PATH, 'utf8')
  let data = {}
  try {
    data = JSON.parse(raw)
  } catch {
    data = {}
  }

  const token = typeof data.token === 'string' && data.token ? data.token : randomBytes(16).toString('hex')
  const merged = { ...DEFAULT_CONFIG, ...data, token }
  await fs.writeFile(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf8')
  return merged
}

const normalizePath = (inputPath) => path.resolve(String(inputPath || '').trim())

const isWithinAllowed = (targetPath, allowedPaths) => {
  if (!allowedPaths || allowedPaths.length === 0) return false
  const resolved = normalizePath(targetPath)
  return allowedPaths.some((base) => {
    const root = normalizePath(base)
    if (!root) return false
    if (resolved === root) return true
    const rel = path.relative(root, resolved)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel)
  })
}

const isForbiddenExtension = (filePath, forbiddenExtensions) => {
  const ext = path.extname(filePath).toLowerCase()
  return forbiddenExtensions.includes(ext)
}

const scanDirTree = async (rootDir, opts) => {
  const lines = []
  let entriesCount = 0

  const walk = async (dir, depth, prefix) => {
    if (entriesCount >= opts.maxEntries) return
    if (depth > opts.maxDepth) return

    let dirents
    try {
      dirents = await fs.readdir(dir)
    } catch {
      return
    }

    dirents.sort((a, b) => a.localeCompare(b))

    for (const name of dirents) {
      if (entriesCount >= opts.maxEntries) return
      if (opts.ignoredDirs.includes(name)) continue

      const fullPath = path.join(dir, name)
      let stat
      try {
        stat = await fs.stat(fullPath)
      } catch {
        continue
      }

      entriesCount += 1
      const isDir = stat.isDirectory()
      lines.push(`${prefix}${isDir ? '📁 ' : '📄 '}${name}`)

      if (isDir) {
        await walk(fullPath, depth + 1, `${prefix}  `)
      }
    }
  }

  await walk(rootDir, 0, '')

  if (entriesCount >= opts.maxEntries) {
    lines.push('…(truncated)')
  }

  return { lines, entriesCount }
}

const safeExecVersion = (cmd) => {
  try {
    const out = execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' })
    return { ok: true, version: String(out).trim() }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const main = async () => {
  const config = await ensureConfig()
  const port = Number(process.env.BRIDGE_PORT || config.port || DEFAULT_PORT)

  if (config.port !== port) {
    config.port = port
    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
  }

  const app = express()

  const allowedOrigins = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    ...config.allowOrigins
  ])

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true)
      if (allowedOrigins.has(origin)) return callback(null, true)
      return callback(new Error('CORS not allowed'))
    },
    credentials: true
  }))

  app.use(express.json({ limit: '2mb' }))
  app.use(express.static(path.join(process.cwd(), 'public')))

  const requireToken = (req, res, next) => {
    const token = req.header('x-bridge-token') || ''
    if (!token || token !== config.token) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Missing or invalid bridge token'
      })
    }
    return next()
  }

  const isSameOrigin = (origin) => {
    if (!origin) return true
    return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`
  }

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: APP_VERSION,
      requiresAuth: true
    })
  })

  app.get('/capabilities', (_req, res) => {
    res.json({
      envProbe: true,
      projectScan: true,
      commandExecute: false,
      fileRead: true,
      fileWrite: false,
      readOnly: true,
      maxFileSize: config.maxFileSize,
      allowedPathsCount: config.allowedPaths.length,
      activeProjectRoot: config.activeProjectRoot || null
    })
  })

  app.get('/bootstrap', async (req, res) => {
    const origin = req.get('origin')
    if (!isSameOrigin(origin)) {
      return res.status(403).json({ code: 'FORBIDDEN', message: 'Invalid origin' })
    }

    res.json({
      token: config.token,
      config: {
        allowedPaths: config.allowedPaths,
        activeProjectRoot: config.activeProjectRoot,
        port: config.port,
        allowOrigins: config.allowOrigins,
        maxFileSize: config.maxFileSize,
        maxReadLines: config.maxReadLines,
        maxDepth: config.maxDepth,
        maxEntries: config.maxEntries,
        forbiddenExtensions: config.forbiddenExtensions
      }
    })
  })

  app.get('/env', requireToken, (_req, res) => {
    const node = safeExecVersion('node -v')
    const npm = safeExecVersion('npm -v')
    const git = safeExecVersion('git --version')
    const pnpm = safeExecVersion('pnpm -v')

    const tools = []
    if (git.ok) tools.push('git')
    if (pnpm.ok) tools.push('pnpm')
    if (npm.ok) tools.push('npm')
    if (node.ok) tools.push('node')

    const shell = process.env.SHELL || process.env.ComSpec || undefined
    res.json({
      os: `${process.platform} ${process.arch}`,
      shell,
      nodeVersion: node.ok ? node.version : process.version,
      npmVersion: npm.ok ? npm.version : undefined,
      gitVersion: git.ok ? git.version : undefined,
      pnpmVersion: pnpm.ok ? pnpm.version : undefined,
      tools,
      isLocalConnected: true
    })
  })

  app.get('/project/scan', requireToken, async (req, res) => {
    const pathParam = req.query.path ? String(req.query.path) : config.activeProjectRoot
    const maxDepth = Math.min(Number(req.query.maxDepth || config.maxDepth), 8)
    const maxEntries = Math.min(Number(req.query.maxEntries || config.maxEntries), 1500)

    if (!pathParam) {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'path is required' })
    }

    const resolvedPath = normalizePath(pathParam)
    if (!isWithinAllowed(resolvedPath, config.allowedPaths)) {
      return res.status(403).json({ code: 'ACCESS_DENIED', message: 'Path not allowed' })
    }

    let stat
    try {
      stat = await fs.stat(resolvedPath)
    } catch {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Path not found' })
    }

    if (!stat.isDirectory()) {
      return res.status(400).json({ code: 'NOT_DIRECTORY', message: 'Path is not a directory' })
    }

    const { lines } = await scanDirTree(resolvedPath, {
      maxDepth,
      maxEntries,
      ignoredDirs: config.ignoredDirs
    })

    return res.json({
      currentDir: resolvedPath,
      fileStructure: lines.join('\n'),
      limits: { maxDepth, maxEntries }
    })
  })

  app.post('/fs/read', requireToken, async (req, res) => {
    const { path: filePath, encoding = 'utf8', maxLines = config.maxReadLines } = req.body || {}

    if (!filePath) {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'File path is required' })
    }

    const resolvedPath = normalizePath(filePath)
    if (!isWithinAllowed(resolvedPath, config.allowedPaths)) {
      return res.status(403).json({ code: 'ACCESS_DENIED', message: 'Path not allowed' })
    }

    if (isForbiddenExtension(resolvedPath, config.forbiddenExtensions)) {
      return res.status(403).json({ code: 'ACCESS_DENIED', message: 'Forbidden file type' })
    }

    if (!existsSync(resolvedPath)) {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'File not found' })
    }

    const stats = await fs.stat(resolvedPath)
    if (stats.size > config.maxFileSize) {
      return res.status(413).json({
        code: 'FILE_TOO_LARGE',
        message: `File too large: ${stats.size} bytes (max: ${config.maxFileSize})`
      })
    }

    const content = await fs.readFile(resolvedPath, encoding)
    let finalContent = content
    if (maxLines && maxLines > 0) {
      const lines = content.split('\n')
      if (lines.length > maxLines) {
        finalContent = `${lines.slice(0, maxLines).join('\n')}\n... (truncated)`
      }
    }

    return res.json({
      success: true,
      data: {
        path: filePath,
        content: finalContent,
        metadata: {
          size: stats.size,
          lastModified: stats.mtime.toISOString(),
          lines: finalContent.split('\n').length,
          truncated: content !== finalContent
        }
      }
    })
  })

  app.get('/config', requireToken, (_req, res) => {
    res.json({
      allowedPaths: config.allowedPaths,
      activeProjectRoot: config.activeProjectRoot,
      port: config.port,
      allowOrigins: config.allowOrigins,
      maxFileSize: config.maxFileSize,
      maxReadLines: config.maxReadLines,
      maxDepth: config.maxDepth,
      maxEntries: config.maxEntries,
      forbiddenExtensions: config.forbiddenExtensions,
      ignoredDirs: config.ignoredDirs,
      readOnly: true
    })
  })

  app.post('/config/allowed-paths', requireToken, async (req, res) => {
    const { action, path: targetPath } = req.body || {}
    if (!targetPath || typeof targetPath !== 'string') {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'path is required' })
    }

    const resolved = normalizePath(targetPath)
    let stats
    try {
      stats = await fs.stat(resolved)
    } catch {
      return res.status(404).json({ code: 'NOT_FOUND', message: 'Path not found' })
    }

    if (!stats.isDirectory()) {
      return res.status(400).json({ code: 'NOT_DIRECTORY', message: 'Path is not a directory' })
    }

    if (action === 'add') {
      if (!config.allowedPaths.includes(resolved)) {
        config.allowedPaths.push(resolved)
      }
      if (!config.activeProjectRoot) {
        config.activeProjectRoot = resolved
      }
    } else if (action === 'remove') {
      config.allowedPaths = config.allowedPaths.filter((p) => p !== resolved)
      if (config.activeProjectRoot === resolved) {
        config.activeProjectRoot = config.allowedPaths[0] || ''
      }
    } else if (action === 'setActive') {
      if (!config.allowedPaths.includes(resolved)) {
        return res.status(400).json({ code: 'INVALID_REQUEST', message: 'Path not in allowlist' })
      }
      config.activeProjectRoot = resolved
    } else {
      return res.status(400).json({ code: 'INVALID_REQUEST', message: 'Invalid action' })
    }

    await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')

    return res.json({
      allowedPaths: config.allowedPaths,
      activeProjectRoot: config.activeProjectRoot
    })
  })

  app.listen(port, () => {
    console.log(`[SailCode-Bridge] running on http://localhost:${port}`)
    console.log(`[SailCode-Bridge] config: ${CONFIG_PATH}`)
  })
}

main().catch((err) => {
  console.error('[SailCode-Bridge] failed to start', err)
  process.exit(1)
})
