const { CookieJar } = require('tough-cookie');
const { wrapper } = require('axios-cookiejar-support');
const axios = require('axios');
const cheerio = require('cheerio');
const dotenv = require('dotenv');
const UserAgent = require('user-agents');
const fs = require('fs');
const path = require('path');

dotenv.config({ quiet: true });

const BASE = 'https://elearning.budiluhur.ac.id';

function isVerbose() {
  return process.argv.includes('--verbose') || process.argv.includes('-v');
}

function logStep(...args) {
  if (isVerbose()) {
    const ts = new Date().toISOString();
    console.log('[INFO]', ts, ...args);
  }
}

function dumpSetCookieHeaders(res, label) {
  if (!isVerbose()) return;
  const setc = res && res.headers && (res.headers['set-cookie'] || res.headers['Set-Cookie']);
  if (setc && setc.length) {
    console.log('[SET-COOKIE]', label, setc);
  } else {
    console.log('[SET-COOKIE]', label, 'none');
  }
}

function dumpSelectedHeaders(res, label) {
  if (!isVerbose() || !res || !res.headers) return;
  const h = res.headers;
  const pick = {
    'date': h['date'],
    'server': h['server'],
    'content-type': h['content-type'],
    'cache-control': h['cache-control'],
    'cf-ray': h['cf-ray'],
    'cf-cache-status': h['cf-cache-status'],
    'strict-transport-security': h['strict-transport-security']
  };
  console.log('[HEADERS]', label, pick);
}

function dumpJarCookies(jar, urlLabel, url) {
  if (!isVerbose()) return;
  try {
    const cookies = jar.getCookiesSync(url).map(c => `${c.key}=${c.value}; Domain=${c.domain}; Path=${c.path}; Secure=${c.secure ? '✓' : '-'}`);
    console.log('[COOKIES]', urlLabel, cookies);
  } catch (e) {
    console.log('[COOKIES]', urlLabel, 'error', e.message);
  }
}

const COOKIES_PATH = path.join(process.cwd(), 'cookies.json');

function loadCookieJar() {
  try {
    if (fs.existsSync(COOKIES_PATH)) {
      const raw = fs.readFileSync(COOKIES_PATH, 'utf8');
      const data = JSON.parse(raw);
      const jar = CookieJar.fromJSON(data);
      logStep('Loaded cookies from cookies.json');
      return jar;
    }
  } catch (e) {
    logStep('No valid cookies.json, starting fresh');
  }
  return new CookieJar();
}

function saveCookieJar(jar) {
  try {
    const serialized = jar.serializeSync();
    fs.writeFileSync(COOKIES_PATH, JSON.stringify(serialized, null, 2));
    logStep('Saved cookies to cookies.json');
  } catch (e) {
    logStep('Failed to save cookies:', e.message);
  }
}

function seedJarFromEnv(jar) {
  const now = Date.now();
  try {
    if (process.env.CF_CLEARANCE) {
      // Cloudflare clearance cookie scoped to parent domain
      const cookieStr = `cf_clearance=${process.env.CF_CLEARANCE}; Domain=.budiluhur.ac.id; Path=/; Secure; HttpOnly; SameSite=None`;
      jar.setCookieSync(cookieStr, 'https://budiluhur.ac.id/');
      logStep('Seeded cf_clearance from env');
    }
    if (process.env.MOODLESESSION) {
      const cookieStr = `MoodleSession=${process.env.MOODLESESSION}; Domain=elearning.budiluhur.ac.id; Path=/`;
      jar.setCookieSync(cookieStr, 'https://elearning.budiluhur.ac.id/');
      logStep('Seeded MoodleSession from env');
    }
    if (process.env.GCL_AU) {
      const cookieStr = `_gcl_au=${process.env.GCL_AU}; Domain=.budiluhur.ac.id; Path=/`;
      jar.setCookieSync(cookieStr, 'https://budiluhur.ac.id/');
      logStep('Seeded _gcl_au from env');
    }
  } catch (e) {
    logStep('Seeding cookies failed:', e.message);
  }
}

function buildClient(existingJar) {
  const jar = existingJar || new CookieJar();
  const client = wrapper(axios.create({
    baseURL: BASE,
    jar,
    withCredentials: true,
    headers: {
      'User-Agent': new UserAgent().toString(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Connection': 'keep-alive',
    },
    maxRedirects: 5,
    validateStatus: (s) => s >= 200 && s < 400,
    timeout: 30000,
  }));
  return { client, jar };
}

async function getLoginToken(client) {
  logStep('Fetching login page...');
  const res = await client.get('/login/index.php');
  logStep('GET /login/index.php ->', res.status);
  dumpSelectedHeaders(res, 'GET /login/index.php');
  dumpSetCookieHeaders(res, 'GET /login/index.php');
  const $ = cheerio.load(res.data);
  const token = $('input[name="logintoken"]').attr('value') || $('input[name="_token"]').attr('value');
  logStep('Login token present:', Boolean(token));
  return token;
}

async function login(client, jar, username, password) {
  const token = await getLoginToken(client);
  if (!token) {
    throw new Error('Login token not found');
  }
  const form = new URLSearchParams();
  form.set('anchor', '');
  form.set('logintoken', token);
  form.set('username', username);
  form.set('password', password);

  logStep('Posting credentials to /login/index.php ...');
  const res = await client.post('/login/index.php', form.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': BASE,
      'Referer': BASE + '/login/index.php',
    },
    maxRedirects: 0,
    validateStatus: (s) => s === 303 || s === 302 || (s >= 200 && s < 300)
  });
  logStep('POST /login/index.php ->', res.status, res.headers.location ? 'redirect to ' + res.headers.location : '');
  dumpSelectedHeaders(res, 'POST /login/index.php');
  dumpSetCookieHeaders(res, 'POST /login/index.php');

  // Follow redirect to dashboard to confirm login
  let nextUrl = res.headers.location || '/';
  if (nextUrl) {
    const absolute = nextUrl.startsWith('http');
    const target = absolute ? nextUrl : BASE + (nextUrl.startsWith('/') ? nextUrl : '/' + nextUrl);
    logStep('Following redirect:', target);
    const red = await client.get(target);
    dumpSelectedHeaders(red, 'redirect target');
    dumpSetCookieHeaders(red, 'redirect target');
  }

  // Check if we see a logout link or user menu (rough check)
  logStep('Validating session at /my/ ...');
  const dash = await client.get('/my/');
  logStep('GET /my/ ->', dash.status);
  dumpSelectedHeaders(dash, 'GET /my/');
  dumpSetCookieHeaders(dash, 'GET /my/');
  const $ = cheerio.load(dash.data);
  const loggedIn = $('a[href*="/login/logout.php"], a[data-action="logout"]').length > 0 || $('div.usermenu').length > 0;
  logStep('Logged in detected:', loggedIn);
  if (!loggedIn) {
    throw new Error('Login failed. Please verify credentials.');
  }
  saveCookieJar(jar);
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function parseCourse(html) {
  const $ = cheerio.load(html);
  const courseTitle = normalizeText($('h1').first().text()) || normalizeText($('#page-header h1').first().text());
  const sections = [];

  $('.course-content .section, li.section').each((_, el) => {
    const sectionTitle = normalizeText($(el).find('.sectionname, h3.sectionname, .sectionname > span').first().text());
    const activities = [];
    $(el).find('li.activity, .activity').each((__, act) => {
      const name = normalizeText($(act).find('.instancename').first().text()) || normalizeText($(act).find('a').first().text());
      const url = $(act).find('a').attr('href') || null;
      const mod = ($(act).attr('class') || '').split(/\s+/).find(c => c.startsWith('modtype_')) || null;
      activities.push({ name, url, type: mod });
    });
    if (sectionTitle || activities.length > 0) {
      sections.push({ sectionTitle, activities });
    }
  });

  return { courseTitle, sections };
}

async function fetchCourse(client, courseId) {
  logStep('Fetching course view id=', courseId);
  const res = await client.get(`/course/view.php`, { params: { id: courseId } });
  logStep('GET /course/view.php?id=' + courseId + ' ->', res.status);
  dumpSelectedHeaders(res, 'GET /course/view.php');
  dumpSetCookieHeaders(res, 'GET /course/view.php');
  if (String(res.request.res.responseUrl || '').includes('login/index.php')) {
    throw new Error('Session not authenticated when fetching course');
  }
  return res.data;
}

function getAbsoluteUrl(url) {
  if (!url) return null;
  if (url.startsWith('http')) return url;
  if (url.startsWith('/')) return BASE + url;
  return BASE + '/' + url.replace(/^\/+/,'');
}

function findAttendanceActivities(sections) {
  const urls = [];
  for (const section of sections) {
    for (const act of section.activities || []) {
      if (act.type && act.type.includes('modtype_attendance') && act.url) {
        urls.push(getAbsoluteUrl(act.url));
      }
    }
  }
  return Array.from(new Set(urls));
}

function resolveFormAction($, formEl) {
  const action = $(formEl).attr('action') || '/mod/attendance/attendance.php';
  return getAbsoluteUrl(action);
}

function collectHiddenFields($, formEl) {
  const fields = {};
  $(formEl).find('input[type="hidden"]').each((_, inp) => {
    const name = $(inp).attr('name');
    const value = $(inp).attr('value') ?? '';
    if (name) fields[name] = value;
  });
  return fields;
}

function findStatusRadios($, formEl) {
  const radios = [];
  $(formEl).find('input[type="radio"]').each((_, r) => {
    const name = $(r).attr('name') || '';
    if (/^status(\b|\[|_)/i.test(name) || name === 'status' || name === 'statusid') {
      const id = $(r).attr('id');
      let labelText = '';
      if (id) {
        labelText = normalizeText($(formEl).find(`label[for="${id}"]`).text());
      }
      if (!labelText) {
        labelText = normalizeText($(r).closest('label').text());
      }
      if (!labelText) {
        labelText = normalizeText($(r).attr('aria-label') || $(r).attr('title'));
      }
      radios.push({ name, value: $(r).val(), label: labelText });
    }
  });
  return radios;
}

function choosePresentStatus(radios) {
  if (!radios || radios.length === 0) return null;
  const present = radios.find(r => /hadir|present|presen\b/i.test(r.label));
  if (present) return present;
  const letterH = radios.find(r => /^H\b$/i.test(r.label) || /\bHadir\b/i.test(r.label));
  if (letterH) return letterH;
  const letterP = radios.find(r => /^P\b$/i.test(r.label) || /\bPresent\b/i.test(r.label));
  if (letterP) return letterP;
  return null;
}

function extractSessionSubmitLinksFromView(html) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href*="/mod/attendance/attendance.php"]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (/sessid=|sessionid=/.test(href)) {
      const text = normalizeText($(a).text());
      if (/submit|take|isi|presensi|absen/i.test(text) || true) {
        links.push(getAbsoluteUrl(href));
      }
    }
  });
  $('form[action*="/mod/attendance/attendance.php"]').each((_, f) => {
    links.push(resolveFormAction($, f));
  });
  return Array.from(new Set(links));
}

function detectLoginPage(html) {
  const $ = cheerio.load(html);
  const hasLoginForm = $('form[action*="/login/index.php"], input[name="username"], input[name="password"]').length > 0;
  const hasLoginText = /Log in to the site|Username|Password/i.test($.text());
  return hasLoginForm && hasLoginText;
}

async function tryAttendOnPage(client, html, visited = new Set(), depth = 0) {
  const MAX_DEPTH = 6;
  const $ = cheerio.load(html);

  let form = $('form').filter((_, f) => {
    const action = ($(f).attr('action') || '').toLowerCase();
    return action.includes('/mod/attendance/attendance.php');
  }).first();

  logStep('Attendance page: forms targeting attendance.php found =', form.length);

  if (form.length === 0) {
    if (depth >= MAX_DEPTH) {
      return { attempted: false, success: false, message: 'Max navigation depth reached without finding submit form' };
    }
    if (detectLoginPage(html)) {
      return { attempted: false, success: false, message: 'Module page requested login; session window may have expired or access denied' };
    }
    const sessionLinks = extractSessionSubmitLinksFromView(html);
    for (const href of sessionLinks) {
      if (visited.has(href)) continue;
      visited.add(href);
      logStep('Following session submit link ->', href);
      const res = await client.get(href);
      const attempt = await tryAttendOnPage(client, res.data, visited, depth + 1);
      if (attempt.attempted) return attempt;
    }

    const submitTextLink = $('a,button').filter((_, el) => /submit attendance|take attendance|isi presensi|presensi|absen/i.test($(el).text())).first();
    if (submitTextLink.length > 0) {
      const href = $(submitTextLink).attr('href');
      const next = href ? getAbsoluteUrl(href) : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        logStep('Following likely submit link ->', next);
        const res = await client.get(next);
        return tryAttendOnPage(client, res.data, visited, depth + 1);
      }
    }
    return { attempted: false, success: false, message: 'No attendance submission form found' };
  }

  const formEl = form.get(0);
  const actionUrl = resolveFormAction($, formEl);
  const hidden = collectHiddenFields($, formEl);
  const radios = findStatusRadios($, formEl);
  const choice = choosePresentStatus(radios);

  logStep('Form action:', actionUrl);
  logStep('Hidden fields:', Object.keys(hidden));
  logStep('Status options:', radios.map(r => r.label));
  logStep('Chosen status:', choice ? choice.label : 'none');

  if (!choice) {
    return { attempted: true, success: false, message: `Could not find Present/Hadir option. Options: ${radios.map(r => r.label).join(', ')}` };
  }

  const formData = new URLSearchParams();
  for (const [k, v] of Object.entries(hidden)) formData.set(k, v);
  formData.set(choice.name, String(choice.value));
  formData.set('submitbutton', 'Save changes');

  logStep('Submitting attendance...');
  const res = await client.post(actionUrl, formData.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Origin': BASE,
      'Referer': actionUrl,
    }
  });
  logStep('POST attendance ->', res.status);

  const $$ = cheerio.load(res.data);
  const ok = $$('div.alert-success, .alert-success, .notifysuccess').length > 0
    || /attendance saved|has been recorded|presensi tersimpan|kehadiran disimpan/i.test($$.text());
  if (ok) {
    logStep('Detected success message after submission');
    return { attempted: true, success: true, message: 'Attendance submitted as Present/Hadir' };
  }

  const stillForm = $$("form[action*='/mod/attendance/attendance.php']").length > 0;
  logStep('Still seeing attendance form after submit:', stillForm);
  return { attempted: true, success: !stillForm, message: !stillForm ? 'Possibly submitted' : 'Submission may have failed or session not open' };
}

async function attendForModule(client, moduleUrl, options = { listOnly: false }) {
  logStep('Opening attendance module:', moduleUrl);
  const initial = await client.get(moduleUrl);
  logStep('GET module ->', initial.status);
  dumpSelectedHeaders(initial, 'GET module');
  dumpSetCookieHeaders(initial, 'GET module');

  if (detectLoginPage(initial.data)) {
    return { url: moduleUrl, attempted: false, success: false, message: 'Module requires login view; possibly access restricted or session issue' };
  }

  const candidateUrls = new Set();
  const pushLinksFrom = (html, label) => {
    const links = extractSessionSubmitLinksFromView(html);
    logStep(`Extracted ${links.length} session link(s) from ${label}`);
    for (const l of links) candidateUrls.add(l);
  };

  // 1) Current page
  pushLinksFrom(initial.data, 'default view');

  // 2) Try mode=2 (All sessions)
  try {
    const url = new URL(moduleUrl);
    url.searchParams.set('mode', '2');
    const res2 = await client.get(url.toString());
    logStep('GET mode=2 ->', res2.status);
    dumpSelectedHeaders(res2, 'GET mode=2');
    dumpSetCookieHeaders(res2, 'GET mode=2');
    if (!detectLoginPage(res2.data)) pushLinksFrom(res2.data, 'mode=2');
  } catch (e) {
    logStep('mode=2 fetch failed:', e.message);
  }

  // 3) Try mode=0 (This course)
  try {
    const url = new URL(moduleUrl);
    url.searchParams.set('mode', '0');
    const res0 = await client.get(url.toString());
    logStep('GET mode=0 ->', res0.status);
    dumpSelectedHeaders(res0, 'GET mode=0');
    dumpSetCookieHeaders(res0, 'GET mode=0');
    if (!detectLoginPage(res0.data)) pushLinksFrom(res0.data, 'mode=0');
  } catch (e) {
    logStep('mode=0 fetch failed:', e.message);
  }

  const sessionLinks = Array.from(candidateUrls);
  const results = [];

  if (options.listOnly) {
    for (const link of sessionLinks) {
      results.push({ url: link, canSubmit: true });
    }
    return { url: moduleUrl, sessions: results };
  }

  if (sessionLinks.length > 0) {
    for (const link of sessionLinks) {
      try {
        const page = await client.get(link);
        dumpSelectedHeaders(page, 'GET submit page');
        dumpSetCookieHeaders(page, 'GET submit page');
        const attempt = await tryAttendOnPage(client, page.data);
        results.push({ url: link, ...attempt });
      } catch (e) {
        results.push({ url: link, attempted: true, success: false, message: e.message });
      }
    }
    return { url: moduleUrl, attempted: results.some(r => r.attempted), success: results.some(r => r.success), message: 'Processed sessions', sessions: results };
  }

  // As last resort, try direct form on any of the pages already fetched
  const tryPages = [initial.data];
  try {
    const u2 = new URL(moduleUrl); u2.searchParams.set('mode', '2');
    const p2 = await client.get(u2.toString());
    tryPages.push(p2.data);
  } catch {}
  try {
    const u0 = new URL(moduleUrl); u0.searchParams.set('mode', '0');
    const p0 = await client.get(u0.toString());
    tryPages.push(p0.data);
  } catch {}

  for (const html of tryPages) {
    const attempt = await tryAttendOnPage(client, html);
    if (attempt.attempted) {
      return { url: moduleUrl, ...attempt };
    }
  }

  return { url: moduleUrl, attempted: false, success: false, message: 'No attendance submission form found' };
}

function wantAttendFlag() {
  return process.argv.includes('--attend');
}

function getAttendanceIdFlag() {
  const arg = process.argv.find(a => a.startsWith('--attendance-id='));
  return arg ? arg.split('=')[1] : null;
}

function getAttendanceUrlFlag() {
  const arg = process.argv.find(a => a.startsWith('--attendance-url='));
  return arg ? arg.substring('--attendance-url='.length) : null;
}

function wantAllAttendance() {
  return process.argv.includes('--all-attendance');
}

function wantShowAttendance() {
  return process.argv.includes('--show-attendance');
}

function getDumpFlag() {
  const arg = process.argv.find(a => a.startsWith('--dump='));
  if (arg) return arg.substring('--dump='.length) || 'dump.html';
  return process.argv.includes('--dump') ? 'dump.html' : null;
}

function wantCalendar() {
  return process.argv.includes('--calendar');
}

const ID_MONTH_MAP = {
  'januari': 1,
  'februari': 2,
  'maret': 3,
  'april': 4,
  'mei': 5,
  'juni': 6,
  'juli': 7,
  'agustus': 8,
  'september': 9,
  'oktober': 10,
  'november': 11,
  'desember': 12
};

function parseIndonesianDateFromText(text) {
  if (!text) return null;
  // Look inside [...] first
  const bracketMatch = text.match(/\[(.*?)\]/);
  const candidate = (bracketMatch ? bracketMatch[1] : text).toLowerCase();
  // Expect patterns like: senin, 14 juli 2025 or 14 juli 2025 or 14 desember 2024: pengganti
  const m = candidate.match(/(\d{1,2})\s+([a-z]+)\s+(\d{4})/i);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const monthName = m[2].normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const year = parseInt(m[3], 10);
  const month = ID_MONTH_MAP[monthName];
  if (!month) return { raw: m[0] };
  const iso = new Date(Date.UTC(year, month - 1, day)).toISOString().substring(0, 10);
  return { iso, year, month, day, raw: m[0] };
}

function deriveAttendanceScheduleFromSections(parsed) {
  const items = [];
  for (const section of parsed.sections || []) {
    const dateInfo = parseIndonesianDateFromText(section.sectionTitle || '');
    const attendanceActs = (section.activities || []).filter(a => a.type && a.type.includes('modtype_attendance'));
    if (attendanceActs.length > 0) {
      items.push({
        sectionTitle: section.sectionTitle,
        date: dateInfo ? (dateInfo.iso || null) : null,
        dateRaw: dateInfo ? dateInfo.raw || null : null,
        attendance: attendanceActs.map(a => ({ name: a.name, url: a.url }))
      });
    }
  }
  return items;
}

async function main() {
  const username = process.env.UBL_USERNAME;
  const password = process.env.UBL_PASSWORD;
  const courseId = process.env.COURSE_ID;

  if (!username || !password) {
    console.error('Missing UBL_USERNAME or UBL_PASSWORD in .env');
    process.exit(1);
  }

  const jar = loadCookieJar();
  const { client } = buildClient(jar);
  seedJarFromEnv(jar);

  // Try to validate existing session
  try {
    logStep('Validating existing cookies at /my/ ...');
    const dash = await client.get('/my/');
    const $ = cheerio.load(dash.data);
    const loggedIn = $('a[href*="/login/logout.php"], a[data-action="logout"]').length > 0 || $('div.usermenu').length > 0;
    if (!loggedIn) {
      logStep('Existing cookies not valid, logging in...');
      await login(client, jar, username, password);
    } else {
      logStep('Existing cookies valid');
    }
  } catch (e) {
    logStep('Existing cookies check failed, logging in...', e.message);
    await login(client, jar, username, password);
  }

  const html = await fetchCourse(client, courseId);
  const parsed = parseCourse(html);

  if (wantCalendar()) {
    const schedule = deriveAttendanceScheduleFromSections(parsed);
    console.log(JSON.stringify({ courseTitle: parsed.courseTitle, schedule }, null, 2));
    saveCookieJar(jar);
    return;
  }

  if (wantShowAttendance()) {
    const specificUrl = getAttendanceUrlFlag();
    if (specificUrl) {
      const res = await attendForModule(client, specificUrl, { listOnly: true });
      const dumpPath = getDumpFlag();
      if (dumpPath) {
        try {
          const page = await client.get(specificUrl);
          fs.writeFileSync(path.join(process.cwd(), dumpPath), String(page.data));
          logStep('Dumped attendance HTML to', dumpPath);
        } catch (e) {
          logStep('Failed to dump HTML:', e.message);
        }
      }
      console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: [res] }, null, 2));
      saveCookieJar(jar);
      return;
    }
    const specificId = getAttendanceIdFlag();
    if (specificId) {
      const url = getAbsoluteUrl(`/mod/attendance/view.php?id=${encodeURIComponent(specificId)}`);
      const res = await attendForModule(client, url, { listOnly: true });
      const dumpPath = getDumpFlag();
      if (dumpPath) {
        try {
          const page = await client.get(url);
          fs.writeFileSync(path.join(process.cwd(), dumpPath), String(page.data));
          logStep('Dumped attendance HTML to', dumpPath);
        } catch (e) {
          logStep('Failed to dump HTML:', e.message);
        }
      }
      console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: [res] }, null, 2));
      saveCookieJar(jar);
      return;
    }
    const attendanceUrls = findAttendanceActivities(parsed.sections);
    const results = [];
    for (const url of attendanceUrls) {
      const r = await attendForModule(client, url, { listOnly: true });
      results.push(r);
    }
    console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: results }, null, 2));
    saveCookieJar(jar);
    return;
  }

  if (wantAttendFlag()) {
    const specificUrl = getAttendanceUrlFlag();
    if (specificUrl) {
      const res = await attendForModule(client, specificUrl);
      const dumpPath = getDumpFlag();
      if (dumpPath) {
        try {
          const page = await client.get(specificUrl);
          fs.writeFileSync(path.join(process.cwd(), dumpPath), String(page.data));
          logStep('Dumped attendance HTML to', dumpPath);
        } catch (e) {
          logStep('Failed to dump HTML:', e.message);
        }
      }
      console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: [res] }, null, 2));
      saveCookieJar(jar);
      return;
    }
    const specificId = getAttendanceIdFlag();
    if (specificId) {
      const url = getAbsoluteUrl(`/mod/attendance/view.php?id=${encodeURIComponent(specificId)}`);
      const res = await attendForModule(client, url);
      const dumpPath = getDumpFlag();
      if (dumpPath) {
        try {
          const page = await client.get(url);
          fs.writeFileSync(path.join(process.cwd(), dumpPath), String(page.data));
          logStep('Dumped attendance HTML to', dumpPath);
        } catch (e) {
          logStep('Failed to dump HTML:', e.message);
        }
      }
      console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: [res] }, null, 2));
      saveCookieJar(jar);
      return;
    }
    const attendanceUrls = wantAllAttendance() ? findAttendanceActivities(parsed.sections) : findAttendanceActivities(parsed.sections).slice(0, 1);
    logStep('Found attendance activities:', attendanceUrls);
    if (attendanceUrls.length === 0) {
      console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: [] }, null, 2));
      saveCookieJar(jar);
      return;
    }
    const results = [];
    for (const url of attendanceUrls) {
      try {
        const res = await attendForModule(client, url);
        results.push(res);
      } catch (e) {
        logStep('Attendance error for', url, '->', e.message);
        results.push({ url, attempted: true, success: false, message: e.message });
      }
    }
    console.log(JSON.stringify({ courseTitle: parsed.courseTitle, attendance: results }, null, 2));
    saveCookieJar(jar);
    return;
  }

  console.log(JSON.stringify(parsed, null, 2));
  saveCookieJar(jar);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
}); 