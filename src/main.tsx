import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const _sentErrors = new Set<string>()

function sendLog(level: string, message: string, source = '', lineno: number | string = '') {
  if (!import.meta.env.DEV) return
  const key = `${level}|${message}|${source}|${lineno}`
  if (_sentErrors.has(key)) return
  _sentErrors.add(key)
  fetch('http://localhost:8000/client-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ level, message, source, lineno }),
  }).catch(() => {/* backend unreachable — silently drop */})
}

window.onerror = (msg, source, lineno, _colno, error) => {
  sendLog('ERROR', `${msg}${error ? '\n' + error.stack : ''}`, source ?? '', lineno ?? '')
  return false
}

window.onunhandledrejection = (e) => {
  const reason = e.reason instanceof Error
    ? e.reason.stack ?? e.reason.message
    : String(e.reason)
  sendLog('UNHANDLED_REJECTION', reason)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
