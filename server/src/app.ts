import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { SessionNotFound } from './agent/agent.ts';
import type { AgentAccess } from './handlers/sessions.ts';
import { HttpError, sendJson, sendStatic } from './http.ts';
import { findRoute } from './routes.ts';

export interface AppOptions extends AgentAccess {
  clientDir: string;
}

export function createApp({ clientDir, ...agentAccess }: AppOptions): Server {
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    const method = request.method ?? 'GET';
    try {
      if (path.startsWith('/api/')) {
        const { route, id } = findRoute(method, path);
        sendJson(response, route.status, await route.handler({ ...agentAccess, id, request }));
      } else if (method === 'GET') {
        sendStatic(response, clientDir, path);
      } else {
        throw new HttpError(405, 'Method not allowed');
      }
    } catch (error) {
      if (error instanceof HttpError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof SessionNotFound) return sendJson(response, 404, { error: 'Session not found' });
      console.error(error);
      sendJson(response, 500, { error: 'Internal error' });
    }
  });
}
