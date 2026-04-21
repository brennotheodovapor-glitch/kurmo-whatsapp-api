const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const pino = require('pino')

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  next()
})

let sock = null
let qrCodeData = null
let isConnected = false
let isConnecting = false
let reconnectTimer = null

async function connectWA() {
  if (isConnecting) return
  isConnecting = true
  clearTimeout(reconnectTimer)

  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Kurmo PDV', 'Chrome', '1.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('QR Code gerado — escaneie pelo WhatsApp')
      qrCodeData = qr
      isConnected = false
    }

    if (connection === 'open') {
      console.log('WhatsApp conectado!')
      isConnected = true
      isConnecting = false
      qrCodeData = null
    }

    if (connection === 'close') {
      isConnected = false
      isConnecting = false
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
      console.log('Conexao fechada, motivo:', reason)

      if (reason === DisconnectReason.loggedOut) {
        console.log('Sessao encerrada — precisa escanear QR novamente')
        const fs = require('fs')
        if (fs.existsSync('auth_info')) {
          fs.rmSync('auth_info', { recursive: true, force: true })
        }
        reconnectTimer = setTimeout(connectWA, 3000)
      } else if (reason !== DisconnectReason.connectionReplaced) {
        reconnectTimer = setTimeout(connectWA, 5000)
      }
    }
  })
}

// GET /status — estado da conexao
app.get('/status', (req, res) => {
  if (isConnected) {
    res.json({ status: 'connected', message: 'WhatsApp conectado!' })
  } else if (qrCodeData) {
    res.json({ status: 'waiting_qr', message: 'Aguardando escaneamento do QR Code' })
  } else {
    res.json({ status: 'connecting', message: 'Conectando...' })
  }
})

// GET /qr — retorna QR Code como imagem PNG
app.get('/qr', async (req, res) => {
  if (isConnected) {
    return res.json({ status: 'connected', message: 'Ja conectado! Nao precisa escanear.' })
  }
  if (!qrCodeData) {
    return res.json({ status: 'waiting', message: 'Aguarde, gerando QR Code...' })
  }
  try {
    const qrImage = await QRCode.toDataURL(qrCodeData, { width: 300 })
    const html = `<!DOCTYPE html><html><head><title>Kurmo WhatsApp QR</title>
    <style>body{background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff}
    h2{color:#00ff41;font-size:24px;margin-bottom:8px}p{color:#888;margin-bottom:20px}
    img{border:4px solid #00ff41;border-radius:12px;padding:12px;background:#fff}
    .refresh{margin-top:16px;color:#555;font-size:12px}</style>
    <meta http-equiv="refresh" content="30"></head>
    <body><h2>Kurmo PDV — WhatsApp</h2>
    <p>Abra o WhatsApp > Dispositivos vinculados > Vincular dispositivo</p>
    <img src="${qrImage}" alt="QR Code"/>
    <p class="refresh">Esta pagina atualiza automaticamente a cada 30s</p></body></html>`
    res.send(html)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// POST /send — envia mensagem
app.post('/send', async (req, res) => {
  const { phone, message } = req.body
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone e message sao obrigatorios' })
  }
  if (!isConnected || !sock) {
    return res.status(503).json({ error: 'WhatsApp nao conectado', status: 'disconnected' })
  }
  try {
    const num = phone.replace(/\D/g, '')
    const jid = (num.startsWith('55') ? num : '55' + num) + '@s.whatsapp.net'
    await sock.sendMessage(jid, { text: message })
    res.json({ success: true, to: jid })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET / — health check
app.get('/', (req, res) => {
  res.json({ name: 'Kurmo WhatsApp API', version: '2.0', connected: isConnected })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('Kurmo WhatsApp API rodando na porta', PORT)
  connectWA()
})