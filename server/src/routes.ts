import { createSession, getSession, sendMessage } from './handlers/sessions.ts';
import type { HandlerContext } from './handlers/sessions.ts';
import { HttpError } from './http.ts';

interface Route {
  method: string;
  path: string;
  status: number;
  handler: (context: HandlerContext) => unknown;
}

const SAFE_ID = /^[\w-]+$/;

const ROUTES: Route[] = [
  { method: 'POST', path: '/api/sessions', status: 201, handler: createSession },
  { method: 'GET', path: '/api/sessions/:id', status: 200, handler: getSession },
  { method: 'POST', path: '/api/sessions/:id/messages', status: 200, handler: sendMessage },
];

/** The value of `:id` when the path fits the pattern, an empty string if it has none, or null. */
function matchPath(pattern: string, path: string): string | null {
  const expected = pattern.split('/');
  const actual = path.split('/');
  if (expected.length !== actual.length) return null;
  let id = '';
  for (const [index, part] of expected.entries()) {
    if (part === ':id') {
      if (!SAFE_ID.test(actual[index])) return null;
      id = actual[index];
    } else if (part !== actual[index]) {
      return null;
    }
  }
  return id;
}

export function findRoute(method: string, path: string): { route: Route; id: string } {
  const matches = ROUTES.flatMap((route) => {
    const id = matchPath(route.path, path);
    return id === null ? [] : [{ route, id }];
  });
  if (!matches.length) throw new HttpError(404, 'Not found');
  const match = matches.find(({ route }) => route.method === method);
  if (!match) throw new HttpError(405, 'Method not allowed');
  return match;
}
