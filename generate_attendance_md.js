const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function toMarkdown(schedule, courseTitle) {
  const lines = [];
  lines.push(`# Attendance Dates - ${courseTitle}`);
  lines.push('');
  lines.push('| Date (ISO) | Section | Attendance |');
  lines.push('|---|---|---|');
  for (const item of schedule) {
    const date = item.date || (item.dateRaw || '-');
    const section = item.sectionTitle || '-';
    const atts = (item.attendance || []).map(a => `[${a.name}](${a.url})`).join('<br/>');
    lines.push(`| ${date} | ${section} | ${atts} |`);
  }
  lines.push('');
  return lines.join('\n');
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in output');
  }
  return text.slice(start, end + 1);
}

function main() {
  const out = execFileSync('node', ['scrape_ubl.js', '--calendar'], { encoding: 'utf8' });
  const jsonStr = extractJson(out);
  const data = JSON.parse(jsonStr);
  const md = toMarkdown(data.schedule || [], data.courseTitle || '');
  const outPath = path.join(process.cwd(), 'attendance_schedule.md');
  fs.writeFileSync(outPath, md);
  console.log(`Wrote ${outPath}`);
}

main(); 