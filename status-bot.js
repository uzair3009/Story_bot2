// WA Status Scheduler Bot — Baileys (Linked Device)
// Cara pakai:
//   1) npm install
//   2) node status-bot.js   -> scan QR (atau pakai pairing code, lihat bawah)
//   3) Taruh file gambar/video di folder yang sama, samakan nama dgn "mediaFile" di jadwal.json
//   4) Bot kirim otomatis ke status@broadcast sesuai jadwal. Jalan 24 jam di Railway/VPS.

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const http = require('http');
const PORT = process.env.PORT || 3000;

const JADWAL_FILE = path.join(__dirname, 'jadwal.json');
// Nomor WA bot dari tools (kosong = mode scan QR).
const PAIRING_NUMBER = "";
// Warna & font teks status WA: font 0..3, bg hex
function loadJadwal(){
  try { return JSON.parse(fs.readFileSync(JADWAL_FILE,'utf8')); }
  catch(e){ console.log('⚠️ jadwal.json tidak ditemukan, pakai jadwal kosong.'); return []; }
}
function cronFromISO(iso, repeat){
  const d = new Date(iso);
  const m = d.getMinutes(), h = d.getHours(), day = d.getDay();
  if(repeat==='harian') return m+' '+h+' * * *';
  if(repeat==='mingguan') return m+' '+h+' * * '+day;
  // sekali: jadwalkan tiap menit lalu cek lewat sekali (ditangani di bawah)
  return m+' '+h+' '+d.getDate()+' '+(d.getMonth()+1)+' *';
}
async function kirimStatus(sock, item){
  try{
    console.log('🚀 Kirim:', item.judul, '('+item.tipe+')');
    if(item.tipe==='teks'){
      await sock.sendMessage('status@broadcast', { text: item.teks || item.caption || '', backgroundColor: item.bg || '#075E54', font: item.font ?? 1 });
    } else if(item.tipe==='gambar'){
      const f = path.join(__dirname, item.mediaFile || '');
      if(!fs.existsSync(f)){ console.log('❌ file tidak ada:', f); return; }
      await sock.sendMessage('status@broadcast', { image: fs.readFileSync(f), caption: item.caption || '' });
    } else if(item.tipe==='video'){
      const f = path.join(__dirname, item.mediaFile || '');
      if(!fs.existsSync(f)){ console.log('❌ file tidak ada:', f); return; }
      await sock.sendMessage('status@broadcast', { video: fs.readFileSync(f), caption: item.caption || '', gifPlayback: false });
    }
    console.log('✅ Terkirim:', item.judul);
  }catch(e){ console.log('❌ Gagal kirim', item.judul, e.message); }
}
// Server keep-alive: Replit/Render/Railway butuh port terbuka,
// dan UptimeRobot mem-ping URL ini tiap 5 menit agar bot tidak tidur.
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WA Status Bot aktif');
}).listen(PORT, () => console.log('Keep-alive HTTP di port ' + PORT));
async function start(){
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state, logger: pino({level:'silent'}), printQRInTerminal: false });

  if(PAIRING_NUMBER && !sock.authState.creds.registered){
    const code = await sock.requestPairingCode(PAIRING_NUMBER.replace(/\D/g,''));
    console.log('🔑 Pairing code:', code, '-> masukkan di WA: Perangkat Tertaut > Tautkan dgn nomor telepon');
  }
  sock.ev.on('connection.update', (u)=>{
    const { connection, lastDisconnect, qr } = u;
    if(qr){ console.log('📷 Scan QR ini dengan WA:'); qrcode.generate(qr,{small:true}); }
    if(connection==='open') console.log('✅ Bot terhubung! Menunggu jadwal...');
    if(connection==='close'){
      const code = lastDisconnect?.error?.output?.statusCode;
      console.log('⚠️ Koneksi putus:', code);
      if(code !== DisconnectReason.loggedOut) start();
      else console.log('❌ Logout. Hapus folder ./auth lalu scan ulang.');
    }
  });
  sock.ev.on('creds.update', saveCreds);

  const jadwal = loadJadwal();
  console.log('📅 '+jadwal.length+' jadwal dimuat.');
  jadwal.forEach((item)=>{
    const expr = cronFromISO(item.waktu, item.repeat);
    console.log('⏰ "'+item.judul+'" -> cron "'+expr+'"');
    cron.schedule(expr, ()=> kirimStatus(sock, item), { timezone: 'Asia/Jakarta' });
    // jika tipe sekali & waktunya < 2 menit lagi, kirim juga sekali via timeout agar tidak terlewat
    if(item.repeat==='sekali'){
      const ms = new Date(item.waktu).getTime() - Date.now();
      if(ms>0 && ms<1000*60*60*24) setTimeout(()=>kirimStatus(sock,item), ms);
    }
  });
}
start();