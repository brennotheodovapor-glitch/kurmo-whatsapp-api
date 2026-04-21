const{default:makeWASocket,useMultiFileAuthState,DisconnectReason}=require('@whiskeysockets/baileys')
const express=require('express')
const qrcode=require('qrcode')
const fs=require('fs')
const app=express()
app.use(express.json())

let sock=null
let qrData=null
let connected=false

async function connect(){
  const{state,saveCreds}=await useMultiFileAuthState('./auth')
  sock=makeWASocket({auth:state,printQRInTerminal:true,logger:require('pino')({level:'silent'})})
  sock.ev.on('creds.update',saveCreds)
  sock.ev.on('connection.update',({connection,lastDisconnect,qr})=>{
    if(qr){qrData=qr;connected=false;console.log('QR gerado')}
    if(connection==='open'){connected=true;qrData=null;console.log('✅ WhatsApp conectado!')}
    if(connection==='close'){
      connected=false
      const code=lastDisconnect?.error?.output?.statusCode
      if(code!==DisconnectReason.loggedOut){setTimeout(connect,3000)}
      else{fs.rmSync('./auth',{recursive:true,force:true});connect()}
    }
  })
}

app.get('/',(req,res)=>res.json({status:'ok',connected,hasQR:!!qrData}))

app.get('/qr',async(req,res)=>{
  if(connected)return res.json({status:'connected'})
  if(!qrData)return res.json({status:'waiting',message:'Reiniciando...'})
  const url=await qrcode.toDataURL(qrData)
  res.send('<html><body style="background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh"><h1 style="color:#00ff41;font-family:monospace">KURMO - Escanear QR</h1><img src="'+url+'" style="width:300px;height:300px"/><p style="color:#888;font-family:monospace">Abra o WhatsApp > Menu > Dispositivos conectados > Conectar dispositivo</p></body></html>')
})

app.post('/send',async(req,res)=>{
  const{phone,message}=req.body
  if(!phone||!message)return res.status(400).json({error:'phone e message obrigatorios'})
  if(!connected)return res.status(503).json({error:'WhatsApp nao conectado',connected:false})
  try{
    const num=phone.replace(/\D/g,'')
    const jid=(num.startsWith('55')?num:'55'+num)+'@s.whatsapp.net'
    await sock.sendMessage(jid,{text:message})
    res.json({success:true})
  }catch(e){res.status(500).json({error:e.message})}
})

const PORT=process.env.PORT||3000
app.listen(PORT,()=>{console.log('Porta '+PORT);connect()})
