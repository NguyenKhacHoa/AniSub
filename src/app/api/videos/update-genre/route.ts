import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { extractSeriesInfo } from '@/lib/series-parser';
import {
  PRIMARY_GENRE_OPTIONS,
  mapGenreToDefaultCategory,
  type PrimaryGenreTag,
} from '@/types/workspace';

const UPDATE_CHUNK_SIZE = 200;

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    videoId?: string;
    detectedGenre?: PrimaryGenreTag;
    applyToChannel?: boolean;
  };
  try {
    body = (await request.json()) as {
      videoId?: string;
      detectedGenre?: PrimaryGenreTag;
      applyToChannel?: boolean;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  const detectedGenre = body.detectedGenre;
  const applyToChannel = body.applyToChannel === true;

  if (
    !videoId ||
    !detectedGenre ||
    !PRIMARY_GENRE_OPTIONS.includes(detectedGenre)
  ) {
    return NextResponse.json(
      { error: 'Thiếu videoId hoặc thể loại không hợp lệ.' },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // 1. Lấy thông tin video gốc để xác định kênh và seriesKey
  const { data: targetVideo, error: targetErr } = await admin
    .from('videos')
    .select('video_id, channel_id, title, series_name')
    .eq('video_id', videoId)
    .maybeSingle();

  if (targetErr || !targetVideo) {
    return NextResponse.json(
      { error: 'Không tìm thấy video cần cập nhật.' },
      { status: 404 },
    );
  }

  const { data: channelRow } = await admin
    .from('channels')
    .select('title')
    .eq('channel_id', targetVideo.channel_id)
    .maybeSingle();

  const channelTitle = channelRow?.title ?? undefined;

  const targetSeriesInfo = extractSeriesInfo({
    videoId: targetVideo.video_id,
    channelId: targetVideo.channel_id,
    title: targetVideo.title,
    channelTitle,
    seriesName: targetVideo.series_name,
  });

  // 2. Tìm toàn bộ các tập khác cùng channel_id và cùng seriesKey để lan truyền tag
  const matchedIdsSet = new Set<string>([videoId]);

  if (!targetSeriesInfo.isStandalone) {
    let from = 0;
    while (true) {
      const { data: channelVideos, error: pageErr } = await admin
        .from('videos')
        .select('video_id, title, series_name')
        .eq('channel_id', targetVideo.channel_id)
        .range(from, from + 999);
      if (pageErr || !channelVideos || channelVideos.length === 0) break;

      for (const candidate of channelVideos) {
        const candidateInfo = extractSeriesInfo({
          videoId: candidate.video_id,
          channelId: targetVideo.channel_id,
          title: candidate.title,
          channelTitle,
          seriesName: candidate.series_name,
        });

        if (candidateInfo.seriesKey === targetSeriesInfo.seriesKey) {
          matchedIdsSet.add(candidate.video_id);
        }
      }
      if (channelVideos.length < 1000) break;
      from += 1000;
    }
  }

  const matchedVideoIds = Array.from(matchedIdsSet);
  let warning: string | null = null;

  // 3. Cập nhật đồng loạt detected_genre + is_manual_tag = true theo từng chunk 200 ID
  for (let i = 0; i < matchedVideoIds.length; i += UPDATE_CHUNK_SIZE) {
    const chunkIds = matchedVideoIds.slice(i, i + UPDATE_CHUNK_SIZE);

    const { error } = await admin
      .from('videos')
      .update({
        detected_genre: detectedGenre,
        is_manual_tag: true,
      })
      .in('video_id', chunkIds);

    if (error) {
      // Fallback tương thích ngược nếu chưa chạy SQL thêm cột is_manual_tag
      const { error: fallbackErr } = await admin
        .from('videos')
        .update({ detected_genre: detectedGenre })
        .in('video_id', chunkIds);

      if (fallbackErr) {
        console.error('[UpdateGenre] Lỗi cập nhật videos:', fallbackErr);
        return NextResponse.json(
          { error: 'Không thể lưu thể loại mới cho bộ phim.' },
          { status: 500 },
        );
      }

      warning =
        'Đã đổi tag cho bộ phim, nhưng hãy chạy SQL thêm cột is_manual_tag trong docs/03-DATABASE.md để khóa tag khi quét AI lại.';
    }
  }

  // 4. Smart Learn on Manual Fix: Nếu người dùng chọn áp dụng làm mặc định cho cả kênh
  let channelUpdatedCount = 0;
  if (applyToChannel) {
    const nextDefaultCat = mapGenreToDefaultCategory(detectedGenre);
    await admin
      .from('channels')
      .update({
        default_category: nextDefaultCat,
        updated_at: new Date().toISOString(),
      })
      .eq('channel_id', targetVideo.channel_id);

    await admin
      .from('user_channels')
      .update({
        genre_tag: detectedGenre,
        genre_tags: [detectedGenre],
      })
      .eq('user_id', auth.userId)
      .eq('channel_id', targetVideo.channel_id);

    const { data: chVids } = await admin
      .from('videos')
      .select('video_id, is_manual_tag')
      .eq('channel_id', targetVideo.channel_id)
      .eq('is_short', false)
      .limit(3000);

    const chTargetIds = (chVids ?? [])
      .filter((v) => !v.is_manual_tag && !matchedIdsSet.has(v.video_id))
      .map((v) => v.video_id);

    for (let i = 0; i < chTargetIds.length; i += UPDATE_CHUNK_SIZE) {
      const chunkIds = chTargetIds.slice(i, i + UPDATE_CHUNK_SIZE);
      const { error } = await admin
        .from('videos')
        .update({ detected_genre: detectedGenre })
        .in('video_id', chunkIds);
      if (!error) {
        channelUpdatedCount += chunkIds.length;
      }
    }
  }

  return NextResponse.json({
    videoId,
    channelId: targetVideo.channel_id,
    detectedGenre,
    isManualTag: true,
    updatedVideoIds: matchedVideoIds,
    propagatedCount: matchedVideoIds.length,
    channelUpdatedCount,
    appliedToChannel: applyToChannel,
    seriesTitle: targetSeriesInfo.seriesTitle,
    warning,
  });
}
