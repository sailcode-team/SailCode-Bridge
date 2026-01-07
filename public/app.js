const healthStatus = document.getElementById('healthStatus')
const baseUrlInput = document.getElementById('baseUrlInput')
const copyBaseUrlBtn = document.getElementById('copyBaseUrl')
const pathInput = document.getElementById('pathInput')
const addPathBtn = document.getElementById('addPath')
const pathsList = document.getElementById('pathsList')
const scanBtn = document.getElementById('scanProject')
const projectTree = document.getElementById('projectTree')

let config = null
let scanTimer = null

const setStatus = (text, ok = true) => {
  healthStatus.textContent = text
  healthStatus.style.borderColor = ok ? '#38bdf8' : '#f87171'
}

const fetchJson = async (url, opts) => {
  const res = await fetch(url, opts)
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || res.statusText)
  }
  return res.json()
}

const loadBootstrap = async () => {
  const data = await fetchJson('/bootstrap')
  baseUrlInput.value = window.location.origin
  config = data.config
  renderPaths()
}

const renderPaths = () => {
  pathsList.innerHTML = ''
  if (!config || !config.allowedPaths || config.allowedPaths.length === 0) {
    pathsList.innerHTML = '<div class="hint">尚未授权任何目录。</div>'
    return
  }

  config.allowedPaths.forEach((p) => {
    const item = document.createElement('div')
    item.className = 'list-item'
    const active = config.activeProjectRoot === p
    item.innerHTML = `
      <div>
        <div>${p}</div>
        <small>${active ? 'Active Root' : 'Click to set active'}</small>
      </div>
      <div>
        <button class="btn" data-action="set">设为 Active</button>
        <button class="btn" data-action="remove">移除</button>
      </div>
    `

    item.querySelector('[data-action="set"]').addEventListener('click', () => updatePath('setActive', p))
    item.querySelector('[data-action="remove"]').addEventListener('click', () => updatePath('remove', p))
    pathsList.appendChild(item)
  })
}

const updatePath = async (action, value) => {
  const data = await fetchJson('/config/allowed-paths', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action, path: value })
  })

  config.allowedPaths = data.allowedPaths
  config.activeProjectRoot = data.activeProjectRoot
  renderPaths()
  await scanProject()
}

const scanProject = async () => {
  if (!config?.activeProjectRoot) {
    projectTree.textContent = '未设置 Active Root，请先授权目录。'
    return
  }
  projectTree.textContent = '扫描中…'
  try {
    const data = await fetchJson(`/project/scan?path=${encodeURIComponent(config.activeProjectRoot)}`)
    projectTree.textContent = data.fileStructure || '无结果'
  } catch (err) {
    projectTree.textContent = `扫描失败：${err.message}`
  }
}

const startAutoScan = () => {
  if (scanTimer) clearInterval(scanTimer)
  scanTimer = setInterval(() => {
    void scanProject()
  }, 60 * 1000)
}

copyBaseUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(window.location.origin)
  copyBaseUrlBtn.textContent = '已复制'
  setTimeout(() => (copyBaseUrlBtn.textContent = '复制'), 1200)
})

addPathBtn.addEventListener('click', async () => {
  const value = pathInput.value.trim()
  if (!value) return
  try {
    await updatePath('add', value)
    pathInput.value = ''
  } catch (err) {
    alert(`添加失败：${err.message}`)
  }
})

scanBtn.addEventListener('click', scanProject)

const init = async () => {
  try {
    const health = await fetchJson('/health')
    setStatus(health.status === 'ok' ? 'Bridge 在线' : 'Bridge 未就绪', health.status === 'ok')
    await loadBootstrap()
    await scanProject()
    startAutoScan()
  } catch (err) {
    setStatus('Bridge 连接失败', false)
    projectTree.textContent = `错误：${err.message}`
  }
}

init()
