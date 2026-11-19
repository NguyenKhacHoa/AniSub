import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { verifyWhitelistedUser } from '@/lib/auth/whitelist';
import { syncAllChannelVideos } from '@/lib/youtube/channel-sync';
import { loadWorkspaceDataForUser } from '@/lib/workspace/loader';
import { PRIMARY_GENRE_OPTIONS, type PrimaryGenreTag } from '@/types/workspace';

export const maxDuration = 60;

interface ResolvedYouTubeChannel {
  channelId: string;
  title: string;
  thumbnailUrl: string | null;
  customUrl: string | null;
}

/**
 * Phân giải @handle, URL kênh YouTube (`https://www.youtube.com/@MuseVietNam`), hoặc `UC...` Channel ID
 * thành thông tin kênh thật 100% từ YouTube Data API v3.
 */
async function resolveYouTubeChannelIdentifier(
  rawInput: string,
  fallbackTitle?: string,
  fallbackThumb?: string | null,
): Promise<ResolvedYouTubeChannel | null> {
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  const trimmed = rawInput.trim();
  if (!trimmed) return null;

  let candidateId: string | null = null;
  let candidateHandle: string | null = null;

  // 1. Kiểm tra nếu là URL YouTube
  if (/^https?:\/\//i.test(trimmed) || /youtube\.com\//i.test(trimmed)) {
    const channelMatch = trimmed.match(/\/channel\/(UC[\w-]{20,28})/i);
    if (channelMatch?.[1]) {
      candidateId = channelMatch[1];
    } else {
      const handleMatch = trimmed.match(/\/@([\w.-]+)/i);
      if (handleMatch?.[1]) {
        candidateHandle = `@${handleMatch[1]}`;
      } else {
        const customMatch = trimmed.match(/\/(?:c|user)\/([\w.-]+)/i);
        if (customMatch?.[1]) {
          candidateHandle = customMatch[1];
        }
      }
    }
  } else if (/^UC[\w-]{22}$/.test(trimmed)) {
    candidateId = trimmed;
  } else if (trimmed.startsWith('@')) {
    candidateHandle = trimmed;
  } else {
    candidateHandle = `@${trimmed}`;
  }

  if (!apiKey) {
    if (candidateId) {
      return {
        channelId: candidateId,
        title: fallbackTitle || candidateId,
        thumbnailUrl: fallbackThumb ?? null,
        customUrl: candidateHandle,
      };
    }
    return null;
  }

  const parseChannelItem = (item?: {
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: {
        high?: { url?: string };
        medium?: { url?: string };
        default?: { url?: string };
      };
    };
  }): ResolvedYouTubeChannel | null => {
    if (!item?.id) return null;
    const snip = item.snippet;
    return {
      channelId: item.id,
      title: snip?.title || fallbackTitle || item.id,
      thumbnailUrl:
        snip?.thumbnails?.high?.url ||
        snip?.thumbnails?.medium?.url ||
        snip?.thumbnails?.default?.url ||
        fallbackThumb ||
        null,
      customUrl: snip?.customUrl || candidateHandle || null,
    };
  };

  // Cách 1: Tra cứu trực tiếp theo channelId (`id=UC...`)
  if (candidateId) {
    try {
      const url = new URL('https://www.googleapis.com/youtube/v3/channels');
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('id', candidateId);
      url.searchParams.set('key', apiKey);
      const res = await fetch(url.toString(), { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          items?: Array<Parameters<typeof parseChannelItem>[0]>;
        };
        const resolved = parseChannelItem(data.items?.[0]);
        if (resolved) return resolved;
      }
    } catch {
      // Fallback bên dưới
    }
    return {
      channelId: candidateId,
      title: fallbackTitle || candidateId,
      thumbnailUrl: fallbackThumb ?? null,
      customUrl: candidateHandle,
    };
  }

  // Cách 2: Tra cứu theo `forHandle=@Handle` trên YouTube Data API v3
  if (candidateHandle) {
    for (const handleVariant of [
      candidateHandle,
      candidateHandle.replace(/^@/, ''),
    ]) {
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/channels');
        url.searchParams.set('part', 'snippet');
        url.searchParams.set('forHandle', handleVariant);
        url.searchParams.set('key', apiKey);
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            items?: Array<Parameters<typeof parseChannelItem>[0]>;
          };
          const resolved = parseChannelItem(data.items?.[0]);
          if (resolved) return resolved;
        }
      } catch {
        // Thử tiếp fallback search
      }
    }
  }

  // Cách 3: Fallback tìm kiếm kênh qua `search.list?type=channel`
  try {
    const queryStr = (candidateHandle || trimmed).replace(/^@/, '');
    const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
    searchUrl.searchParams.set('part', 'snippet');
    searchUrl.searchParams.set('type', 'channel');
    searchUrl.searchParams.set('maxResults', '1');
    searchUrl.searchParams.set('q', queryStr);
    searchUrl.searchParams.set('key', apiKey);
    const searchRes = await fetch(searchUrl.toString(), { cache: 'no-store' });
    if (searchRes.ok) {
      const searchData = (await searchRes.json().catch(() => ({}))) as {
        items?: Array<{
          id?: { channelId?: string };
          snippet?: {
            channelId?: string;
            title?: string;
            thumbnails?: {
              high?: { url?: string };
              medium?: { url?: string };
              default?: { url?: string };
            };
          };
        }>;
      };
      const first = searchData.items?.[0];
      const foundId = first?.id?.channelId || first?.snippet?.channelId;
      if (foundId) {
        return {
          channelId: foundId,
          title: first?.snippet?.title || fallbackTitle || foundId,
          thumbnailUrl:
            first?.snippet?.thumbnails?.high?.url ||
            first?.snippet?.thumbnails?.medium?.url ||
            first?.snippet?.thumbnails?.default?.url ||
            fallbackThumb ||
            null,
          customUrl: candidateHandle,
        };
      }
    }
  } catch {
    // Ignore
  }

  return null;
}

export async function POST(request: Request) {
  const auth = await verifyWhitelistedUser();
  if (!auth.allowed || !auth.userId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let body: {
    channelId?: string;
    handleOrUrl?: string;
    channelTitle?: string;
    channelThumbnail?: string | null;
    genreTags?: PrimaryGenreTag[];
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rawIdentifier = (body.handleOrUrl || body.channelId || '').trim();
  if (!rawIdentifier) {
    return NextResponse.json(
      { error: 'Thiếu channelId hoặc @handle kênh YouTube.' },
      { status: 400 },
    );
  }

  const resolvedChannel = await resolveYouTubeChannelIdentifier(
    rawIdentifier,
    body.channelTitle?.trim(),
    body.channelThumbnail,
  );

  if (!resolvedChannel) {
    return NextResponse.json(
      {
        error: `Không tìm thấy kênh YouTube khớp với "${rawIdentifier}". Vui lòng kiểm tra lại @handle hoặc URL kênh.`,
      },
      { status: 404 },
    );
  }

  const channelId = resolvedChannel.channelId;
  let resolvedTitle = resolvedChannel.title;
  let resolvedThumb = resolvedChannel.thumbnailUrl;
  const resolvedCustomUrl = resolvedChannel.customUrl;

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const cookieStore = await cookies();
  const providerToken =
    session?.provider_token || cookieStore.get('anisub_yt_token')?.value;

  // 1. Nếu có Google OAuth providerToken còn hạn, đồng thời đăng ký kênh trực tiếp lên tài khoản YouTube của user
  if (providerToken) {
    try {
      const subRes = await fetch(
        'https://www.googleapis.com/youtube/v3/subscriptions?part=snippet',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${providerToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            snippet: {
              resourceId: {
                kind: 'youtube#channel',
                channelId,
              },
            },
          }),
        },
      );

      if (subRes.ok) {
        const subData = (await subRes.json().catch(() => ({}))) as {
          snippet?: {
            title?: string;
            thumbnails?: {
              high?: { url?: string };
              medium?: { url?: string };
              default?: { url?: string };
            };
          };
        };
        if (subData.snippet?.title) resolvedTitle = subData.snippet.title;
        const ytThumb =
          subData.snippet?.thumbnails?.high?.url ||
          subData.snippet?.thumbnails?.medium?.url ||
          subData.snippet?.thumbnails?.default?.url;
        if (ytThumb) resolvedThumb = ytThumb;
      }
    } catch {
      // Nếu token OAuth hết hạn hoặc kênh đã đăng ký trên YouTube, vẫn tiếp tục thêm kênh vào AniSub & kéo video qua YOUTUBE_API_KEY
    }
  }

  // 2. Lưu vào public.channels + public.user_channels
  const admin = createAdminClient();
  const requestedTags = Array.isArray(body.genreTags)
    ? body.genreTags.filter((t): t is PrimaryGenreTag =>
        PRIMARY_GENRE_OPTIONS.includes(t),
      )
    : [];
  const defaultTags: PrimaryGenreTag[] =
    requestedTags.length > 0 ? requestedTags : ['HH2D'];
  const primaryTag: PrimaryGenreTag = defaultTags[0] ?? 'HH2D';
  const nowIso = new Date().toISOString();

  await admin.from('channels').upsert(
    {
      channel_id: channelId,
      title: resolvedTitle,
      thumbnail_url: resolvedThumb,
      ...(resolvedCustomUrl ? { custom_url: resolvedCustomUrl } : {}),
      updated_at: nowIso,
    },
    { onConflict: 'channel_id' },
  );

  const { error: ucErr } = await admin.from('user_channels').upsert(
    {
      user_id: auth.userId,
      channel_id: channelId,
      is_selected: true,
      genre_tag: primaryTag,
      genre_tags: defaultTags,
    },
    { onConflict: 'user_id,channel_id' },
  );

  if (ucErr) {
    await admin.from('user_channels').upsert(
      {
        user_id: auth.userId,
        channel_id: channelId,
        is_selected: true,
        genre_tag: primaryTag,
      },
      { onConflict: 'user_id,channel_id' },
    );
  }

  // 3. Kéo sạch video thật từ YouTube Data API v3 cho kênh vừa thêm
  let fetchedVideosCount = 0;
  let newVideosCount = 0;
  try {
    const syncResult = await syncAllChannelVideos({
      channelId,
      genreTags: defaultTags,
    });
    fetchedVideosCount = syncResult.fetchedCount;
    newVideosCount = syncResult.newVideosCount;
  } catch (err) {
    console.error('[AniSub Subscribe] Lỗi đồng bộ toàn bộ video kênh mới:', err);
  }

  const workspaceData = await loadWorkspaceDataForUser(auth.userId);

  return NextResponse.json({
    subscribed: true,
    channelId,
    channelTitle: resolvedTitle,
    fetchedVideosCount,
    newVideosCount,
    channels: workspaceData.channels,
    videos: workspaceData.videos,
    totalVideosCount: workspaceData.totalVideosCount,
    hasMoreVideos: workspaceData.hasMoreVideos,
  });
}
