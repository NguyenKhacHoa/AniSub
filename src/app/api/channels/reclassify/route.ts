import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { fetchChannelLatestVideos } from '@/lib/youtube/api';
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

interface ChannelVideoRow {
  video_id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  duration_seconds: number;
  detected_genre: string | null;
  series_name: string | null;
  is_manual_tag?: boolean;
}

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { channelId?: string; genreTags?: PrimaryGenreTag[] };
  try {
    body = (await request.json()) as {
      channelId?: string;
      genreTags?: PrimaryGenreTag[];
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const channelId = body.channelId?.trim();
  if (!channelId) {
    return NextResponse.json({ error: 'Thiếu channelId.' }, { status: 400 });
  }

  const admin = createAdminClient();

  let allowedTags: PrimaryGenreTag[] = (body.genreTags ?? []).filter((t) =>
    PRIMARY_GENRE_OPTIONS.includes(t),
  );

  if (allowedTags.length === 0) {
    const { data: uc } = await admin
      .from('user_channels')
      .select('genre_tag, genre_tags')
      .eq('user_id', auth.userId)
      .eq('channel_id', channelId)
      .maybeSingle();

    const dbTags = (uc?.genre_tags ?? []).filter((t): t is PrimaryGenreTag =>
      PRIMARY_GENRE_OPTIONS.includes(t as PrimaryGenreTag),
    );
    if (dbTags.length > 0) {
      allowedTags = dbTags;
    } else if (
      uc?.genre_tag &&
      PRIMARY_GENRE_OPTIONS.includes(uc.genre_tag as PrimaryGenreTag)
    ) {
      allowedTags = [uc.genre_tag as PrimaryGenreTag];
    } else {
      allowedTags = ['HH2D'];
    }
  }

  const { data: channelRow } = await admin
    .from('channels')
    .select('title')
    .eq('channel_id', channelId)
    .maybeSingle();
  const channelTitle = channelRow?.title ?? undefined;

  // Tải toàn bộ video không phải Shorts của kênh
  const allRows: ChannelVideoRow[] = [];
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

      const batch = (res.data ?? []) as ChannelVideoRow[];
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

      const batch = (res.data ?? []) as ChannelVideoRow[];
      allRows.push(...batch);
      if (batch.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
  }

  const manualRows = allRows.filter((v) => Boolean(v.is_manual_tag));
  const eligibleVideos = allRows.filter((v) => !v.is_manual_tag);

  if (eligibleVideos.length === 0) {
    const workspaceData = await loadWorkspaceDataForUser(auth.userId);
    return NextResponse.json({
      reclassifiedCount: 0,
      channels: workspaceData.channels,
      videos: workspaceData.videos,
      totalVideosCount: workspaceData.totalVideosCount,
      hasMoreVideos: workspaceData.hasMoreVideos,
    });
  }

  // Nếu kênh chỉ bật 1 tag -> gán thẳng
  if (allowedTags.length === 1) {
    const fixedGenre = allowedTags[0];
    const ids = eligibleVideos.map((v) => v.video_id);
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
      await admin
        .from('videos')
        .update({ detected_genre: fixedGenre })
        .in('video_id', ids.slice(i, i + UPDATE_CHUNK_SIZE));
    }

    const workspaceData = await loadWorkspaceDataForUser(auth.userId);
    return NextResponse.json({
      reclassifiedCount: eligibleVideos.length,
      channels: workspaceData.channels,
      videos: workspaceData.videos,
      totalVideosCount: workspaceData.totalVideosCount,
      hasMoreVideos: workspaceData.hasMoreVideos,
    });
  }

  if (!process.env.GEMINI_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu GEMINI_API_KEY trong .env.local.' },
      { status: 400 },
    );
  }

  // Thử lấy thêm snippet.tags mới nhất từ YouTube (nếu có YOUTUBE_API_KEY)
  const ytTagsByVideoId = new Map<
    string,
    { tags: string[]; visionThumb: string | null }
  >();
  if (process.env.YOUTUBE_API_KEY?.trim()) {
    try {
      const freshYt = await fetchChannelLatestVideos(channelId, 50);
      for (const v of freshYt) {
        ytTagsByVideoId.set(v.video_id, {
          tags: v.tags,
          visionThumb: v.vision_thumbnail_url,
        });
      }
    } catch {
      // Bỏ qua nếu YouTube hết quota
    }
  }

  // Kế thừa các bộ phim đã được khóa thủ công
  const manualSeriesGenreMap = new Map<string, PrimaryGenreTag>();
  for (const m of manualRows) {
    const genre =
      m.detected_genre === 'Phim AI' || m.detected_genre === 'HH2D'
        ? (m.detected_genre as PrimaryGenreTag)
        : null;
    if (!genre || !allowedTags.includes(genre)) continue;
    const info = extractSeriesInfo({
      videoId: m.video_id,
      channelId,
      title: m.title,
      channelTitle,
      seriesName: m.series_name,
    });
    if (!info.isStandalone && !manualSeriesGenreMap.has(info.seriesKey)) {
      manualSeriesGenreMap.set(info.seriesKey, genre);
    }
  }

  const inheritedByGenre = new Map<PrimaryGenreTag, string[]>();
  const targets: MultimodalVideoInput[] = [];

  for (const v of eligibleVideos) {
    const info = extractSeriesInfo({
      videoId: v.video_id,
      channelId,
      title: v.title,
      channelTitle,
      seriesName: v.series_name,
    });
    const inherited = !info.isStandalone
      ? manualSeriesGenreMap.get(info.seriesKey)
      : undefined;

    if (inherited) {
      const list = inheritedByGenre.get(inherited) ?? [];
      list.push(v.video_id);
      inheritedByGenre.set(inherited, list);
      continue;
    }

    const extra = ytTagsByVideoId.get(v.video_id);
    targets.push({
      video_id: v.video_id,
      channel_id: channelId,
      channel_title: channelTitle,
      title: v.title,
      description: v.description,
      tags: extra?.tags ?? [],
      thumbnail_url: v.thumbnail_url,
      vision_thumbnail_url: extra?.visionThumb ?? v.thumbnail_url,
      series_name: v.series_name,
      duration_seconds: v.duration_seconds,
    });
  }

  let reclassifiedCount = 0;
  for (const [genre, ids] of inheritedByGenre.entries()) {
    for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + UPDATE_CHUNK_SIZE);
      const { error } = await admin
        .from('videos')
        .update({ detected_genre: genre, is_manual_tag: true })
        .in('video_id', chunk);
      if (error) {
        await admin
          .from('videos')
          .update({ detected_genre: genre })
          .in('video_id', chunk);
      }
      reclassifiedCount += chunk.length;
    }
  }

  if (targets.length > 0) {
    const outcome = await classifyVideosMultimodalBatch(targets, allowedTags);

    if (
      outcome.geminiErrorCount > 0 &&
      outcome.geminiSuccessCount === 0 &&
      reclassifiedCount === 0
    ) {
      return NextResponse.json(
        {
          error: `Gemini Vision lỗi: ${outcome.lastErrorMessage || 'Không thể phân loại video.'}`,
        },
        { status: 502 },
      );
    }

    const idsByGenre = new Map<PrimaryGenreTag, string[]>();
    for (const video of targets) {
      const cls = outcome.results?.get(video.video_id);
      if (!cls || cls.source === 'fallback') continue;
      const list = idsByGenre.get(cls.detectedGenre) ?? [];
      list.push(video.video_id);
      idsByGenre.set(cls.detectedGenre, list);
    }

    for (const [genre, ids] of idsByGenre.entries()) {
      for (let i = 0; i < ids.length; i += UPDATE_CHUNK_SIZE) {
        const chunk = ids.slice(i, i + UPDATE_CHUNK_SIZE);
        const { error: updateErr } = await admin
          .from('videos')
          .update({ detected_genre: genre })
          .in('video_id', chunk);
        if (updateErr) {
          console.error('[ReclassifyChannel] Lỗi bulk update:', updateErr);
        } else {
          reclassifiedCount += chunk.length;
        }
      }
    }
  }

  const workspaceData = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    reclassifiedCount,
    channels: workspaceData.channels,
    videos: workspaceData.videos,
    totalVideosCount: workspaceData.totalVideosCount,
    hasMoreVideos: workspaceData.hasMoreVideos,
  });
}
