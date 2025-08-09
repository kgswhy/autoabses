const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
require('dotenv').config({ path: path.join(process.cwd(), '.env') });

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'attendance_hourly.log');

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
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('❌ Telegram not configured');
    return;
  }
  
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
    return {
      courseTitle: data.courseTitle,
      attempted: attempted.length,
      successes: successes.length,
      details: successes.map(s => `✔ ${s.url || ''} ${s.message || ''}`.trim()).join('\n')
    };
  }
  return null;
}

function runAttendanceCheck() {
  return new Promise((resolve) => {
    console.log(`🔄 Running attendance check...`);
    
    const args = ['scrape_ubl.js', '--attend', '--all-attendance'];
    const proc = spawn('node', args, { cwd: process.cwd(), env: process.env });

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
        console.log(`📈 Summary: ${summary.successes}/${summary.attempted} successful`);
        if (summary.successes > 0) {
          const message = `✅ Auto-absen sukses ${summary.successes}/${summary.attempted} pada ${timestamp()}\n${summary.details}`;
          sendTelegram(message);
        } else if (summary.attempted > 0) {
          const message = `ℹ️ Auto-absen dicoba (${summary.attempted}) namun belum ada yang bisa disubmit (${timestamp()}).`;
          sendTelegram(message);
        } else {
          const message = `⚠️ Auto-absen tidak menemukan sesi yang dapat diikuti (${timestamp()}).`;
          sendTelegram(message);
        }
      } else {
        console.log('❌ Could not parse output');
        sendTelegram(`❌ Auto-absen gagal - tidak dapat memparse output (${timestamp()})`);
      }
      resolve();
    });
    
    proc.on('error', (err) => {
      console.log(`❌ Process error: ${err.message}`);
      sendTelegram(`❌ Auto-absen error: ${err.message} (${timestamp()})`);
      resolve();
    });
  });
}

async function main() {
  ensureLogDir();
  
  console.log(`🚀 Starting attendance check...`);
  
  // Check Telegram configuration
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('⚠️  Warning: Telegram not configured');
  }

  // Run once and exit
  await runAttendanceCheck();
  
  console.log('✅ Attendance check completed');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e.message);
  sendTelegram(`❌ Auto-absen fatal error: ${e.message} (${timestamp()})`);
  process.exit(1);
}); 