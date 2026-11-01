import { INTENTS, SERVICES } from './model.ts';
import type { Model, ModelInput, ModelOutput } from './model.ts';

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const SYSTEM_PROMPT = `You read one message from a user of a home-services errand assistant and reply with one JSON object.
You only extract what the user said. You cannot book, approve or call anything.

Fields:
- intent: one of ${INTENTS.join(', ')}
- slots: any of service (${SERVICES.join(', ')}), area, dateFrom, dateTo (YYYY-MM-DD), earliest, latest (HH:MM, 24 hour), budget (number), noBudget, notes, sameAsLast
- selection: any of index (1-based), providerQuery, time (HH:MM, or YYYY-MM-DDTHH:MM when the user names a day), when the user picks one of the listed options
- memory: { op: view | set | forget, key: area | earliest_time | technician:<service> | all, value, evidence }, where evidence quotes the user's exact words

Use provide for answers and corrections during an errand, decline for "no", and none if nothing applies. Reply with JSON only.`;

/** Optional. Untested live in this repo: evals and tests never call it. */
export class OpenRouterModel implements Model {
  readonly name: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.name = model;
  }

  async interpret(input: ModelInput): Promise<ModelOutput> {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.name,
        response_format: { type: 'json_object' },
        usage: { include: true },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`OpenRouter returned ${response.status}`);

    const body = (await response.json()) as {
      choices: { message: { content: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    return {
      proposal: JSON.parse(body.choices[0].message.content),
      usage: {
        inputTokens: body.usage?.prompt_tokens,
        outputTokens: body.usage?.completion_tokens,
        costUsd: body.usage?.cost,
      },
    };
  }
}
