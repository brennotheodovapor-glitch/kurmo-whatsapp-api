const makeWASocket = require('@whiskeysockets/baileys').default
const { DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const express = require('express')
const QRCode = require('qrcode')
const pino = require('pino')
const fs = require('fs')
const path = require('path')

const app = express()
app.use(express.json())
app.use((req,res,next)=>{
  res.header('Access-Control-Allow-Origin','*')
  if(req.method==='OPTIONS')return res.sendStatus(200)
  next()
})

let sock=null,qrData=null,connected=false,connecting=false
let retries=0,reconnectTimer=null
const AUTH='./auth'

function clearAuth(){
  try{if(fs.existsSync(AUTH))fs.rmSync(AUTH,{recursive:true,force:true})}catch(e){}
}

async function startWA(){
  if(connecting)return
  connecting=true
  clearTimeout(reconnectTimer)
  try{
    const{state,saveCreds}=await useMultiFileAuthState(AUTH)
    sock=makeWASocket({
      auth:state,
      logger:pino({level:'silent'}),
      printQRInTerminal:true,
      browser:['Kurmo','Chrome','1.0'],
      connectTimeoutMs:60000,
      markOnlineOnConnect:false,
      syncFullHistory:false
    })
    sock.ev.on('creds.update',saveCreds)
    sock.ev.on('connection.update',(u)=>{
      connecting=false
      if(u.qr){console.log('[WA] QR gerado');qrData=u.qr;connected=false}
      if(u.connection==='open'){console.log('[WA] Conectado!');connected=true;qrData=null;retries=0}
      if(u.connection==='close'){
        connected=false
        const code=new Boom(u.lastDisconnect?.error)?.output?.statusCode
        console.log('[WA] Fechado codigo',code)
        if(code===401||code===DisconnectReason.loggedOut){clearAuth();retries=0;reconnectTimer=setTimeout(startWA,3000)}
        else{retries++;const d=Math.min(5000*retries,60000);console.log('[WA] Retry em',d/1000,'s');reconnectTimer=setTimeout(startWA,d)}
      }
    })
  }catch(e){
    connecting=false;retries++
    console.error('[WA] Erro:',e.message)
    reconnectTimer=setTimeout(startWA,Math.min(5000*retries,30000))
  }
}

app.get('/',(q,r)=>r.json({ok:true,connected,retries}))
app.get('/status',(q,r)=>{
  if(connected)return r.json({status:'connected',message:'WhatsApp conectado!'})
  if(qrData)return r.json({status:'qr_ready',message:'Acesse /qr para escanear'})
  r.json({status:'connecting',message:'Conectando... tentativa '+retries})
})
app.get('/qr',async(q,r)=>{
  if(connected)return r.json({status:'connected',message:'Ja conectado!'})
  if(!qrData)return r.json({status:'waiting',message:'Aguarde o QR... tentativa '+retries})
  try{
    const img=await QRCode.toDataURL(qrData)
    r.send('<!DOCTYPE html><html><head><title>QR Kurmo</title><meta http-equiv="refresh" content="25"><style>body{background:#0a0a0a;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;font-family:sans-serif;color:#fff}h2{color:#00ff41;font-size:22px}p{color:#888;font-size:13px;margin-bottom:16px}img{border:4px solid #00ff41;border-radius:12px;padding:12px;background:#fff;max-width:280px}.t{font-size:11px;color:#555;margin-top:12px}</style></head><body><h2>KURMO PDV — WHATSAPP</h2><p>WhatsApp > Dispositivos vinculados > Vincular dispositivo</p><img src="'+img+'"/><p class="t">Atualiza a cada 25s</p></body></html>')
  }catch(e){r.status(500).json({error:e.message})}
})
app.post('/send',async(q,r)=>{
  if(!connected||!sock)return r.status(503).json({error:'Nao conectado'})
  const{phone,message}=q.body
  if(!phone||!message)return r.status(400).json({error:'phone e message obrigatorios'})
  try{
    const n=phone.replace(/\D/g,'')
    await sock.sendMessage((n.startsWith('55')?n:'55'+n)+'@s.whatsapp.net',{text:message})
    r.json({success:true})
  }catch(e){r.status(500).json({error:e.message})}
})
app.post('/reset',(q,r)=>{
  clearTimeout(reconnectTimer);sock=null;connected=false;qrData=null;retries=0;connecting=false
  clearAuth();setTimeout(startWA,1000)
  r.json({ok:true,message:'Resetado'})
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>{
  console.log('[API] Kurmo WA v4 porta',PORT)
  clearAuth()
  setTimeout(startWA,500)
})