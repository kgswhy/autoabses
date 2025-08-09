const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

async function main() {
  const target = process.argv[2] || 'https://elearning.budiluhur.ac.id/';
  const res = await axios.get(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    timeout: 30000,
    validateStatus: s => s >= 200 && s < 400
  });
  const $ = cheerio.load(res.data);
  const found = new Set();
  const selectors = ['a[href]', 'link[href]', 'script[src]', 'img[src]', 'iframe[src]', 'source[src]'];
  for (const sel of selectors) {
    $(sel).each((_, el) => {
      const raw = $(el).attr('href') || $(el).attr('src');
      if (!raw) return;
      try {
        const abs = new URL(raw, target).toString();
        found.add(abs);
      } catch {
        // ignore bad URLs
      }
    });
  }
  const list = [...found].sort();
  console.log(list.join('\n'));
  try {
    const out = path.join(process.cwd(), `urls_${new URL(target).hostname}.txt`);
    fs.writeFileSync(out, list.join('\n'));
    console.error(`Saved ${list.length} URLs to ${out}`);
  } catch {}
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
}); 