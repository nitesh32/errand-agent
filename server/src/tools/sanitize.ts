import type { Review } from '../types.ts';

export interface SafeReview extends Review {
  flagged: boolean;
}

const MAX_TEXT_LENGTH = 500;
const CONTROL_CHARS = /(?![\n\t])[\p{Cc}\p{Cf}]/gu;
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above|your)/i,
  /disregard (all |any )?(previous|prior|your)/i,
  /\b(pre-?approved|approval granted|user (has )?approved)\b/i,
  /\bsystem\s*:/i,
  /\b(call|invoke|run) (the )?\w*\s*(tool|book|cancel|reschedule)\b/i,
  /<\/?\s*(script|system|assistant|tool)\b/i,
];

function cleanText(text: string): string {
  return text.replace(CONTROL_CHARS, '').slice(0, MAX_TEXT_LENGTH);
}

export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Prepares reviews for display only. The flag changes how a review looks. The real
 * defence is that review text never reaches the model, state, memory or approvals.
 */
export function sanitizeReviews(reviews: Review[]): SafeReview[] {
  return reviews.map((review) => {
    const title = cleanText(review.title);
    const text = cleanText(review.text);
    return { ...review, title, text, flagged: looksLikeInjection(`${title} ${text}`) };
  });
}
