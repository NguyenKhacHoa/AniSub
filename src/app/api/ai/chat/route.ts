import { NextResponse } from 'next/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { chatWithCinemaAssistant } from '@/lib/ai/cinema-insight';
import {
  GEMINI_FALLBACK_MODELS,
  formatFriendlyGeminiError,
} from '@/lib/gemini/client';
import type {
  CinemaChatMessage,
  CinemaInsightData,
} from '@/types/ai-insight';

export const maxDuration = 30;

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    videoId?: string;
    videoTitle?: string;
    channelTitle?: string | null;
    videoDescription?: string | null;
    insightContext?: Partial<CinemaInsightData> | null;
    messages?: CinemaChatMessage[];
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoTitle = body.videoTitle?.trim();
  const validMessages = Array.isArray(body.messages)
    ? body.messages.filter(
        (m): m is CinemaChatMessage =>
          Boolean(m) &&
          (m.role === 'user' || m.role === 'assistant') &&
          typeof m.content === 'string' &&
          m.content.trim().length > 0,
      )
    : [];

  if (!videoTitle || validMessages.length === 0) {
    return NextResponse.json(
      { error: 'Thiếu thông tin tập phim hoặc nội dung câu hỏi.' },
      { status: 400 },
    );
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu GEMINI_API_KEY trong .env.local.' },
      { status: 500 },
    );
  }

  try {
    const reply = await chatWithCinemaAssistant({
      videoTitle,
      channelTitle: body.channelTitle,
      videoDescription: body.videoDescription,
      insightContext: body.insightContext,
      messages: validMessages,
      models: GEMINI_FALLBACK_MODELS,
    });

    return NextResponse.json({ reply });
  } catch (err) {
    console.error('[POST /api/ai/chat] Lỗi chat Gemini:', err);
    return NextResponse.json(
      {
        error: formatFriendlyGeminiError(err),
      },
      { status: 503 },
    );
  }
}
