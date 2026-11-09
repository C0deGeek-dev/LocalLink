import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { verifyBundle } from './bundle.js';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const { manifest } = await verifyBundle(root);
const files = new Map(manifest.files.map((file) => [`/${file.path}`, file]));
files.set('/', files.get('/index.html'));
createServer(async (request, response) => {
  const file = files.get(request.url.split('?')[0]);
  if (!file || !['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(404).end('Not found');
    return;
  }
  try {
    const bytes = await readFile(join(root, file.path));
    response.writeHead(200, {
      'Content-Type': file.content_type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    }).end(request.method === 'HEAD' ? undefined : bytes);
  } catch {
    response.writeHead(500).end('Rebuild the preview');
  }
}).listen(4173, '127.0.0.1', () => console.log('LocalLink preview: http://127.0.0.1:4173 (no gateway or pairing)'));
