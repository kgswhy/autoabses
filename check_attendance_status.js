const fs = require('fs');
const https = require('https');

// Load cookies
const cookiesData = JSON.parse(fs.readFileSync('cookies.json', 'utf8'));
const cookieHeader = cookiesData.cookies.map(c => c.key + '=' + c.value).join('; ');

const STUDENT_ID = '26710';

function httpGet(pathname) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'elearning.budiluhur.ac.id',
      path: pathname,
      method: 'GET',
      headers: {
        'Cookie': cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });

    req.on('error', reject);
    req.end();
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
  return html
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&');
}

async function fetchOverviewRow(attendanceId) {
  const url = `/mod/attendance/view.php?id=${attendanceId}&studentid=${STUDENT_ID}&view=5`;
  const { status, body } = await httpGet(url);
  console.log(`\n=== Overview for id=${attendanceId} (studentid=${STUDENT_ID}, view=5) ===`);
  console.log(`Status Code: ${status}`);

  const html = normalizeHtml(body);
  // Split by rows roughly
  const rows = html.split(/<tr[^>]*>/i).slice(1).map(r => r.split(/<\/tr>/i)[0]);
  const targetHref = `/mod/attendance/view.php?id=${attendanceId}`;
  const rowHtml = rows.find(r => r.toLowerCase().includes(targetHref));
  if (!rowHtml) {
    console.log('Row not found for this attendance id.');
    return null;
  }

  // Extract TDs
  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  const cells = [];
  let m;
  while ((m = tdRegex.exec(rowHtml)) !== null) {
    cells.push(stripHtml(m[1]));
  }
  const course = cells[0] || '';
  const presensi = cells[1] || '';
  const takenSessions = cells[2] || '';
  const points = cells[3] || '';
  const percentage = cells[4] || '';

  const taken = parseInt(takenSessions || '0', 10) || 0;
  const statusLabel = taken > 0 ? '✅ COMPLETED' : '❌ NOT ATTENDED';

  const parsed = { course, presensi, taken, points, percentage, status: statusLabel };
  console.log(parsed);
  return parsed;
}

async function checkAttendanceStatus(sessionId) {
  const { status, body } = await httpGet(`/mod/attendance/view.php?id=${sessionId}&mode=1`);
  console.log(`\n=== Session ${sessionId} (mode=1) ===`);
  console.log(`Status Code: ${status}`);
  const hasForm = /attendance\.php/.test(body);
  const isSubmitted = /You have already submitted/i.test(body);
  if (isSubmitted) console.log('✅ ALREADY SUBMITTED');
  else if (!hasForm) console.log('⏳ NO FORM AVAILABLE');
  else console.log('📝 FORM AVAILABLE');
}

async function main() {
  const targetId = process.argv[2] || '1377263';

  await fetchOverviewRow(targetId);
  await checkAttendanceStatus(targetId);
}

main().catch(console.error); 