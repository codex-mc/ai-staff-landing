const MAX_TOPIC_LENGTH = 500

/**
 * Strip HTML tags and control characters, then trim to MAX_TOPIC_LENGTH.
 * Does not use a DOM parser — safe for server-side Node/Edge runtimes.
 */
export function sanitizeTopic(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, '') // strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // strip control chars
    .trim()
    .slice(0, MAX_TOPIC_LENGTH)
}
