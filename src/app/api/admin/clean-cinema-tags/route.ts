import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { hasEpisodeMarkerInTitle, isFullMovieTitle } from '@/lib/series-parser';
import {
  isHardExcludedFromTheatrical,
  isPotentialTheatricalCandidate,
} from '@/types/workspace';
import type { VideoType } from '@/types/database';

export const maxDuration = 30;

const PAGE_SIZE = 1000;

interface VideoCleanRow {
  video_id: string;
  title: string;
  series_name: string | null;
  detected_genre: string | null;
  episode_number: number | null;
  duration_seconds: number;
  video_type: VideoType | string | null;
  is_short: boolean;
}

/**
 * POST /api/admin/clean-cinema-tags
 * Gỡ bỏ toàn bộ nhãn/cờ `Chiếu Rạp` bị gắn nhầm trên bảng `public.videos`
 * (đặc biệt là các video `Phim AI`, video ghép 8-12 tiếng, video tổng hợp HH2D hoặc tập lẻ)
 * và trả lại đúng danh mục gốc (`episode` / `full_movie`).
 */
export async function POST() {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const admin = createAdminClient();
  const allRows: VideoCleanRow[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin
      .from('videos')
      .select(
        'video_id, title, series_name, detected_genre, episode_number, duration_seconds, video_type, is_short',
      )
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      return NextResponse.json(
        { error: `Không thể đọc danh sách video: ${error.message}` },
        { status: 500 },
      );
    }

    const batch = (data ?? []) as VideoCleanRow[];
    allRows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  let cleanedCount = 0;

  for (const row of allRows) {
    const hasLegacyCinemaSuffix =
      typeof row.series_name === 'string' &&
      (/\(Chiếu\s*Rạp\)/i.test(row.series_name) ||
        /\[CHIẾU\s*RẠP\]/i.test(row.series_name));
    const hasTheatricalVideoType = row.video_type === 'theatrical';

    const isExcluded =
      isHardExcludedFromTheatrical(row) ||
      !isPotentialTheatricalCandidate({
        title: row.title,
        series_name: row.series_name,
        detected_genre: row.detected_genre,
        episode_number: row.episode_number,
        video_type: row.video_type,
        is_short: row.is_short,
      });

    // Kiểm tra nếu video tập lẻ bị gán nhầm thành full_movie bởi heuristic cũ
    const isEpisodicMistaggedAsFull =
      row.video_type === 'full_movie' &&
      !isFullMovieTitle(row.title) &&
      (row.episode_number !== null || hasEpisodeMarkerInTitle(row.title)) &&
      row.duration_seconds < 3600;

    if (
      (hasLegacyCinemaSuffix && (isExcluded || /\(Chiếu\s*Rạp\)/i.test(row.series_name ?? ''))) ||
      hasTheatricalVideoType ||
      isEpisodicMistaggedAsFull
    ) {
      const cleanedSeriesName = row.series_name
        ? row.series_name
            .replace(/\s*\(Chiếu\s*Rạp\)\s*/gi, ' ')
            .replace(/\s*\[CHIẾU\s*RẠP\]\s*/gi, ' ')
            .trim() || null
        : null;

      let restoredVideoType: VideoType =
        row.video_type === 'episode' ||
        row.video_type === 'full_movie' ||
        row.video_type === 'trailer'
          ? row.video_type
          : 'episode';
      if (row.video_type === 'theatrical' || isEpisodicMistaggedAsFull) {
        restoredVideoType =
          isFullMovieTitle(row.title) || row.duration_seconds >= 2700
            ? 'full_movie'
            : 'episode';
      }

      const { error: updateErr } = await admin
        .from('videos')
        .update({
          series_name: cleanedSeriesName,
          video_type: restoredVideoType,
          is_theatrical_movie: false,
          theatrical_release_year: null,
        })
        .eq('video_id', row.video_id);

      if (updateErr) {
        const { error: fallbackErr } = await admin
          .from('videos')
          .update({
            series_name: cleanedSeriesName,
            video_type: restoredVideoType,
          })
          .eq('video_id', row.video_id);
        if (!fallbackErr) {
          cleanedCount += 1;
        }
      } else {
        cleanedCount += 1;
      }
    }
  }

  return NextResponse.json({
    cleaned: true,
    scannedCount: allRows.length,
    cleanedCount,
  });
}
