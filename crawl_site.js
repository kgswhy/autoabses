const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parseArgs() {
  const start = process.argv[2] || 'https://elearning.budiluhur.ac.id/';
  const depthArg = process.argv.find(a => a.startsWith('--depth='));
  const maxArg = process.argv.find(a => a.startsWith('--max='));
  const depth = depthArg ? parseInt(depthArg.split('=')[1], 10) : 2;
  const maxPages = maxArg ? parseInt(maxArg.split('=')[1], 10) : 100;
  return { start, depth, maxPages };
}

function normalizeUrl(u, base) {
  try { return new URL(u, base).toString(); } catch { return null; }
}

function isSameHost(urlStr, host) {
  try { return new URL(urlStr).host === host; } catch { return false; }
}

function shouldEnqueue(urlStr) {
  // Skip obvious non-HTML endpoints
  return !(/\.(png|jpe?g|gif|svg|webp|ico|css|js|pdf|zip|rar|7z|mp4|mp3|wav|ogg|webm|woff2?|ttf|eot)(\?.*)?$/i.test(urlStr));
}

function looksAdmin(urlStr) {
  const u = urlStr.toLowerCase();
  return u.includes('/admin') || u.includes('/report') || u.includes('/settings') || u.includes('/enrol') || u.includes('/role');
}

async function fetchPage(url) {
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      timeout: 20000,
      validateStatus: s => s >= 200 && s < 400
    });
    const ct = (res.headers['content-type'] || '').toLowerCase();
    return { ok: true, html: ct.includes('text/html') ? res.data : null, contentType: ct };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function crawl() {
  const { start, depth, maxPages } = parseArgs();
  const startUrl = new URL(start);
  const host = startUrl.host;

  const queue = [{ url: startUrl.toString(), d: 0 }];
  const visited = new Set();
  const found = new Set();
  const adminHits = new Set();

  while (queue.length && visited.size < maxPages) {
    const { url, d } = queue.shift();
    if (visited.has(url)) continue;
    visited.add(url);

    const page = await fetchPage(url);
    if (!page.ok) continue;

    found.add(url);
    if (!page.html) continue;

    const $ = cheerio.load(page.html);
    const selectors = ['a[href]', 'link[href]', 'script[src]', 'img[src]', 'iframe[src]', 'source[src]'];
    for (const sel of selectors) {
      $(sel).each((_, el) => {
        const raw = $(el).attr('href') || $(el).attr('src');
        if (!raw) return;
        const abs = normalizeUrl(raw, url);
        if (!abs) return;
        if (!isSameHost(abs, host)) return;
        if (!shouldEnqueue(abs)) { found.add(abs); return; }
        found.add(abs);
        if (looksAdmin(abs)) adminHits.add(abs);
        if (d < depth && !visited.has(abs)) {
          queue.push({ url: abs, d: d + 1 });
        }
      });
    }
    await sleep(200); // be gentle
  }

  const allList = [...found].sort();
  const adminList = [...adminHits].sort();
  console.log(allList.join('\n'));
  try {
    const outAll = path.join(process.cwd(), `crawl_${host}_d${depth}.txt`);
    const outAdmin = path.join(process.cwd(), `crawl_admin_${host}_d${depth}.txt`);
    fs.writeFileSync(outAll, allList.join('\n'));
    fs.writeFileSync(outAdmin, adminList.join('\n'));
    console.error(`Crawled ${visited.size} pages; saved ${allList.length} URLs to ${outAll}`);
    console.error(`Admin-like hits: ${adminList.length} -> ${outAdmin}`);
  } catch {}
}

crawl().catch(e => { console.error('Error:', e.message); process.exit(1); }); 