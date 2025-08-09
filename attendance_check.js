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

function getSessionInfo(url) {
  // Extract session ID from URL
  const sessionId = url.match(/id=(\d+)/)?.[1] || 'unknown';
  
  // Map session IDs to readable names based on the table format
  const sessionNames = {
    '1377248': 'Presensi-01',
    '1377263': 'Presensi-02', 
    '1377270': 'Presensi-03',
    '1377280': 'Presensi-04',
    '1377288': 'Presensi-05',
    '1377296': 'Presensi-06',
    '1377307': 'Presensi-07'
  };
  
  return {
    id: sessionId,
    name: sessionNames[sessionId] || `Session ${sessionId}`,
    url: url
  };
}

function getAttendanceStatus(attendance) {
  // Check if attendance has been submitted
  // This is a simplified check - in reality, we'd need to parse the HTML to see attendance status
  if (attendance.success) {
    return '✅ SUBMITTED';
  } else if (attendance.attempted) {
    return '❌ FAILED';
  } else if (attendance.message && attendance.message.includes('No attendance submission form found')) {
    return '⏳ WAITING (No form)';
  } else {
    return '❓ UNKNOWN';
  }
}

function getAttendancePoints(status) {
  // Based on the table, if submitted = 100 points, if not = 0 points
  if (status === '✅ SUBMITTED') {
    return { points: 100, total: 100, percentage: 100.0 };
  } else {
    return { points: 0, total: 0, percentage: null };
  }
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
      details: successes.map(s => {
        const info = getSessionInfo(s.url);
        return `✔ ${info.name} (ID: ${info.id})`;
      }).join('\n'),
      failedDetails: failed.map(f => {
        const info = getSessionInfo(f.url);
        return `❌ ${info.name} (ID: ${info.id}) - ${f.message || 'Failed'}`;
      }).join('\n'),
      notAvailableDetails: notAvailable.map(n => {
        const info = getSessionInfo(n.url);
        return `⏳ ${info.name} (ID: ${info.id}) - ${n.message || 'No form available'}`;
      }).join('\n'),
      sessionList: results.map(r => {
        const info = getSessionInfo(r.url);
        const status = getAttendanceStatus(r);
        const points = getAttendancePoints(status);
        return {
          ...info,
          status: status,
          message: r.message || 'Unknown',
          points: points.points,
          total: points.total,
          percentage: points.percentage
        };
      })
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
          message += `⏳ <b>WAITING:</b> ${summary.notAvailable} sessions available\n`;
          message += `\n💡 <i>Menunggu dosen membuka form absensi</i>\n\n`;
          
          // Show session details with status
          message += `<b>📋 Session Status:</b>\n`;
          summary.sessionList.forEach((session, index) => {
            message += `${index + 1}. ${session.name}\n`;
            message += `   ID: ${session.id}\n`;
            message += `   Status: ${session.status}\n`;
            if (session.points > 0) {
              message += `   Points: ${session.points} / ${session.total} (${session.percentage}%)\n`;
            } else {
              message += `   Points: 0 / 0 (-)\n`;
            }
            if (session.message && session.message !== 'Unknown') {
              message += `   Note: ${session.message}\n`;
            }
            message += `\n`;
          });
        } else {
          message += `ℹ️ <b>NO SESSIONS:</b> Tidak ada sesi attendance yang ditemukan\n`;
          message += `\n💡 <i>Belum ada jadwal attendance atau sudah selesai</i>`;
        }
        
        // Add summary table
        if (summary.sessionList.length > 0) {
          message += `\n📊 <b>ATTENDANCE SUMMARY:</b>\n`;
          message += `┌─────────────────┬─────────────┬─────────────────────┬─────────────┐\n`;
          message += `│ Session         │ Status      │ Points              │ Percentage  │\n`;
          message += `├─────────────────┼─────────────┼─────────────────────┼─────────────┤\n`;
          
          summary.sessionList.forEach(session => {
            const statusIcon = session.status.includes('SUBMITTED') ? '✅' : 
                             session.status.includes('FAILED') ? '❌' : 
                             session.status.includes('WAITING') ? '⏳' : '❓';
            const statusText = session.status.includes('SUBMITTED') ? 'SUBMITTED' :
                             session.status.includes('FAILED') ? 'FAILED' :
                             session.status.includes('WAITING') ? 'WAITING' : 'UNKNOWN';
            const pointsText = session.points > 0 ? `${session.points} / ${session.total}` : '0 / 0';
            const percentageText = session.percentage ? `${session.percentage}%` : '-';
            
            message += `│ ${session.name.padEnd(15)} │ ${statusIcon} ${statusText.padEnd(8)} │ ${pointsText.padEnd(17)} │ ${percentageText.padEnd(9)} │\n`;
          });
          
          message += `└─────────────────┴─────────────┴─────────────────────┴─────────────┘\n`;
          
          // Calculate totals
          const totalSubmitted = summary.sessionList.filter(s => s.status.includes('SUBMITTED')).length;
          const totalPoints = summary.sessionList.reduce((sum, s) => sum + s.points, 0);
          const totalPossible = summary.sessionList.length * 100;
          const overallPercentage = totalPossible > 0 ? ((totalPoints / totalPossible) * 100).toFixed(1) : 0;
          
          message += `\n📈 <b>OVERALL:</b> ${totalSubmitted}/${summary.sessionList.length} sessions submitted\n`;
          message += `🎯 <b>TOTAL POINTS:</b> ${totalPoints}/${totalPossible} (${overallPercentage}%)\n`;
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