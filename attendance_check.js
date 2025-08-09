const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const LOG_DIR = path.join(process.cwd(), 'logs');
const LOG_FILE = path.join(LOG_DIR, 'attendance_hourly.log');

// Hardcoded configuration (multi-course)
const CONFIG = {
  UBL_USERNAME: '2512510237',
  UBL_PASSWORD: 'P13032006',
  COURSE_IDS: ['29050', '29046'],
  TELEGRAM_BOT_TOKEN: '7950123660:AAFHnzSmAgyNeVLiHfpmBAaitpvE35iFnTk',
  TELEGRAM_CHAT_ID: '1743712356',
  STUDENT_ID: '26710'
};

function ensureLogDir() { try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch {} }
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
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (res.statusCode === 200 && parsed.ok) {
          console.log('✅ Telegram sent');
        } else {
          console.log(`❌ Telegram API responded with error (status ${res.statusCode}): ${body}`);
          try {
            const fallback = JSON.stringify({ chat_id: CONFIG.TELEGRAM_CHAT_ID, text: text.replace(/<[^>]+>/g, ''), disable_web_page_preview: true });
            const req2 = https.request({
              hostname: 'api.telegram.org', path: `/bot${CONFIG.TELEGRAM_BOT_TOKEN}/sendMessage`, method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(fallback) }
            }, (res2) => {
              let b2 = '';
              res2.on('data', c => b2 += c);
              res2.on('end', () => {
                console.log(res2.statusCode === 200 ? '✅ Telegram fallback sent (plain text)' : `❌ Telegram fallback failed: ${b2}`);
              });
            });
            req2.on('error', (e) => console.log(`❌ Telegram fallback error: ${e.message}`));
            req2.write(fallback);
            req2.end();
          } catch {}
        }
      } catch {
        console.log(`❌ Telegram non-JSON response (status ${res.statusCode}): ${body}`);
      }
    });
  });
  req.on('error', (err) => console.log(`❌ Telegram error: ${err.message}`));
  req.write(payload); req.end();
}

function escapeHtml(s) { if (!s) return ''; return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

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

function stripHtml(html) { return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(); }
function normalizeHtml(html) { return html.replace(/\r\n|\r|\n/g, ' ').replace(/\s+/g, ' ').replace(/&amp;/g, '&'); }

async function fetchCourseAttendanceIndexOverview(courseId, studentId) {
  const path = `/mod/attendance/index.php?id=${courseId}&studentid=${studentId}&view=5`;
  const { status, body } = await httpGet(path);
  if (status !== 200) return {};
  const html = normalizeHtml(body);
  const rows = html.split(/<tr[^>]*>/i).slice(1).map(r => r.split(/<\/tr>/i)[0]);
  const result = {};
  for (const rowHtml of rows) {
    const idMatch = rowHtml.match(/mod\/attendance\/view\.php\?id=(\d+)/i);
    if (!idMatch) continue; const id = idMatch[1];
    const tds = []; const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi; let m;
    while ((m = tdRegex.exec(rowHtml)) !== null) tds.push(stripHtml(m[1]));
    if (tds.length < 5) continue;
    const course = tds[0]; const presensi = tds[1]; const takenSessions = tds[2]; const points = tds[3]; const percentage = tds[4];
    const percentNumber = typeof percentage === 'string' ? parseFloat(percentage.replace('%', '')) : NaN;
    const attended = !Number.isNaN(percentNumber) && percentNumber >= 100;
    const statusLabel = attended ? `✅ COMPLETED (${percentage})` : `❌ NOT ATTENDED (${percentage || '-'})`;
    result[id] = { course, presensi, taken: parseInt(takenSessions || '0', 10) || 0, points, percentage, attended, status: statusLabel };
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

async function runAttendanceCheckForCourse(courseId) {
  return new Promise((resolve) => {
    console.log(`🔄 Running attendance check for course ${courseId}...`);
    const args = ['scrape_ubl.js', '--attend', '--all-attendance'];
    const proc = spawn('node', args, { cwd: process.cwd(), env: { ...process.env, UBL_USERNAME: CONFIG.UBL_USERNAME, UBL_PASSWORD: CONFIG.UBL_PASSWORD, COURSE_ID: courseId } });

    let buffer = ''; let logData = `\n=== ${timestamp()} (course ${courseId}) ===\n`;
    proc.stdout.on('data', (d) => { const data = d.toString(); buffer += data; logData += data; });
    proc.stderr.on('data', (d) => { const data = d.toString(); buffer += data; logData += data; });

    proc.on('close', async (code) => {
      logData += `\n--- exit code: ${code} @ ${timestamp()} ---\n`;
      fs.appendFileSync(LOG_FILE, logData);
      console.log(`📊 Completed (course ${courseId}) (exit: ${code})`);

      const summary = summarizeRunOutput(buffer);
      const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

      if (summary) {
        console.log(`📈 Summary: ${summary.successes}/${summary.total} successful`);
        const indexOverview = await fetchCourseAttendanceIndexOverview(courseId, CONFIG.STUDENT_ID);

        const attendedList = Object.keys(indexOverview).filter(id => indexOverview[id].attended);
        const nowSucceeded = summary.successes;
        const hasNoForm = summary.notAvailable > 0 && summary.attempted === 0 && summary.successes === 0;

        let message = `📣 Auto Attendance\n`;
        message += `🗓️ ${time}\n`;
        message += `🏫 Course ID: ${courseId}\n`;
        message += `📚 ${escapeHtml(summary.courseTitle)}\n\n`;

        if (nowSucceeded > 0) {
          message += `✅ Berhasil absen: ${nowSucceeded} sesi\n`;
        } else if (hasNoForm) {
          message += `⏳ Belum bisa absen: form belum tersedia (${summary.notAvailable} sesi)\n`;
        } else if (summary.attempted > 0 && summary.successes === 0) {
          message += `❌ Gagal absen: ${summary.attempted} sesi (akan dicoba lagi)\n`;
        } else if (summary.total === 0) {
          message += `ℹ️ Tidak ada sesi absensi ditemukan\n`;
        } else {
          message += `ℹ️ Tidak ada perubahan absensi saat ini\n`;
        }

        message += `🏁 Total sudah absen (100%): ${attendedList.length} presensi\n`;
        sendTelegram(message);
      } else {
        console.log('❌ Could not parse output');
        try {
          const indexOverview = await fetchCourseAttendanceIndexOverview(courseId, CONFIG.STUDENT_ID);
          const attendedList = Object.keys(indexOverview).filter(id => indexOverview[id].attended);
          let message = `📣 Auto Attendance\n`;
          message += `🗓️ ${time}\n`;
          message += `🏫 Course ID: ${courseId}\n\n`;
          if (attendedList.length > 0) message += `✅ Berhasil absen: total ${attendedList.length} presensi (100%)\n`;
          else message += `⏳ Belum bisa absen: form belum tersedia / tidak ada sesi aktif\n`;
          sendTelegram(message);
        } catch {
          let message = `📣 Auto Attendance\n`;
          message += `🗓️ ${time}\n`;
          message += `🏫 Course ID: ${courseId}\n\n`;
          message += `⏳ Belum bisa absen sekarang (fallback)\n`;
          sendTelegram(message);
        }
      }
      resolve();
    });

    proc.on('error', (err) => {
      console.log(`❌ Process error (course ${courseId}): ${err.message}`);
      const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      let message = `📣 Auto Attendance\n`;
      message += `🗓️ ${time}\n`;
      message += `🏫 Course ID: ${courseId}\n\n`;
      message += `❌ Gagal menjalankan proses: ${err.message}\n`;
      sendTelegram(message);
      resolve();
    });
  });
}

async function main() {
  ensureLogDir();
  console.log(`🚀 Starting attendance check...`);
  console.log(`📱 Telegram configured: ${CONFIG.TELEGRAM_BOT_TOKEN ? 'Yes' : 'No'}`);

  for (const courseId of CONFIG.COURSE_IDS) {
    // run sequentially to avoid overlapping sessions/cookies
    // eslint-disable-next-line no-await-in-loop
    await runAttendanceCheckForCourse(courseId);
  }

  console.log('✅ Attendance check completed');
}

main().catch((e) => {
  console.error('❌ Fatal error:', e.message);
  const time = new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  let message = `📣 Auto Attendance\n`;
  message += `🗓️ ${time}\n\n`;
  message += `❌ Script mengalami error fatal: ${e.message}\n`;
  sendTelegram(message);
  process.exit(1);
}); 