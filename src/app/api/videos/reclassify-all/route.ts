import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  classifyVideosMultimodalBatch,
  type MultimodalVideoInput,
} from '@/lib/ai/classifier';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { channelTags?: Record<string, PrimaryGenreTag[]> } = {};
  try {
    body = (await request.json()) as {
      channelTags?: Record<string, PrimaryGenreTag[]>;
    };
  } catch {
    body = {};
  }

  const admin = createAdminClient();
  const currentWorkspace = await loadWorkspaceDataForUser(auth.userId);
  const activeChannels = currentWorkspace.channels.filter((c) => c.is_selected);

  if (activeChannels.length === 0) {
    return NextResponse.json({
      totalVideos: 0,
      updatedCount: 0,
      changedCount: 0,
      skippedManualCount: 0,
      aiScannedCount: 0,
      channels: currentWorkspace.channels,
      videos: currentWorkspace.videos,
      totalVideosCount: currentWorkspace.totalVideosCount,
      hasMoreVideos: currentWorkspace.hasMoreVideos,
    });
  }

  const resolvedChannelTags = new Map<string, PrimaryGenreTag[]>();
  let hasMultiTagChannel = false;

  for (const ch of activeChannels) {
    const incoming = (body.channelTags?.[ch.channel_id] ?? []).filter((t) =>
      PRIMARY_GENRE_OPTIONS.includes(t),
    );
    const effectiveTags = incoming.length > 0 ? incoming : ch.genre_tags;
    resolvedChannelTags.set(ch.channel_id, effectiveTags);
    if (effectiveTags.length >= 2) {
      hasMultiTagChannel = true;
    }
  }

  if (hasMultiTagChannel && !process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      {
        error:
          'Thiếu GEMINI_API_KEY trong .env.local. Vui lòng thêm khóa Gemini API và khởi động lại server.',
      },
      { status: 400 },
    );
  }

  let totalVideos = 0;
  let updatedCount = 0;
  let changedCount = 0;
  let skippedManualCount = 0;
  let aiScannedCount = 0;
  let geminiErrorCount = 0;
  let lastGeminiError: string | null = null;

  for (const channel of activeChannels) {
    const allowedTags = resolvedChannelTags.get(channel.channel_id) ?? ['HH2D'];

    // Tải video kèm cột is_manual_tag (có fallback nếu chưa chạy ALTER TABLE)
    let rows: Array<{
      video_id: string;
      title: string;
      description: string | null;
      thumbnail_url: string | null;
      duration_seconds: number;
      detected_genre: string | null;
      is_manual_tag?: boolean;
    }> = [];

    const resWithManual = await admin
      .from('videos')
      .select(
        'video_id, title, description, thumbnail_url, duration_seconds, detected_genre, is_manual_tag',
      )
      .eq('channel_id', channel.channel_id)
      .eq('is_short', false)
      .order('published_at', { ascending: false })
      .limit(100);

    if (resWithManual.error) {
      const resFallback = await admin
        .from('videos')
        .select(
          'video_id, title, description, thumbnail_url, duration_seconds, detected_genre',
        )
        .eq('channel_id', channel.channel_id)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .limit(100);
      rows = resFallback.data ?? [];
    } else {
      rows = resWithManual.data ?? [];
    }

    totalVideos += rows.length;
    if (rows.length === 0) continue;

    // Bỏ qua các video người dùng đã chỉnh tag thủ công (is_manual_tag = true)
    const eligibleRows = rows.filter((r) => !r.is_manual_tag);
    skippedManualCount += rows.length - eligibleRows.length;

    if (eligibleRows.length === 0) continue;

    // Kênh chỉ bật 1 tag -> gán cố định
    if (allowedTags.length === 1) {
      const targetGenre = allowedTags[0];
      const eligibleIds = eligibleRows.map((r) => r.video_id);

      const { error: updateErr } = await admin
        .from('videos')
        .update({ detected_genre: targetGenre })
        .in('video_id', eligibleIds);

      if (updateErr) {
        console.error(
          `[ReclassifyAll] Lỗi update 1-tag kênh ${channel.channel_id}:`,
          updateErr,
        );
      } else {
        updatedCount += eligibleRows.length;
        changedCount += eligibleRows.filter(
          (r) => r.detected_genre !== targetGenre,
        ).length;
      }
      continue;
    }

    // Kênh bật 2 tag -> 100% Gemini Vision xoay vòng model dự phòng
    const targets: MultimodalVideoInput[] = eligibleRows.map((v) => ({
      video_id: v.video_id,
      title: v.title,
      description: v.description,
      tags: [],
      thumbnail_url: v.thumbnail_url,
      vision_thumbnail_url: v.thumbnail_url,
      duration_seconds: v.duration_seconds,
    }));

    const outcome = await classifyVideosMultimodalBatch(targets, allowedTags);
    aiScannedCount += outcome.geminiSuccessCount;
    geminiErrorCount += outcome.geminiErrorCount;
    if (outcome.lastErrorMessage) {
      lastGeminiError = outcome.lastErrorMessage;
    }

    const oldGenreMap = new Map(
      eligibleRows.map((r) => [r.video_id, r.detected_genre]),
    );

    for (const video of targets) {
      const cls = outcome.results?.get(video.video_id);
      if (!cls || cls.source === 'fallback') continue;

      const { error: updateErr } = await admin
        .from('videos')
        .update({
          detected_genre: cls.detectedGenre,
          series_name: cls.seriesName,
          episode_number: cls.episodeNumber,
        })
        .eq('video_id', video.video_id);

      if (updateErr) {
        console.error(
          `[ReclassifyAll] Lỗi update video ${video.video_id}:`,
          updateErr,
        );
      } else {
        updatedCount += 1;
        if (oldGenreMap.get(video.video_id) !== cls.detectedGenre) {
          changedCount += 1;
        }
      }
    }
  }

  const refreshed = await loadWorkspaceDataForUser(auth.userId);

  // Nếu toàn bộ các lời gọi Gemini Vision đều lỗi và không cập nhật được gì -> trả lỗi rõ ràng để UI hiện Toast
  if (geminiErrorCount > 0 && aiScannedCount === 0 && updatedCount === 0) {
    return NextResponse.json(
      {
        error: `Gemini Vision lỗi (${geminiErrorCount} video): ${lastGeminiError || 'Vui lòng kiểm tra GEMINI_API_KEY hoặc hạn mức quota.'}`,
        channels: refreshed.channels,
        videos: refreshed.videos,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    totalVideos,
    updatedCount,
    changedCount,
    skippedManualCount,
    aiScannedCount,
    geminiErrorCount,
    warning:
      geminiErrorCount > 0 && lastGeminiError
        ? `Có ${geminiErrorCount} video gặp lỗi Gemini API: ${lastGeminiError}`
        : null,
    channels: refreshed.channels,
    videos: refreshed.videos,
    totalVideosCount: refreshed.totalVideosCount,
    hasMoreVideos: refreshed.hasMoreVideos,
  });
}
