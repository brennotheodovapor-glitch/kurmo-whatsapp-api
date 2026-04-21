const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const express = require('express')
const app = express()
app.use(express.json())

let client = null
let clientReady = false
let lastQR = null

function initClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      headless: true
    }
  })

  client.on('qr', (qr) => {
    lastQR = qr
    clientReady = false
    qrcode.generate(qr, { small: true })
    console.log('QR gerado — acesse /qr para ver')
  })

  client.on('ready', () => {
    clientReady = true
    lastQR = null
    console.log('✅ WhatsApp conectado!')
  })

  client.on('disconnected', () => {
    clientReady = false
    console.log('Desconectado, reiniciando...')
    setTimeout(initClient, 5000)
  })

  client.initialize()
}

// GET / — health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', connected: clientReady })
})

// GET /qr — show QR code as text
app.get('/qr', (req, res) => {
  if (clientReady) return res.json({ status: 'already_connected' })
  if (!lastQR) return res.json({ status: 'waiting_for_qr', message: 'Reinicie o serviço se demorar' })
  // Return QR as JSON (use an online QR renderer)
  res.json({ 
    status: 'scan_qr',
    qr: lastQR,
    qr_url: 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(lastQR)
  })
})

// POST /send — send message
app.post('/send', async (req, res) => {
  const { phone, message } = req.body
  if (!phone || !message) return res.status(400).json({ error: 'phone e message obrigatórios' })
  if (!clientReady) return res.status(503).json({ error: 'WhatsApp não conectado', connected: false })
  try {
    // Format: 5527999999999@c.us
    const num = phone.replace(/\D/g, '')
    const formatted = (num.startsWith('55') ? num : '55' + num) + '@c.us'
    await client.sendMessage(formatted, message)
    res.json({ success: true, to: formatted })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(`API rodando na porta ${PORT}`)
  initClient()
})
