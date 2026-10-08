import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const site = path.resolve(process.argv[2]);
const PORT = Number(process.argv[3] || 8881);
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.xml': 'application/xml', '.json': 'application/json', '.txt': 'text/plain' };
http.createServer((rq, rs) => {
  let p = decodeURIComponent(rq.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(site, p), (e, b) => {
    if (e) return rs.writeHead(404).end('not found');
    rs.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    rs.end(b);
  });
}).listen(PORT, '127.0.0.1', () => console.log('serving ' + site + ' on ' + PORT));