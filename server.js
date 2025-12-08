import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';

const PORT = Number(process.env.PORT) || 3000;
const BASE_DIR = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

function toSafePath(urlPath) {
  const normalized = path.normalize(urlPath).replace(/^\/+/, '');
  return normalized.startsWith('..') ? '' : normalized;
}

const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const safePath = toSafePath(decodeURIComponent(pathname));
  let filePath = path.join(BASE_DIR, safePath);

  try {
    let fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      fileStat = await stat(filePath);
    }

    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' ? 404 : 500, {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    res.end(err.code === 'ENOENT' ? 'Not found' : 'Server error');
  }
});

server.listen(PORT, () => {
  console.log(`Jazz Comping Generator available at http://localhost:${PORT}`);
});
