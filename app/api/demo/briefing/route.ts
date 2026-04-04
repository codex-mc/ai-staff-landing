import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { checkRateLimit } from '@/lib/rate-limit'
import { sanitizeTopic } from '@/lib/sanitize'

const ALLOWED_ORIGIN = process.env.LANDING_ORIGIN ?? ''

const SYSTEM_PROMPT = `Você é um agente de inteligência executiva da AI Staff. \
Dado um tema, gere um briefing executivo de 1 página em PT-BR: \
Contexto → Trade-offs → Recomendação → Próximos Passos. \
Direto, sem padding, ~400-600 palavras.

Responda APENAS com um objeto JSON válido, sem markdown fences, no seguinte formato:
{
  "titulo": "string",
  "contexto": "string",
  "trade_offs": ["string", "string", "string"],
  "recomendacao": "string",
  "proximos_passos": ["string", "string", "string"]
}`

function getCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  // In dev (LANDING_ORIGIN not set), allow any origin so local dev works.
  // In production, only allow the configured origin.
  if (!ALLOWED_ORIGIN || (origin && origin === ALLOWED_ORIGIN)) {
    headers['Access-Control-Allow-Origin'] = origin ?? '*'
  } else {
    headers['Access-Control-Allow-Origin'] = ALLOWED_ORIGIN
  }

  return headers
}

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

// Handle CORS preflight
export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin')
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  })
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const corsHeaders = getCorsHeaders(origin)

  // CORS guard — block requests from unknown origins in production
  if (ALLOWED_ORIGIN && origin && origin !== ALLOWED_ORIGIN) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: corsHeaders })
  }

  // Rate limit
  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip)

  const rateLimitHeaders = {
    ...corsHeaders,
    'X-RateLimit-Limit': '10',
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(Math.ceil(rl.resetAt / 1000)),
  }

  if (!rl.success) {
    return NextResponse.json(
      { error: 'Muitas requisições. Tente novamente em 1 hora.' },
      { status: 429, headers: rateLimitHeaders }
    )
  }

  // Parse + validate body
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400, headers: corsHeaders })
  }

  if (typeof body !== 'object' || body === null || !('topic' in body)) {
    return NextResponse.json(
      { error: 'Campo "topic" é obrigatório.' },
      { status: 400, headers: corsHeaders }
    )
  }

  const rawTopic = (body as Record<string, unknown>).topic
  if (typeof rawTopic !== 'string' || rawTopic.trim().length === 0) {
    return NextResponse.json(
      { error: 'Campo "topic" deve ser uma string não vazia.' },
      { status: 400, headers: corsHeaders }
    )
  }

  const topic = sanitizeTopic(rawTopic)
  if (topic.length === 0) {
    return NextResponse.json(
      { error: 'Conteúdo inválido no campo "topic".' },
      { status: 400, headers: corsHeaders }
    )
  }

  // Call Claude
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), 30_000)

  try {
    const message = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Tema: ${topic}`,
          },
        ],
      },
      { signal: abortController.signal }
    )

    const raw = message.content[0]
    if (raw.type !== 'text') {
      throw new Error('Unexpected response type from Claude')
    }

    let briefing: unknown
    try {
      briefing = JSON.parse(raw.text)
    } catch {
      // Claude returned non-JSON — return as plain text wrapped in our schema
      briefing = {
        titulo: topic,
        contexto: raw.text,
        trade_offs: [],
        recomendacao: '',
        proximos_passos: [],
      }
    }

    return NextResponse.json({ briefing }, { status: 200, headers: corsHeaders })
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'O serviço demorou muito para responder. Tente novamente.' },
        { status: 504, headers: corsHeaders }
      )
    }
    console.error('[briefing] Claude error:', err)
    return NextResponse.json(
      { error: 'Erro interno. Tente novamente em instantes.' },
      { status: 500, headers: corsHeaders }
    )
  } finally {
    clearTimeout(timeout)
  }
}
