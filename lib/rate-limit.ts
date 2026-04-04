/**
 * Rate limiting for /api/demo/briefing
 *
 * Production: uses Upstash Redis (sliding window, stateful across serverless instances).
 * Set env vars: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.
 *
 * Dev fallback: in-process Map (single instance only — not suitable for production
 * multi-replica deployments without the Upstash env vars set).
 */

const WINDOW_MS = 60 * 60 * 1000 // 1 hour
const MAX_REQUESTS = 10

// --- Dev fallback (in-process) ---
const devStore = new Map<string, { count: number; resetAt: number }>()

function devRateLimit(ip: string): { success: boolean; remaining: number; resetAt: number } {
  const now = Date.now()
  const entry = devStore.get(ip)

  if (!entry || now > entry.resetAt) {
    devStore.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return { success: true, remaining: MAX_REQUESTS - 1, resetAt: now + WINDOW_MS }
  }

  if (entry.count >= MAX_REQUESTS) {
    return { success: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count += 1
  return { success: true, remaining: MAX_REQUESTS - entry.count, resetAt: entry.resetAt }
}

// --- Upstash production path ---
let upstashRatelimit: ((ip: string) => Promise<{ success: boolean; remaining: number; reset: number }>) | null = null

async function loadUpstash() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null
  }
  try {
    const { Ratelimit } = await import('@upstash/ratelimit')
    const { Redis } = await import('@upstash/redis')
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    })
    const ratelimit = new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(MAX_REQUESTS, '1 h'),
      prefix: 'ai-staff-demo',
    })
    return (ip: string) => ratelimit.limit(ip)
  } catch {
    return null
  }
}

export async function checkRateLimit(
  ip: string
): Promise<{ success: boolean; remaining: number; resetAt: number }> {
  if (!upstashRatelimit) {
    upstashRatelimit = await loadUpstash()
  }

  if (upstashRatelimit) {
    const result = await upstashRatelimit(ip)
    return {
      success: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    }
  }

  // Dev fallback
  return devRateLimit(ip)
}
