const makeWASocket = require('@whiskeysockets/baileys').default
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const pino = require('pino')
const fs = require('fs')

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

let sock = null
let qrData = null
let connected = false
let reconnectDelay = 5000
let maxReconnectDelay = 60000
let reconnectTimer = null
let retries = 0

async function connect() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_session')
    
    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['Kurmo PDV', 'Chrome', '1.0'],
      connectTimeoutMs: 30000,
      retryRequestDelayMs: 2000,
      maxRetries: 3
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update
      
      if (qr) {
        console.log('[WA] QR Code gerado')
        qrData = qr
        connected = false
        retries = 0
        reconnectDelay = 5000
      }

      if (connection === 'open') {
        console.log('[WA] Conectado com sucesso!')
        connected = true
        qrData = null
        retries = 0
        reconnectDelay = 5000
      }

      if (connection === 'close') {
        connected = false
        const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
        console.log('[WA] Desconectado, motivo:', reason)

        if (reason === DisconnectReason.loggedOut) {
          console.log('[WA] Logout detectado - limpando sessao')
          try { fs.rmSync('./auth_session', { recursive: true, force: true }) } catch(e) {}
          retries = 0
          reconnectDelay = 5000
          setTimeout(connect, 3000)
        } else if (reason === 500 || reason === DisconnectReason.connectionClosed) {
          // Backoff exponencial para erro 500
          retries++
          reconnectDelay = Math.min(reconnectDelay * 1.5, maxReconnectDelay)
          console.log('[WA] Aguardando', reconnectDelay/1000, 's antes de reconectar (tentativa', retries, ')')
          clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(connect, reconnectDelay)
        } else {
          clearTimeout(reconnectTimer)
          reconnectTimer = setTimeout(connect, 5000)
        }
      }
    })
  } catch (err) {
    console.error('[WA] Erro ao conectar:', err.message)
    reconnectDelay = Math.min(reconnectDelay * 2, maxReconnectDelay)
    clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(connect, reconnectDelay)
  }
}

// ── ROTAS ──

app.get('/', (req, res) => {
  res.json({ name: 'Kurmo WhatsApp API', version: '3.0', connected, retries })
})

app.get('/status', (req, res) => {
  if (connected) return res.json({ status: 'connected', message: 'WhatsApp conectado!' })
  if (qrData) return res.json({ status: 'qr_ready', message: 'QR Code pronto para escanear. Acesse /qr' })
  return res.json({ status: 'connecting', message: 'Conectando... tentativa ' + retries })
})

app.get('/qr', async (req, res) => {
  if (connected) return res.json({ status: 'connected', message: 'Ja conectado!' })
  if (!qrData) return res.json({ status: 'waiting', message: 'Aguarde o QR Code ser gerado...' })
  try {
    const img = await QRCode.toDataURL(qrData)
    res.send(`<!DOCTYPE html><html>
<head><title>Kurmo PDV - WhatsApp QR</title>
<meta http-equiv="refresh" content="25">
<style>body{background:#0a0a0a;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#fff;margin:0}
h2{color:#00ff41;font-size:22px;margin-bottom:8px;letter-spacing:2px}
p{color:#888;margin-bottom:16px;font-size:13px;text-align:center}
img{border:4px solid #00ff41;border-radius:12px;padding:12px;background:#fff;max-width:280px}
.tip{margin-top:12px;font-size:11px;color:#555}</style></head>
<body>
<h2>KURMO PDV — WHATSAPP</h2>
<p>Abra o WhatsApp &gt; Dispositivos vinculados &gt; Vincular dispositivo</p>
<img src="${img}" alt="QR Code"/>
<p class="tip">Pagina atualiza automaticamente a cada 25s</p>
</body></html>`)
  } catch (e) { res.status(500).json({ error: e.message }) }
})

app.post('/send', async (req, res) => {
  if (!connected || !sock) return res.status(503).json({ error: 'WhatsApp nao conectado' })
  const { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatorios' })
  try {
    const n = phone.replace(/\D/g, '')
    const jid = (n.startsWith('55') ? n : '55' + n) + '@s.whatsapp.net'
    await sock.sendMessage(jid, { text: message })
    res.json({ success: true, to: jid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('[API] Kurmo WhatsApp API v3 rodando na porta', PORT)
  connect()
})