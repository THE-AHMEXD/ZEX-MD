const http = require('http');
const { Client } = require('pg');

const report = { startedAt: new Date().toISOString(), done: false };

function numberIdentity(text) {
  if (!text) return null;
  const m = text.match(/"id"\s*:\s*"(\d{6,15})/) || text.match(/\b(\d{11,15})[:@]/);
  return m ? m[1] : null;
}

async function inspectDb(url, label) {
  const out = { label };
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    out.connected = true;
    for (const tbl of ['wacreds', 'wakeys']) {
      try {
        const c = await client.query(`select count(*)::int as n from "${tbl}"`);
        out[tbl] = c.rows[0].n;
        if (tbl === 'wacreds' && c.rows[0].n > 0) {
          const rows = await client.query(`select * from "wacreds" limit 1`);
          for (const v of Object.values(rows.rows[0])) {
            const s = typeof v === 'string' ? v : JSON.stringify(v);
            const num = s && s.length > 100 ? numberIdentity(s) : null;
            if (num) { out.number = num; break; }
          }
        }
      } catch (e) {
        out[tbl] = 'err: ' + e.message.slice(0, 80);
      }
    }
  } catch (e) {
    out.connected = false;
    out.error = e.message.slice(0, 200);
  } finally {
    try { await client.end(); } catch (e) {}
  }
  return out;
}

async function run() {
  // 1) create databases if asked
  if (process.env.CREATE_DBS && process.env.DATABASE_URL) {
    const names = process.env.CREATE_DBS.split(',').map(s => s.trim()).filter(Boolean);
    report.create = {};
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
    try {
      await client.connect();
      for (const name of names) {
        try {
          await client.query(`CREATE DATABASE "${name}"`);
          report.create[name] = 'created';
        } catch (e) {
          report.create[name] = e.message.slice(0, 120);
        }
      }
    } catch (e) {
      report.createError = e.message.slice(0, 200);
    } finally {
      try { await client.end(); } catch (e) {}
    }
  }
  // 2) inspect databases if asked: INSPECT_URLS = url1|url2 with labels INSPECT_LABELS = a,b
  if (process.env.INSPECT_URLS) {
    const urls = process.env.INSPECT_URLS.split('|');
    const labels = (process.env.INSPECT_LABELS || '').split(',');
    report.inspect = [];
    for (let i = 0; i < urls.length; i++) {
      report.inspect.push(await inspectDb(urls[i], labels[i] || ('db' + i)));
    }
  }
  report.done = true;
}

run();

const port = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(report, null, 2));
}).listen(port, () => console.log('runner listening on', port));
