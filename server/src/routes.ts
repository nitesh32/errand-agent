import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { SessionNotFound, SimulatedCrash } from './agent/agent.ts';
import type { Agent } from './agent/agent.ts';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 2000;
const SAFE_ID = /^[\w-]+$/;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
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

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function sendStatic(response: ServerResponse, clientDir: string, path: string): void {
  const relative = normalize(path === '/' ? 'index.html' : path.slice(1));
  const file = join(clientDir, relative);
  if (!file.startsWith(clientDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
    throw new HttpError(404, 'Not found');
  }
  response.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
}

export interface AppOptions {
  getAgent: () => Agent;
  /** Rebuilds the agent from disk after a simulated crash. */
  restart: () => Agent;
  clientDir: string;
}

export function createApp({ getAgent, restart, clientDir }: AppOptions): Server {
  async function handleApi(method: string, path: string, request: IncomingMessage): Promise<unknown> {
    const agent = getAgent();
    const [, , resource, id, child] = path.split('/');
    if (resource !== 'sessions' || (id && !SAFE_ID.test(id))) throw new HttpError(404, 'Not found');

    if (method === 'POST' && !id) return agent.createSession();
    if (method === 'GET' && id && !child) return agent.getSession(id);
    if (method === 'POST' && id && child === 'messages') {
      const { text, approvalId } = await readJson(request);
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
        throw new HttpError(400, `text must be 1 to ${MAX_TEXT_LENGTH} characters`);
      }
      if (approvalId !== undefined && typeof approvalId !== 'string') throw new HttpError(400, 'approvalId must be a string');
      try {
        return await agent.handleMessage(id, text, approvalId);
      } catch (error) {
        if (!(error instanceof SimulatedCrash)) throw error;
        return restart().getSession(id);
      }
    }
    throw new HttpError(405, 'Method not allowed');
  }

  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const method = request.method ?? 'GET';
    try {
      if (path.startsWith('/api/')) sendJson(response, method === 'POST' && path === '/api/sessions' ? 201 : 200, await handleApi(method, path, request));
      else if (method === 'GET') sendStatic(response, clientDir, path);
      else throw new HttpError(405, 'Method not allowed');
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof SessionNotFound) return sendJson(response, 404, { error: 'Session not found' });
      console.error(error);
      sendJson(response, 500, { error: 'Internal error' });
    }
  });
}
