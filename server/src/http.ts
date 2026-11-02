import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';

const MAX_BODY_BYTES = 64 * 1024;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (body && typeof body === 'object') return body;
  } catch {
    // reported below
  }
  throw new HttpError(400, 'Body must be a JSON object');
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function sendStatic(response: ServerResponse, clientDir: string, path: string): void {
  const relative = normalize(path === '/' ? 'index.html' : path.slice(1));
  const file = join(clientDir, relative);
  if (!file.startsWith(clientDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
    throw new HttpError(404, 'Not found');
  }
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}
