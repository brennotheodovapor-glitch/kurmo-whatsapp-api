const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  PHONENUMBER_MCC
} = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const pino = require('pino')
const fs = require('fs')

const app = express()
app.use(express.json())
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*')
  res.header('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  res.header('Access-Control-Allow-Headers','Content-Type')
  if(req.method==='OPTIONS')return res.sendStatus(200)
  next()
})

let sock=null, qrData=null, connected=false, retries=0, timer=null, delay=8000

function log(...a){ console.log('[WA]',...a) }

async function start(){
  clearTimeout(timer)
  try{
    const { state, saveCreds } = await useMultiFileAuthState('./wa_auth')
    const logger = pino({ level:'silent' })

    sock = makeWASocket({
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger)
      },
      logger,
      printQRInTerminal: true,
      browser: ['Kurmo PDV','Safari','1.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    })

    sock.ev.on('creds.update', saveCreds)

    sock.ev.on('connection.update', async (update)=>{
      const { connection, lastDisconnect, qr } = update

      if(qr){
        log('QR gerado!')
        qrData = qr
        connected = false
      }

      if(connection === 'open'){
        log('Conectado!')
        connected = true
        qrData = null
        retries = 0
        delay = 8000
      }

      if(connection === 'close'){
        connected = false
        const code = new Boom(lastDisconnect?.error)?.output?.statusCode
        log('Desconectado codigo:', code)

        if(code === DisconnectReason.loggedOut){
          log('Logout - limpando sessao')
          try{ fs.rmSync('./wa_auth',{recursive:true,force:true}) }catch(e){}
          retries = 0
          delay = 8000
          timer = setTimeout(start, 3000)
        } else if(code === 428 || code === 408 || code === 503){
          // Timeout/unavailable - retry normal
          timer = setTimeout(start, delay)
        } else if(code === 515 || code === 500){
          // Server error - backoff exponencial
          retries++
          delay = Math.min(delay * 1.8, 120000)
          log('Aguardando', Math.round(delay/1000)+'s (tentativa '+retries+')')
          timer = setTimeout(start, delay)
        } else {
          timer = setTimeout(start, 8000)
        }
      }
    })
  }catch(err){
    log('Erro:', err.message)
    delay = Math.min((delay||8000)*2, 120000)
    timer = setTimeout(start, delay)
  }
}

app.get('/',(req,res)=>res.json({
  name:'Kurmo WhatsApp API v3',
  connected, retries, delay: Math.round(delay/1000)+'s'
}))

app.get('/status',(req,res)=>{
  if(connected) return res.json({status:'connected',message:'WhatsApp conectado!'})
  if(qrData) return res.json({status:'qr_ready',message:'QR Code pronto! Acesse /qr'})
  res.json({status:'connecting',message:'Conectando... tentativa '+retries})
})

app.get('/qr', async (req,res)=>{
  if(connected) return res.json({status:'connected',message:'Ja conectado!'})
  if(!qrData) return res.json({status:'waiting',message:'Aguarde o QR Code ser gerado...'})
  try{
    const img = await QRCode.toDataURL(qrData,{width:280,margin:2})
    res.send('<html><head><title>Kurmo QR</title>' +
      '<meta http-equiv="refresh" content="20">' +
      '<style>body{background:#0a0a0a;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff;margin:0}' +
      'h2{color:#00ff41;letter-spacing:2px;margin-bottom:8px}' +
      'p{color:#888;font-size:13px;margin-bottom:16px;text-align:center}' +
      'img{border:3px solid #00ff41;border-radius:10px;padding:10px;background:#fff}' +
      '.tip{margin-top:10px;font-size:11px;color:#555}' +
      '</style></head><body>' +
      '<h2>KURMO PDV - WHATSAPP</h2>' +
      '<p>WhatsApp &rarr; Dispositivos vinculados &rarr; Vincular dispositivo</p>' +
      '<img src="' + img + '"/>' +
      '<p class="tip">Pagina atualiza a cada 20s</p>' +
      '</body></html>')
  }catch(e){res.status(500).json({error:e.message})}
})

app.post('/send', async (req,res)=>{
  if(!connected||!sock) return res.status(503).json({error:'WhatsApp nao conectado'})
  const {phone,message}=req.body
  if(!phone||!message) return res.status(400).json({error:'phone e message obrigatorios'})
  try{
    const n=phone.replace(/\D/g,'')
    const jid=(n.startsWith('55')?n:'55'+n)+'@s.whatsapp.net'
    await sock.sendMessage(jid,{text:message})
    res.json({success:true,to:jid})
  }catch(e){res.status(500).json({error:e.message})}
})

app.get('/reset',(req,res)=>{
  log('Reset solicitado')
  connected=false; qrData=null; retries=0; delay=8000
  clearTimeout(timer)
  if(sock){try{sock.end(new Error('reset'))}catch(e){} sock=null}
  try{fs.rmSync('./wa_auth',{recursive:true,force:true})}catch(e){}
  timer=setTimeout(start,1000)
  res.json({success:true,message:'Reset feito! Acesse /qr em alguns segundos.'})
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>{
  log('API rodando na porta', PORT)
  start()
})