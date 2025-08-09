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
  TELEGRAM_CHAT_ID: '1743712356',
  STUDENT_ID: '26710'
};

function ensureLogDir() {
  try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {}
}

function timestamp() { return new Date().toISOString(); }

function extractJson(text) {
  const jsonMatches = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  if (!jsonMatches) return null;
  for (let i = jsonMatches.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(jsonMatches[i]);
      if (parsed.courseTitle && parsed.attendance && Array.isArray(parsed.attendance)) return parsed;
    } catch {}
  }
  return null;
}

function sendTelegram(text) {
  const payload = JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true });
  const req = https.request({
    hostname: 'api.telegram.org', path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
  }, (res) => {
    res.on('data', ()=>{});
    res.on('end', ()=>{ console.log(res.statusCode === 200 ? '✅ Telegram sent' : `❌ Telegram API error: ${res.statusCode}`); });
  });
  req.on('error', (err) => console.log(`❌ Telegram error: ${err.message}`));
  req.write(payload); req.end();
}

function getSessionInfo(url) {
  const sessionId = url.match(/id=(\d+)/)?.[1] || 'unknown';
  const names = {
    '1377248': 'Session 1 - Introduction', '1377263': 'Session 2 - Basic Concepts', '1377270': 'Session 3 - Advanced Topics',
    '1377280': 'Session 4 - Practical Work', '1377288': 'Session 5 - Review', '1377296': 'Session 6 - Assessment', '1377307': 'Session 7 - Final'
  };
  return { id: sessionId, name: names[sessionId] || `Session ${sessionId}`, url };
}

function getAttendanceStatus(attendance) {
  if (attendance.success) return '✅ SUBMITTED';
  if (attendance.attempted && !attendance.success) return '❌ FAILED';
  if (attendance.message && attendance.message.includes('No attendance submission form found')) return '⏳ WAITING (No form)';
  return '❓ UNKNOWN';
}

function httpGet(pathname) {
  const cookiesData = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
  const cookieHeader = (cookiesData.cookies || []).map(c => c.key + '=' + c.value).join('; ');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'elearning.budiluhur.ac.id', path: pathname, method: 'GET',
      headers: { 'Cookie': cookieHeader, 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36' }
    }, (res) => {
      let data = ''; res.on('data', chunk => data += chunk); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject); req.end();
  });
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}

function normalizeHtml(html) {
  return html.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&');
}

async function fetchCourseAttendanceIndexOverview(courseId, studentId) {
  // Moodle index for attendance instances in a course
  const path = `/mod/attendance/index.php?id=${courseId}&studentid=${studentId}&view=5`;
  const { status, body } = await httpGet(path);
  if (status !== 200) return {};
  const html = normalizeHtml(body);
  // Split rows and parse each
  const rows = html.split(/<tr[^>]*>/i).slice(1).map(r => r.split(/<\/tr>/i)[0]);
  const result = {};
  for (const rowHtml of rows) {
    // Find attendance id in link
    const idMatch = rowHtml.match(/mod\/attendance\/view\.php\?id=(\d+)/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    // Extract tds
    const tds = []; const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi; let m;
    while ((m = tdRegex.exec(rowHtml)) !== null) tds.push(stripHtml(m[1]));
    if (tds.length < 5) continue;
    const course = tds[0];
    const presensi = tds[1];
    const takenSessions = tds[2];
    const points = tds[3];
    const percentage = tds[4];
    const taken = parseInt(takenSessions || '0', 10) || 0;
    result[id] = { course, presensi, taken, points, percentage, status: taken > 0 ? '✅ COMPLETED' : '❌ NOT ATTENDED' };
  }
  return result;
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
      details: successes.map(s => { const info = getSessionInfo(s.url); return `✔ ${info.name} (ID: ${info.id})`; }).join('\n'),
      failedDetails: failed.map(f => { const info = getSessionInfo(f.url); return `❌ ${info.name} (ID: ${info.id}) - ${f.message || 'Failed'}`; }).join('\n'),
      notAvailableDetails: notAvailable.map(n => { const info = getSessionInfo(n.url); return `⏳ ${info.name} (ID: ${info.id}) - ${n.message || 'No form available'}`; }).join('\n'),
      sessionList: results.map(r => { const info = getSessionInfo(r.url); return { ...info, status: getAttendanceStatus(r), message: r.message || 'Unknown' }; })
    };
  }
  return null;
}

async function runAttendanceCheck() {
  return new Promise((resolve) => {
    console.log(`🔄 Running attendance check...`);
    const args = ['scrape_ubl.js', '--attend', '--all-attendance'];
    const proc = spawn('node', args, { cwd: process.cwd(), env: { ...process.env, UBL_USERNAME: CONFIG.UBL_USERNAME, UBL_PASSWORD: CONFIG.UBL_PASSWORD, COURSE_ID: CONFIG.COURSE_ID } });

    let buffer = ''; let logData = `\n=== ${timestamp()} ===\n`;
    proc.stdout.on('data', (d) => { const data = d.toString(); buffer += data; logData += data; });
    proc.stderr.on('data', (d) => { const data = d.toString(); buffer += data; logData += data; });

    proc.on('close', async (code) => {
      logData += `\n--- exit code: ${code} @ ${timestamp()} ---\n`;
      fs.appendFileSync(LOG_FILE, logData);
      console.log(`📊 Completed (exit: ${code})`);

      const summary = summarizeRunOutput(buffer);
      if (summary) {
        console.log(`📈 Summary: ${summary.successes}/${summary.total} successful`);
        // Fetch index overview once for the course to include completed info
        const indexOverview = await fetchCourseAttendanceIndexOverview(CONFIG.COURSE_ID, CONFIG.STUDENT_ID);

        const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        let message = `📊 <b>Auto Attendance Report</b>\n\n`;
        message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
        message += `📚 <b>Course:</b> ${summary.courseTitle}\n`;
        message += `⏰ <b>Time:</b> ${time}\n\n`;

        // Attendance summary from index page
        const overviewIds = Object.keys(indexOverview);
        if (overviewIds.length > 0) {
          message += `<b>📋 Attendance Summary:</b>\n`;
          overviewIds.forEach((id, idx) => {
            const s = indexOverview[id];
            message += `${idx + 1}. ${s.presensi}\n`;
            message += `   ID: ${id}\n`;
            message += `   Status: ${s.status}\n`;
            message += `   Sessions: ${s.taken}\n`;
            message += `   Points: ${s.points}\n`;
            message += `   Percentage: ${s.percentage}\n\n`;
          });
        }

        if (summary.successes > 0) {
          message += `✅ <b>SUCCESS:</b> ${summary.successes} attendance submitted\n`;
          if (summary.details) message += `\n${summary.details}`;
        } else if (summary.attempted > 0) {
          message += `⚠️ <b>ATTEMPTED:</b> ${summary.attempted} sessions tried but failed\n`;
          if (summary.failedDetails) message += `\n${summary.failedDetails}`;
        } else if (summary.notAvailable > 0) {
          message += `⏳ <b>WAITING:</b> ${summary.notAvailable} sessions available\n`;
          message += `\n💡 <i>Menunggu dosen membuka form absensi</i>\n\n`;
          message += `<b>📋 Session Status:</b>\n`;
          summary.sessionList.forEach((session, index) => {
            message += `${index + 1}. ${session.name}\n`;
            message += `   ID: ${session.id}\n`;
            message += `   Status: ${session.status}\n`;
            if (session.message && session.message !== 'Unknown') message += `   Note: ${session.message}\n`;
            message += `\n`;
          });
        } else {
          message += `ℹ️ <b>NO SESSIONS:</b> Tidak ada sesi attendance yang ditemukan\n`;
          message += `\n💡 <i>Belum ada jadwal attendance atau sudah selesai</i>`;
        }

        message += `\n\n🔄 <i>Next check in 1 minute</i>`;
        sendTelegram(message);
      } else {
        console.log('❌ Could not parse output');
        const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
      const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
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
  await runAttendanceCheck();
  console.log('✅ Attendance check completed');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e.message);
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let message = `❌ <b>Auto Attendance Fatal Error</b>\n\n`;
  message += `👤 <b>NIM:</b> ${CONFIG.UBL_USERNAME}\n`;
  message += `⏰ <b>Time:</b> ${time}\n`;
  message += `\n🔧 <b>Error:</b> ${e.message}\n`;
  message += `\n💡 <i>Script mengalami error fatal</i>`;
  sendTelegram(message);
  process.exit(1);
}); 