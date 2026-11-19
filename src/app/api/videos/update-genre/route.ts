import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { extractSeriesInfo } from '@/lib/series-parser';
import {
  PRIMARY_GENRE_OPTIONS,
  type PrimaryGenreTag,
} from '@/types/workspace';

const UPDATE_CHUNK_SIZE = 200;

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: { videoId?: string; detectedGenre?: PrimaryGenreTag };
  try {
    body = (await request.json()) as {
      videoId?: string;
      detectedGenre?: PrimaryGenreTag;
    };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const videoId = body.videoId?.trim();
  const detectedGenre = body.detectedGenre;

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
    const { data: channelVideos } = await admin
      .from('videos')
      .select('video_id, title, series_name')
      .eq('channel_id', targetVideo.channel_id)
      .limit(2500);

    for (const candidate of channelVideos ?? []) {
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

  return NextResponse.json({
    videoId,
    detectedGenre,
    isManualTag: true,
    updatedVideoIds: matchedVideoIds,
    propagatedCount: matchedVideoIds.length,
    seriesTitle: targetSeriesInfo.seriesTitle,
    warning,
  });
}
