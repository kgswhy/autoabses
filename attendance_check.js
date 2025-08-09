const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'attendance_hourly.log');

// Hardcoded configuration
const CONFIG = {
  UBL_USERNAME: '2512510237',
  UBL_PASSWORD: 'P13032006',
  COURSE_ID: '29050',
  TELEGRAM_BOT_TOKEN: '7950123660:AAFHnzSmAgyNeVLiHfpmBAaitpvE35iFnTk',
  TELEGRAM_CHAT_ID: '1743712356'
};

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function timestamp() {
  return new Date().toISOString();
}

function extractJson(text) {
  const jsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (!jsonMatches) return null;
  
  for (let i = jsonMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(jsonMatches[i]);
      if (parsed.courseTitle && parsed.attendance && Array.isArray(parsed.attendance)) {
        return parsed;
      }
    } catch (e) {
      // Continue to next match
    }
  }
  return null;
}

function sendTelegram(text) {
  const token = CONFIG.TELEGRAM_BOT_TOKEN;
  const chatId = CONFIG.TELEGRAM_CHAT_ID;
  
  const payload = JSON.stringify({ 
    chat_id: chatId, 
    text, 
    parse_mode: 'HTML', 
    disable_web_page_preview: true 
  });
  
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${token}/sendMessage`,
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json', 
      'Content-Length': Buffer.byteLength(payload) 
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Telegram sent');
      } else {
        console.log(`❌ Telegram API error: ${res.statusCode}`);
      }
    });
  });
  
  req.on('error', (err) => {
    console.log(`❌ Telegram error: ${err.message}`);
  });
  
  req.write(payload);
  req.end();
}

function summarizeRunOutput(buf) {
  const data = extractJson(buf);
  if (!data) return null;
  
  if (data.attendance && Array.isArray(data.attendance)) {
    const results = data.attendance.flatMap(a => a.sessions ? a.sessions : [a]);
    const successes = results.filter(r => r && r.success);
    const attempted = results.filter(r => r && r.attempted);
    const failed = results.filter(r => r && !r.success && r.attempted);
    const notAvailable = results.filter(r => r && !r.attempted);
    
    return {
      courseTitle: data.courseTitle,
      attempted: attempted.length,
      successes: successes.length,
      failed: failed.length,
      notAvailable: notAvailable.length,
      total: results.length,
      details: successes.map(s => `✔ ${s.url || ''} ${s.message || ''}`.trim()).join('\n'),
      failedDetails: failed.map(f => `❌ ${f.url || ''} ${f.message || ''}`.trim()).join('\n'),
      notAvailableDetails: notAvailable.map(n => `⏳ ${n.url || ''} ${n.message || ''}`.trim()).join('\n')
    };
  }
  return null;
}

function runAttendanceCheck() {
  return new Promise((resolve) => {
    console.log(`🔄 Running attendance check...`);
    
    const args = ['scrape_ubl.js', '--attend', '--all-attendance'];
    const proc = spawn('node', args, { 
      cwd: process.cwd(), 
      env: {
        ...process.env,
        UBL_USERNAME: CONFIG.UBL_USERNAME,
        UBL_PASSWORD: CONFIG.UBL_PASSWORD,
        COURSE_ID: CONFIG.COURSE_ID
      }
    });

    let buffer = '';
    let logData = `\n=== ${timestamp()} ===\n`;

    proc.stdout.on('data', (d) => { 
      const data = d.toString();
      buffer += data; 
      logData += data;
    });
    
    proc.stderr.on('data', (d) => { 
      const data = d.toString();
      buffer += data; 
      logData += data;
    });

    proc.on('close', (code) => {
      logData += `\n--- exit code: ${code} @ ${timestamp()} ---\n`;
      
      // Write to log file
      fs.appendFileSync(LOG_FILE, logData);
      
      console.log(`📊 Completed (exit: ${code})`);
      
      const summary = summarizeRunOutput(buffer);
      if (summary) {
        console.log(`📈 Summary: ${summary.successes}/${summary.total} successful`);
        
        const time = new Date().toLocaleString('id-ID', { 
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        let message = `📊 <b>Auto Attendance Report</b>\n\n`;
        message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
        message += `📚 <b>Course:</b> ${summary.courseTitle}\n`;
        message += `⏰ <b>Time:</b> ${time}\n\n`;
        
        if (summary.successes > 0) {
          message += `✅ <b>SUCCESS:</b> ${summary.successes} attendance submitted\n`;
          if (summary.details) {
            message += `\n${summary.details}`;
          }
        } else if (summary.attempted > 0) {
          message += `⚠️ <b>ATTEMPTED:</b> ${summary.attempted} sessions tried but failed\n`;
          if (summary.failedDetails) {
            message += `\n${summary.failedDetails}`;
          }
        } else if (summary.notAvailable > 0) {
          message += `⏳ <b>WAITING:</b> ${summary.notAvailable} sessions available but no submission form\n`;
          message += `\n💡 <i>Menunggu dosen membuka form absensi</i>\n`;
          if (summary.notAvailableDetails) {
            message += `\n${summary.notAvailableDetails}`;
          }
        } else {
          message += `ℹ️ <b>NO SESSIONS:</b> Tidak ada sesi attendance yang ditemukan\n`;
          message += `\n💡 <i>Belum ada jadwal attendance atau sudah selesai</i>`;
        }
        
        message += `\n\n🔄 <i>Next check in 1 minute</i>`;
        
        sendTelegram(message);
      } else {
        console.log('❌ Could not parse output');
        const time = new Date().toLocaleString('id-ID', { 
          timeZone: 'Asia/Jakarta',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit'
        });
        
        let message = `❌ <b>Auto Attendance Error</b>\n\n`;
        message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
        message += `⏰ <b>Time:</b> ${time}\n`;
        message += `\n🔧 <b>Error:</b> Tidak dapat memparse output dari scraper\n`;
        message += `\n💡 <i>Mungkin ada masalah dengan koneksi atau format data</i>`;
        
        sendTelegram(message);
      }
      resolve();
    });
    
    proc.on('error', (err) => {
      console.log(`❌ Process error: ${err.message}`);
      const time = new Date().toLocaleString('id-ID', { 
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
      
      let message = `❌ <b>Auto Attendance Error</b>\n\n`;
      message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
      message += `⏰ <b>Time:</b> ${time}\n`;
      message += `\n🔧 <b>Error:</b> ${err.message}\n`;
      message += `\n💡 <i>Mungkin ada masalah dengan koneksi atau login</i>`;
      
      sendTelegram(message);
      resolve();
    });
  });
}

async function main() {
  ensureLogDir();
  
  console.log(`🚀 Starting attendance check...`);
  console.log(`📱 Telegram configured: ${CONFIG.TELEGRAM_BOT_TOKEN ? 'Yes' : 'No'}`);

  // Run once and exit
  await runAttendanceCheck();
  
  console.log('✅ Attendance check completed');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e.message);
  const time = new Date().toLocaleString('id-ID', { 
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  
  let message = `❌ <b>Auto Attendance Fatal Error</b>\n\n`;
  message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
  message += `⏰ <b>Time:</b> ${time}\n`;
  message += `\n🔧 <b>Error:</b> ${e.message}\n`;
  message += `\n💡 <i>Script mengalami error fatal</i>`;
  
  sendTelegram(message);
  process.exit(1);
}); 