import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import {
  classifyVideosMultimodalBatch,
  type MultimodalVideoInput,
} from '@/lib/ai/classifier';
import { extractSeriesInfo } from '@/lib/series-parser';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

const PAGE_SIZE = 1000;
const UPDATE_CHUNK_SIZE = 200;

interface ReclassifyVideoRow {
  video_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number;
  detected_genre: string | null;
  series_name: string | null;
  is_manual_tag?: boolean;
}

async function fetchAllNonShortChannelVideos(
  admin: ReturnType<typeof createAdminClient>,
  channelId: string,
): Promise<ReclassifyVideoRow[]> {
  const allRows: ReclassifyVideoRow[] = [];
  let offset = 0;
  let supportsManualColumn = true;

  while (true) {
    if (supportsManualColumn) {
      const res = await admin
        .from('videos')
        .select(
          'video_id, title, description, thumbnail_url, duration_seconds, detected_genre, series_name, is_manual_tag',
        )
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (res.error) {
        supportsManualColumn = false;
        continue;
      }

      const batch = (res.data ?? []) as ReclassifyVideoRow[];
      allRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    } else {
      const res = await admin
        .from('videos')
        .select(
          'video_id, title, description, thumbnail_url, duration_seconds, detected_genre, series_name',
        )
        .eq('channel_id', channelId)
        .eq('is_short', false)
        .order('published_at', { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      const batch = (res.data ?? []) as ReclassifyVideoRow[];
      allRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  return allRows;
}

async function bulkUpdateGenreByIds(
  admin: ReturnType<typeof createAdminClient>,
  videoIds: string[],
  genre: PrimaryGenreTag,
  setManualTag = false,
): Promise<number> {
  let updated = 0;
  for (let i = 0; i < videoIds.length; i += UPDATE_CHUNK_SIZE) {
    const chunkIds = videoIds.slice(i, i + UPDATE_CHUNK_SIZE);
    const payload = setManualTag
      ? { detected_genre: genre, is_manual_tag: true }
      : { detected_genre: genre };

    const { error } = await admin
      .from('videos')
      .update(payload)
      .in('video_id', chunkIds);

    if (error && setManualTag) {
      const { error: fallbackErr } = await admin
        .from('videos')
        .update({ detected_genre: genre })
        .in('video_id', chunkIds);
      if (!fallbackErr) {
        updated += chunkIds.length;
      }
    } else if (!error) {
      updated += chunkIds.length;
    } else {
      console.error('[ReclassifyAll] Lỗi bulk update:', error);
    }
  }
  return updated;
}

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
      seriesScannedCount: 0,
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
  let seriesScannedCount = 0;
  let geminiErrorCount = 0;
  let lastGeminiError: string | null = null;

  for (const channel of activeChannels) {
    const allowedTags = resolvedChannelTags.get(channel.channel_id) ?? ['HH2D'];
    const rows = await fetchAllNonShortChannelVideos(admin, channel.channel_id);

    totalVideos += rows.length;
    if (rows.length === 0) continue;

    // Bỏ qua các video người dùng đã chỉnh tag thủ công (is_manual_tag = true)
    const manualRows = rows.filter((r) => Boolean(r.is_manual_tag));
    const eligibleRows = rows.filter((r) => !r.is_manual_tag);
    skippedManualCount += manualRows.length;

    if (eligibleRows.length === 0) continue;

    // Kênh chỉ bật 1 tag -> gán thẳng 100% (0 API call)
    if (allowedTags.length === 1) {
      const targetGenre = allowedTags[0];
      const eligibleIds = eligibleRows.map((r) => r.video_id);
      const count = await bulkUpdateGenreByIds(admin, eligibleIds, targetGenre);
      updatedCount += count;
      changedCount += eligibleRows.filter(
        (r) => r.detected_genre !== targetGenre,
      ).length;
      continue;
    }

    // Kênh bật >= 2 tag:
    // 1. Kế thừa tag từ các tập cùng Series đã được người dùng khóa tay (is_manual_tag = true)
    const manualSeriesGenreMap = new Map<string, PrimaryGenreTag>();
    for (const m of manualRows) {
      const genre =
        m.detected_genre === 'Phim AI' || m.detected_genre === 'HH2D'
          ? (m.detected_genre as PrimaryGenreTag)
          : null;
      if (!genre || !allowedTags.includes(genre)) continue;

      const info = extractSeriesInfo({
        videoId: m.video_id,
        channelId: channel.channel_id,
        title: m.title,
        channelTitle: channel.title,
        seriesName: m.series_name,
      });
      if (!info.isStandalone && !manualSeriesGenreMap.has(info.seriesKey)) {
        manualSeriesGenreMap.set(info.seriesKey, genre);
      }
    }

    const inheritedManualByGenre = new Map<PrimaryGenreTag, string[]>();
    const targetsForAi: MultimodalVideoInput[] = [];
    const oldGenreMap = new Map<string, string | null>();

    for (const v of eligibleRows) {
      oldGenreMap.set(v.video_id, v.detected_genre);

      const info = extractSeriesInfo({
        videoId: v.video_id,
        channelId: channel.channel_id,
        title: v.title,
        channelTitle: channel.title,
        seriesName: v.series_name,
      });

      const inheritedManualGenre = !info.isStandalone
        ? manualSeriesGenreMap.get(info.seriesKey)
        : undefined;

      if (inheritedManualGenre) {
        const list = inheritedManualByGenre.get(inheritedManualGenre) ?? [];
        list.push(v.video_id);
        inheritedManualByGenre.set(inheritedManualGenre, list);
      } else {
        targetsForAi.push({
          video_id: v.video_id,
          channel_id: channel.channel_id,
          channel_title: channel.title,
          title: v.title,
          description: v.description,
          tags: [],
          thumbnail_url: v.thumbnail_url,
          vision_thumbnail_url: v.thumbnail_url,
          series_name: v.series_name,
          duration_seconds: v.duration_seconds,
        });
      }
    }

    for (const [genre, ids] of inheritedManualByGenre.entries()) {
      const count = await bulkUpdateGenreByIds(admin, ids, genre, true);
      updatedCount += count;
      changedCount += ids.filter((id) => oldGenreMap.get(id) !== genre).length;
    }

    if (targetsForAi.length === 0) continue;

    // 2. Quét Gemini Vision theo cơ chế 1 đại diện / 1 Series (4 series / batch, xoay vòng 3 model)
    const outcome = await classifyVideosMultimodalBatch(
      targetsForAi,
      allowedTags,
    );
    aiScannedCount += outcome.geminiSuccessCount;
    seriesScannedCount += outcome.seriesScannedCount;
    geminiErrorCount += outcome.geminiErrorCount;
    if (outcome.lastErrorMessage) {
      lastGeminiError = outcome.lastErrorMessage;
    }

    // Gom theo detectedGenre để bulk update siêu nhanh
    const idsByGenre = new Map<PrimaryGenreTag, string[]>();
    for (const video of targetsForAi) {
      const cls = outcome.results?.get(video.video_id);
      if (!cls || cls.source === 'fallback') continue;

      const list = idsByGenre.get(cls.detectedGenre) ?? [];
      list.push(video.video_id);
      idsByGenre.set(cls.detectedGenre, list);
    }

    for (const [genre, ids] of idsByGenre.entries()) {
      const count = await bulkUpdateGenreByIds(admin, ids, genre);
      updatedCount += count;
      changedCount += ids.filter((id) => oldGenreMap.get(id) !== genre).length;
    }
  }

  const refreshed = await loadWorkspaceDataForUser(auth.userId);

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
    seriesScannedCount,
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
