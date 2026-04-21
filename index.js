const chromium = require('@sparticuz/chromium')
const puppeteer = require('puppeteer-core')
const { Client, LocalAuth } = require('whatsapp-web.js')
const express = require('express')
const QRCode = require('qrcode')

const app = express()
app.use(express.json())
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*')
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers','Content-Type')
  if(req.method==='OPTIONS')return res.sendStatus(200)
  next()
})

let qrData=null, connected=false, client=null

async function createClient(){
  try{
    const executablePath = await chromium.executablePath()
    console.log('[WA] Chromium path:', executablePath)

    client = new Client({
      authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
      puppeteer: {
        executablePath,
        headless: chromium.headless,
        args: [...chromium.args,'--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process']
      }
    })

    client.on('qr', async (qr) => {
      console.log('[WA] QR gerado!')
      qrData = qr
      connected = false
    })

    client.on('ready', () => {
      console.log('[WA] Conectado!')
      connected = true
      qrData = null
    })

    client.on('disconnected', (reason) => {
      console.log('[WA] Desconectado:', reason)
      connected = false
      setTimeout(createClient, 5000)
    })

    await client.initialize()
    console.log('[WA] Client inicializado')
  }catch(err){
    console.error('[WA] Erro:', err.message)
    setTimeout(createClient, 10000)
  }
}

app.get('/', (req,res)=>res.json({name:'Kurmo WhatsApp API v5', connected}))

app.get('/status', (req,res)=>{
  if(connected) return res.json({status:'connected', message:'WhatsApp conectado!'})
  if(qrData) return res.json({status:'qr_ready', message:'QR pronto! Acesse /qr'})
  res.json({status:'connecting', message:'Inicializando Chromium...'})
})

app.get('/qr', async (req,res)=>{
  if(connected) return res.json({status:'connected', message:'Ja conectado!'})
  if(!qrData) return res.json({status:'waiting', message:'Aguarde o QR Code...'})
  try{
    const img = await QRCode.toDataURL(qrData, {width:280})
    res.send('<html><head><title>Kurmo QR</title><meta http-equiv="refresh" content="25"><style>body{background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff;margin:0}h2{color:#00ff41;letter-spacing:2px}p{color:#888;font-size:13px;margin:8px 0 16px;text-align:center}img{border:3px solid #00ff41;border-radius:10px;padding:10px;background:#fff}</style></head><body><h2>KURMO PDV - WHATSAPP</h2><p>WhatsApp &rarr; Dispositivos vinculados &rarr; Vincular dispositivo</p><img src="'+img+'"/></body></html>')
  }catch(e){res.status(500).json({error:e.message})}
})

app.post('/send', async (req,res)=>{
  if(!connected||!client) return res.status(503).json({error:'WhatsApp nao conectado'})
  const {phone, message} = req.body
  if(!phone||!message) return res.status(400).json({error:'phone e message obrigatorios'})
  try{
    const n = phone.replace(/\D/g,'')
    const jid = (n.startsWith('55')?n:'55'+n)+'@c.us'
    await client.sendMessage(jid, message)
    res.json({success:true, to:jid})
  }catch(e){res.status(500).json({error:e.message})}
})

const PORT = process.env.PORT || 3000
app.listen(PORT, ()=>{
  console.log('[API] Kurmo WhatsApp API v5 na porta', PORT)
  createClient()
})