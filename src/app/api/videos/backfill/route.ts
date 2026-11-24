import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { fetchVideoDetailsByIds } from '@/lib/youtube/api';
import {
  computeChannelHotnessBaselines,
  computeVideoHotness,
} from '@/types/workspace';

export const maxDuration = 30;

const DEFAULT_BATCH_SIZE = 250; // 5 request videos.list x 50 ID mỗi lượt
const MAX_BATCH_SIZE = 250;
const DB_FETCH_PAGE_SIZE = 1000;

interface BackfillCandidateRow {
  video_id: string;
  channel_id: string;
  published_at: string;
  view_count: number | null;
  insight_data?: { overallScore?: number } | null;
}

/**
 * POST /api/videos/backfill
 * Nạp bù `view_count`, `like_count`, `comment_count`, `published_at` và chấm điểm `hot_badge` / `hot_score`
 * cho toàn bộ kho video cũ đang thiếu lượt xem (`view_count IS NULL` hoặc `= 0`) theo từng batch 250 video/lượt.
 */
export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!process.env.YOUTUBE_API_KEY?.trim()) {
    return NextResponse.json(
      { error: 'Thiếu YOUTUBE_API_KEY trong .env.local.' },
      { status: 400 },
    );
  }

  let body: {
    channelId?: string;
    batchSize?: number;
    excludeIds?: string[];
  } = {};
  try {
    body = (await request.json()) as {
      channelId?: string;
      batchSize?: number;
      excludeIds?: string[];
    };
  } catch {
    body = {};
  }

  const batchSize = Math.min(
    MAX_BATCH_SIZE,
    Math.max(50, Number(body.batchSize) || DEFAULT_BATCH_SIZE),
  );
  const excludeSet = new Set(
    Array.isArray(body.excludeIds)
      ? body.excludeIds.filter((id): id is string => typeof id === 'string')
      : [],
  );

  const admin = createAdminClient();

  // Xác định phạm vi kênh cần nạp bù (1 kênh cụ thể hoặc toàn bộ kênh đang bật của user)
  let targetChannelIds: string[] = [];
  if (typeof body.channelId === 'string' && body.channelId.trim()) {
    targetChannelIds = [body.channelId.trim()];
  } else {
    const { data: userChRows } = await admin
      .from('user_channels')
      .select('channel_id')
      .eq('user_id', auth.userId)
      .eq('is_selected', true);
    targetChannelIds = (userChRows ?? []).map((r) => r.channel_id);
  }

  // Quét toàn bộ video đang thiếu view_count (IS NULL hoặc = 0) vượt mốc 1.000 dòng PostgREST
  const allMissing: BackfillCandidateRow[] = [];
  let from = 0;
  let supportsInsightCol = true;

  while (true) {
    const to = from + DB_FETCH_PAGE_SIZE - 1;
    const cols = supportsInsightCol
      ? 'video_id, channel_id, published_at, view_count, insight_data'
      : 'video_id, channel_id, published_at, view_count';

    let query = admin
      .from('videos')
      .select(cols)
      .eq('is_short', false)
      .or('view_count.is.null,view_count.eq.0')
      .order('published_at', { ascending: false })
      .range(from, to);

    if (targetChannelIds.length > 0) {
      query = query.in('channel_id', targetChannelIds);
    }

    const res = await query;
    if (res.error) {
      const msg = res.error.message || '';
      if (supportsInsightCol && /insight_data/i.test(msg)) {
        supportsInsightCol = false;
        continue;
      }
      if (/view_count|hot_badge|hot_score/i.test(msg)) {
        return NextResponse.json(
          {
            error:
              'Bảng public.videos chưa có các cột view_count / hot_badge / hot_score. Vui lòng chạy câu lệnh ALTER TABLE trong Supabase SQL Editor trước.',
            migrationRequired: true,
          },
          { status: 400 },
        );
      }
      console.error('[POST /api/videos/backfill] Lỗi truy vấn videos:', res.error);
      return NextResponse.json(
        { error: 'Không thể truy vấn danh sách video cần nạp bù thống kê.' },
        { status: 500 },
      );
    }

    const pageRows = (res.data ?? []) as unknown as BackfillCandidateRow[];
    allMissing.push(...pageRows);
    if (pageRows.length < DB_FETCH_PAGE_SIZE) break;
    from += DB_FETCH_PAGE_SIZE;
  }

  // Bổ sung thêm các Phim Chiếu Rạp (từ kênh ngoài danh sách đăng ký) nếu không lọc 1 kênh cụ thể
  if (!body.channelId) {
    const seenIds = new Set(allMissing.map((r) => r.video_id));
    const theatricalRes = await admin
      .from('videos')
      .select('video_id, channel_id, published_at, view_count')
      .eq('is_theatrical_movie', true)
      .or('view_count.is.null,view_count.eq.0')
      .order('published_at', { ascending: false })
      .range(0, 999);
    if (!theatricalRes.error && Array.isArray(theatricalRes.data)) {
      for (const row of theatricalRes.data as unknown as BackfillCandidateRow[]) {
        if (!seenIds.has(row.video_id)) {
          seenIds.add(row.video_id);
          allMissing.push(row);
        }
      }
    }
  }

  const pendingRows = allMissing.filter((r) => !excludeSet.has(r.video_id));
  if (pendingRows.length === 0) {
    return NextResponse.json({
      processedCount: 0,
      updatedCount: 0,
      remainingCount: 0,
      hasMore: false,
      hotCount: 0,
      worthWatchingCount: 0,
      processedIds: [],
    });
  }

  const currentBatch = pendingRows.slice(0, batchSize);
  const batchIds = currentBatch.map((r) => r.video_id);
  const candidateById = new Map(currentBatch.map((r) => [r.video_id, r]));

  // Gọi YouTube Data API videos.list (50 ID / request -> tối đa 5 request cho 250 video)
  const fetchedDetails = await fetchVideoDetailsByIds(
    batchIds,
    currentBatch[0]?.channel_id ?? '',
  );
  const fetchedById = new Map(fetchedDetails.map((v) => [v.video_id, v]));

  // Lấy mẫu view hiện có của các kênh trong batch để tính mặt bằng kênh chính xác
  const affectedChannelIds = Array.from(
    new Set(currentBatch.map((r) => r.channel_id)),
  );
  const samplePool: Array<{
    channel_id: string;
    published_at: string;
    view_count?: number | null;
  }> = fetchedDetails.map((v) => ({
    channel_id: v.channel_id,
    published_at: v.published_at,
    view_count: v.view_count,
  }));

  if (affectedChannelIds.length > 0) {
    const dbStatsRes = await admin
      .from('videos')
      .select('channel_id, published_at, view_count')
      .in('channel_id', affectedChannelIds)
      .gt('view_count', 0)
      .order('published_at', { ascending: false })
      .limit(1000);
    if (!dbStatsRes.error && Array.isArray(dbStatsRes.data)) {
      for (const row of dbStatsRes.data) {
        samplePool.push({
          channel_id: row.channel_id,
          published_at: row.published_at,
          view_count: row.view_count,
        });
      }
    }
  }

  const nowMs = Date.now();
  const baselines = computeChannelHotnessBaselines(samplePool, nowMs);

  let updatedCount = 0;
  let hotCount = 0;
  let worthWatchingCount = 0;
  const unavailableIds: string[] = [];

  // Cập nhật song song theo nhóm nhỏ 25 để đảm bảo tốc độ cao và không quá tải kết nối DB
  const UPDATE_CONCURRENCY = 25;
  for (let i = 0; i < currentBatch.length; i += UPDATE_CONCURRENCY) {
    const slice = currentBatch.slice(i, i + UPDATE_CONCURRENCY);
    await Promise.all(
      slice.map(async (row) => {
        const yt = fetchedById.get(row.video_id);
        if (!yt) {
          unavailableIds.push(row.video_id);
          return;
        }

        const aiScore =
          typeof candidateById.get(row.video_id)?.insight_data?.overallScore ===
          'number'
            ? candidateById.get(row.video_id)!.insight_data!.overallScore!
            : null;

        const hot = computeVideoHotness(
          {
            published_at: yt.published_at,
            view_count: yt.view_count,
            like_count: yt.like_count,
            comment_count: yt.comment_count,
            ai_overall_score: aiScore,
          },
          baselines.get(yt.channel_id),
          nowMs,
        );

        if (hot.hot_badge === 'Phim Hot') hotCount += 1;
        else if (hot.hot_badge === 'Đáng xem') worthWatchingCount += 1;

        const { error } = await admin
          .from('videos')
          .update({
            published_at: yt.published_at,
            thumbnail_url: yt.thumbnail_url,
            view_count: yt.view_count,
            like_count: yt.like_count,
            comment_count: yt.comment_count,
            hot_badge: hot.hot_badge,
            hot_score: hot.hot_score,
          } as never)
          .eq('video_id', row.video_id);

        if (!error) {
          updatedCount += 1;
        }
      }),
    );
  }

  // Nếu video không còn tồn tại trên YouTube (đã xóa/ẩn), đánh dấu is_unavailable = true
  if (unavailableIds.length > 0) {
    await admin
      .from('videos')
      .update({ is_unavailable: true } as never)
      .in('video_id', unavailableIds);
  }

  const remainingCount = Math.max(0, pendingRows.length - currentBatch.length);

  return NextResponse.json({
    processedCount: currentBatch.length,
    updatedCount,
    unavailableCount: unavailableIds.length,
    remainingCount,
    hasMore: remainingCount > 0,
    hotCount,
    worthWatchingCount,
    processedIds: batchIds,
  });
}
