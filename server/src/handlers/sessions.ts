import type { IncomingMessage } from 'node:http';
import { SimulatedCrash } from '../agent/agent.ts';
import type { Agent } from '../agent/agent.ts';
import { HttpError, readJson } from '../http.ts';

const MAX_TEXT_LENGTH = 2000;

export interface AgentAccess {
  getAgent: () => Agent;
  /** Rebuilds the agent from disk after a simulated crash. */
  restart: () => Agent;
}

export interface HandlerContext extends AgentAccess {
  id: string;
  request: IncomingMessage;
}

export const createSession = ({ getAgent }: HandlerContext) => getAgent().createSession();

export const getSession = ({ getAgent, id }: HandlerContext) => getAgent().getSession(id);

export async function sendMessage({ getAgent, restart, id, request }: HandlerContext) {
  const { text, approvalId } = await readJson(request);
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_LENGTH) {
    throw new HttpError(400, `text must be 1 to ${MAX_TEXT_LENGTH} characters`);
  }
  if (approvalId !== undefined && typeof approvalId !== 'string') throw new HttpError(400, 'approvalId must be a string');
  try {
    return await getAgent().handleMessage(id, text, approvalId);
  } catch (error) {
    if (!(error instanceof SimulatedCrash)) throw error;
    return restart().getSession(id);
  }
}
