'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  ListVideo,
  Loader2,
  MessageSquare,
  MessageSquareText,
  RefreshCw,
  Send,
  ThumbsUp,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type {
  CinemaChatMessage,
  CinemaInsightData,
  CommentSentiment,
} from '@/types/ai-insight';
import type { CinemaVideoItem } from '@/types/workspace';

interface AiCinemaInsightPanelProps {
  video: CinemaVideoItem;
  insight: CinemaInsightData | null;
  isLoading: boolean;
  isRefreshing: boolean;
  hasSeriesPlaylist?: boolean;
  onRefresh: () => void;
  onClosePanel: () => void;
  onSeekToSeconds?: (seconds: number) => void;
}

type InsightTab = 'overview' | 'chat';

const QUICK_PROMPTS = [
  'Tóm tắt diễn biến chính tập này',
  'Khán giả nhận xét gì nhiều nhất?',
  'Tập này có đáng xem không?',
  'Có điểm trừ nào cần lưu ý?',
] as const;

const METRIC_LABELS: Array<{
  key: keyof CinemaInsightData['metrics'];
  label: string;
}> = [
  { key: 'plot', label: 'Cốt truyện' },
  { key: 'visuals', label: 'Hình ảnh' },
  { key: 'audio', label: 'Âm thanh' },
  { key: 'pacing', label: 'Nhịp độ' },
];

function getScorePalette(score: number): {
  textClass: string;
  strokeClass: string;
  barClass: string;
  badgeClass: string;
} {
  if (score >= 80) {
    return {
      textClass: 'text-emerald-500 dark:text-emerald-400',
      strokeClass: 'stroke-emerald-500 dark:stroke-emerald-400',
      barClass: 'bg-emerald-500 dark:bg-emerald-400',
      badgeClass:
        'border-emerald-500/35 bg-emerald-500/12 text-emerald-600 dark:text-emerald-300',
    };
  }
  if (score >= 65) {
    return {
      textClass: 'text-amber-500 dark:text-amber-400',
      strokeClass: 'stroke-amber-500 dark:stroke-amber-400',
      barClass: 'bg-amber-500 dark:bg-amber-400',
      badgeClass:
        'border-amber-500/35 bg-amber-500/12 text-amber-600 dark:text-amber-300',
    };
  }
  return {
    textClass: 'text-rose-500 dark:text-rose-400',
    strokeClass: 'stroke-rose-500 dark:stroke-rose-400',
    barClass: 'bg-rose-500 dark:bg-rose-400',
    badgeClass:
      'border-rose-500/35 bg-rose-500/12 text-rose-600 dark:text-rose-300',
  };
}

function getSentimentMeta(sentiment: CommentSentiment): {
  label: string;
  badgeClass: string;
} {
  if (sentiment === 'positive') {
    return {
      label: 'Tích cực',
      badgeClass:
        'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    };
  }
  if (sentiment === 'critical') {
    return {
      label: 'Góp ý',
      badgeClass:
        'border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400',
    };
  }
  return {
    label: 'Đa chiều',
    badgeClass:
      'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400',
  };
}

function parseTimestampToSeconds(timeStr: string): number | null {
  const cleaned = timeStr.replace(/[\[\]\s]/g, '').trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function renderFormattedInline(text: string): React.ReactNode {
  const segments = text.split(/(\*\*[^*]+\*\*)/g);
  return segments.map((seg, i) => {
    if (seg.startsWith('**') && seg.endsWith('**') && seg.length > 4) {
      return (
        <strong key={i} className="font-semibold text-[var(--text-primary)]">
          {seg.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={i}>{seg}</React.Fragment>;
  });
}

function FormattedAssistantMessage({ content }: { content: string }) {
  const lines = content
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim().length > 0);

  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-[var(--text-primary)]">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (/^[-•*]\s+/.test(trimmed)) {
          const itemText = trimmed.replace(/^[-•*]\s+/, '');
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500 dark:bg-teal-400" />
              <span>{renderFormattedInline(itemText)}</span>
            </div>
          );
        }
        return <p key={idx}>{renderFormattedInline(trimmed)}</p>;
      })}
    </div>
  );
}

export function AiCinemaInsightPanel({
  video,
  insight,
  isLoading,
  isRefreshing,
  hasSeriesPlaylist = false,
  onRefresh,
  onClosePanel,
  onSeekToSeconds,
}: AiCinemaInsightPanelProps) {
  const [activeTab, setActiveTab] = useState<InsightTab>('overview');
  const [messages, setMessages] = useState<CinemaChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Chỉ cuộn nội bộ khung tin nhắn bên trong cột phải, tuyệt đối không cuộn cả trang web
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isSendingChat, activeTab]);

  const sendChatMessage = async (rawText: string) => {
    const content = rawText.trim();
    if (!content || isSendingChat || !insight) return;

    setActiveTab('chat');
    const nextMessages: CinemaChatMessage[] = [
      ...messages,
      { role: 'user', content },
    ];
    setMessages(nextMessages);
    setChatInput('');
    setIsSendingChat(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.video_id,
          videoTitle: video.title,
          channelTitle: video.channel_title ?? null,
          videoDescription: video.description ?? null,
          insightContext: insight,
          messages: nextMessages,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };

      if (!res.ok || !payload.reply) {
        toast.error(payload.error || 'Trợ lý AI chưa thể phản hồi lúc này.');
        setMessages(messages);
        return;
      }

      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: payload.reply! },
      ]);
    } catch {
      toast.error('Lỗi kết nối khi gửi câu hỏi tới Trợ lý AI.');
      setMessages(messages);
    } finally {
      setIsSendingChat(false);
    }
  };

  const handleSubmitChat = (e: React.FormEvent) => {
    e.preventDefault();
    void sendChatMessage(chatInput);
  };

  const palette = insight ? getScorePalette(insight.overallScore) : null;
  const ringRadius = 26;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = insight
    ? ringCircumference - (insight.overallScore / 100) * ringCircumference
    : ringCircumference;

  return (
    <div
      aria-label="AI Cinema Insight & Trợ lý Hỏi Đáp"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)]"
    >
      {/* Header cột phải: Chuyển tab Tổng quan & Điểm 100 | Chat với AI + Quét lại + Đóng/Playlist */}
      <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
            <BarChart3 className="size-4 shrink-0 text-teal-500 dark:text-teal-400" />
            <span>AI Cinema Insight</span>
          </div>

          <div className="flex items-center gap-1">
            {insight && (
              <button
                type="button"
                disabled={isRefreshing}
                onClick={onRefresh}
                title="Quét lại lời thoại & bình luận mới nhất"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-60 cursor-pointer"
              >
                <RefreshCw
                  className={`size-3 ${isRefreshing ? 'animate-spin text-teal-500' : ''}`}
                />
                <span className="hidden sm:inline">
                  {isRefreshing ? 'Đang quét...' : 'Quét lại'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={onClosePanel}
              title={
                hasSeriesPlaylist
                  ? 'Quay lại Danh sách tập'
                  : 'Quay lại thông tin tập phim'
              }
              className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
            >
              {hasSeriesPlaylist ? (
                <>
                  <ListVideo className="size-3" />
                  <span>Tập phim</span>
                </>
              ) : (
                <X className="size-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Thanh chuyển 2 Tab gọn gàng */}
        <div
          role="tablist"
          aria-label="Chuyển đổi Tổng quan AI và Chat với AI"
          className="mt-2 grid grid-cols-2 gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-0.5"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'overview'}
            onClick={() => setActiveTab('overview')}
            className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <BarChart3 className="size-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
            <span className="truncate">Tổng quan</span>
            {insight && palette && (
              <span
                className={`rounded px-1 text-[10px] font-bold tabular-nums ${palette.textClass}`}
              >
                {insight.overallScore}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'chat'}
            disabled={!insight}
            onClick={() => setActiveTab('chat')}
            className={`inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-50 cursor-pointer ${
              activeTab === 'chat'
                ? 'bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-xs'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <MessageSquare className="size-3.5 shrink-0 text-teal-500 dark:text-teal-400" />
            <span className="truncate">Chat với AI</span>
            {messages.length > 0 && (
              <span className="rounded bg-teal-500/15 px-1 text-[10px] font-semibold tabular-nums text-teal-600 dark:text-teal-300">
                {messages.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Nội dung chính cột phải */}
      {isLoading && !insight ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-5 text-center">
          <div className="flex size-11 items-center justify-center rounded-xl bg-teal-500/15 text-teal-500 dark:text-teal-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">
              Đang đọc nội dung phim &amp; quét bình luận...
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              Hệ thống đang trích xuất phụ đề lời thoại, lọc bình luận YouTube
              và chấm điểm thang 100.
            </p>
          </div>
          <div className="mt-2 grid w-full grid-cols-2 gap-2">
            <div className="h-14 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
            <div className="h-14 animate-pulse rounded-lg bg-[var(--bg-surface)]" />
          </div>
        </div>
      ) : !insight || !palette ? null : activeTab === 'overview' ? (
        /* TAB 1: TỔNG QUAN & ĐIỂM 100 (Cuộn độc lập trong cột phải) */
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          <div className="flex flex-col gap-3.5">
            {/* Vòng điểm số + Verdict + Badges nguồn dữ liệu */}
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <div className="relative flex size-16 shrink-0 items-center justify-center">
                <svg className="size-16 -rotate-90" viewBox="0 0 64 64">
                  <circle
                    cx="32"
                    cy="32"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="5.5"
                    className="stroke-[var(--bg-elevated)]"
                  />
                  <circle
                    cx="32"
                    cy="32"
                    r={ringRadius}
                    fill="none"
                    strokeWidth="5.5"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringOffset}
                    className={`transition-all duration-700 ${palette.strokeClass}`}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span
                    className={`text-base font-bold leading-none tabular-nums ${palette.textClass}`}
                  >
                    {insight.overallScore}
                  </span>
                  <span className="mt-0.5 text-[9px] font-medium tabular-nums text-[var(--text-secondary)]">
                    / 100
                  </span>
                </div>
              </div>

              <div className="min-w-0 flex-1">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${palette.badgeClass}`}
                >
                  {insight.verdictLabel}
                </span>
                <div className="mt-1.5 flex flex-wrap items-center gap-1">
                  {insight.hasTranscript && (
                    <span className="inline-flex items-center gap-1 rounded border border-teal-500/30 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-medium text-teal-600 dark:text-teal-300">
                      <FileText className="size-2.5 shrink-0" />
                      <span>Đã đọc lời thoại</span>
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1 rounded border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--text-secondary)]">
                    <MessageSquareText className="size-2.5 shrink-0" />
                    <span>
                      {insight.analyzedCommentCount > 0
                        ? `${insight.analyzedCommentCount} bình luận`
                        : 'Chưa có bình luận'}
                    </span>
                  </span>
                </div>
              </div>
            </div>

            {/* Lưới 4 Thanh Chỉ Số (2x2) */}
            <div className="grid grid-cols-2 gap-2">
              {METRIC_LABELS.map(({ key, label }) => {
                const val = insight.metrics[key];
                const barPalette = getScorePalette(val);
                return (
                  <div
                    key={key}
                    className="flex flex-col gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5 py-2"
                  >
                    <div className="flex items-center justify-between gap-1 text-[11px]">
                      <span className="font-medium text-[var(--text-primary)]">
                        {label}
                      </span>
                      <span
                        className={`font-semibold tabular-nums ${barPalette.textClass}`}
                      >
                        {val}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barPalette.barClass}`}
                        style={{ width: `${val}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Tóm tắt tổng quan & Mốc nổi bật */}
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Tổng quan (Không Spoil)
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-primary)] text-pretty">
                {insight.overview}
              </p>

              {insight.highlights.length > 0 && (
                <div className="mt-2.5 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    Mốc nổi bật
                  </p>
                  {insight.highlights.map((hl, idx) => {
                    const seekSec = hl.time
                      ? parseTimestampToSeconds(hl.time)
                      : null;
                    return (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 text-xs text-[var(--text-primary)]"
                      >
                        {hl.time ? (
                          seekSec !== null && onSeekToSeconds ? (
                            <button
                              type="button"
                              onClick={() => onSeekToSeconds(seekSec)}
                              title={`Tua tới mốc ${hl.time}`}
                              className="inline-flex shrink-0 items-center gap-0.5 rounded border border-teal-500/35 bg-teal-500/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-teal-600 transition-colors hover:bg-teal-500/20 dark:text-teal-300 cursor-pointer"
                            >
                              <Clock className="size-2.5" />
                              <span>{hl.time}</span>
                            </button>
                          ) : (
                            <span className="shrink-0 rounded border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
                              {hl.time}
                            </span>
                          )
                        ) : (
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500" />
                        )}
                        <span className="leading-snug">{hl.description}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Góc nhìn cộng đồng: Điểm khen & Lưu ý */}
            <div className="flex flex-col gap-2">
              <div className="rounded-xl border border-emerald-500/25 bg-[var(--bg-surface)] p-3">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="size-3.5 shrink-0" />
                  <span>Điểm được khen</span>
                </h3>
                <ul className="mt-1.5 flex flex-col gap-1 text-xs leading-snug text-[var(--text-primary)]">
                  {insight.communityPros.map((pro, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-emerald-500" />
                      <span>{pro}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-amber-500/25 bg-[var(--bg-surface)] p-3">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  <span>Lưu ý / Điểm trừ</span>
                </h3>
                <ul className="mt-1.5 flex flex-col gap-1 text-xs leading-snug text-[var(--text-primary)]">
                  {insight.communityCons.map((con, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-amber-500" />
                      <span>{con}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Bình luận tiêu biểu */}
            {insight.featuredComments.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  Bình luận tiêu biểu YouTube
                </p>
                {insight.featuredComments.map((cmt, idx) => {
                  const sMeta = getSentimentMeta(cmt.sentiment);
                  return (
                    <blockquote
                      key={idx}
                      className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
                    >
                      <p className="text-xs leading-snug text-[var(--text-primary)] text-pretty">
                        &ldquo;{cmt.text}&rdquo;
                      </p>
                      <footer className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-[var(--text-secondary)]">
                        <span className="truncate font-medium">
                          {cmt.author}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={`rounded border px-1 py-0.2 font-medium ${sMeta.badgeClass}`}
                          >
                            {sMeta.label}
                          </span>
                          <span className="inline-flex items-center gap-0.5 tabular-nums">
                            <ThumbsUp className="size-2.5" />
                            <span>{cmt.likes}</span>
                          </span>
                        </div>
                      </footer>
                    </blockquote>
                  );
                })}
              </div>
            )}

            <Button
              type="button"
              onClick={() => setActiveTab('chat')}
              className="h-9 w-full rounded-xl bg-[var(--accent-primary)] text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 cursor-pointer"
            >
              <MessageSquare className="mr-1.5 size-3.5" />
              <span>Hỏi AI về tập phim này</span>
            </Button>
          </div>
        </div>
      ) : (
        /* TAB 2: CHAT VỚI AI (Cuộn độc lập bên trong cột phải, ô nhập ghim cố định ở đáy) */
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Thanh tóm tắt điểm siêu gọn + Gợi ý nhanh */}
          <div className="shrink-0 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/70 px-3 py-2">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-medium text-[var(--text-secondary)]">
                Hỏi đáp theo lời thoại &amp; bình luận
              </span>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.2 font-semibold tabular-nums ${palette.badgeClass}`}
              >
                {insight.overallScore}/100
              </span>
            </div>

            <div className="mt-2 flex flex-wrap gap-1">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={isSendingChat}
                  onClick={() => void sendChatMessage(q)}
                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:border-teal-500/50 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {/* Luồng tin nhắn tự cuộn độc lập bên trong cột phải */}
          <div
            ref={chatScrollRef}
            className="min-h-0 flex-1 overflow-y-auto p-3"
          >
            {messages.length === 0 && !isSendingChat ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-6 text-center">
                <MessageSquare className="size-6 text-teal-500/70 dark:text-teal-400/70" />
                <p className="max-w-[220px] text-xs leading-relaxed text-[var(--text-secondary)]">
                  Bấm một câu gợi ý bên trên hoặc đặt câu hỏi bất kỳ về nhân
                  vật, tình tiết trong tập phim này.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {messages.map((msg, idx) => {
                  const isUser = msg.role === 'user';
                  return (
                    <div
                      key={idx}
                      className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[90%] rounded-xl px-3 py-2 ${
                          isUser
                            ? 'bg-[var(--accent-primary)] text-xs font-medium text-[var(--accent-foreground)]'
                            : 'border border-[var(--border-subtle)] bg-[var(--bg-surface)]'
                        }`}
                      >
                        {isUser ? (
                          <p className="leading-relaxed">{msg.content}</p>
                        ) : (
                          <FormattedAssistantMessage content={msg.content} />
                        )}
                      </div>
                    </div>
                  );
                })}

                {isSendingChat && (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 py-2 text-xs text-[var(--text-secondary)]">
                      <Loader2 className="size-3.5 animate-spin text-teal-500 dark:text-teal-400" />
                      <span>Trợ lý AI đang suy nghĩ...</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Ô nhập câu hỏi ghim cố định ở đáy cột phải */}
          <form
            onSubmit={handleSubmitChat}
            className="sticky bottom-0 shrink-0 flex items-center gap-1.5 border-t border-[var(--border-subtle)] bg-[var(--bg-surface)] p-2.5"
          >
            <Input
              type="text"
              value={chatInput}
              disabled={isSendingChat}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Hỏi AI về tập phim này..."
              aria-label="Nhập câu hỏi cho AI về tập phim này"
              className="h-9 flex-1 rounded-lg border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
            />
            <Button
              type="submit"
              disabled={isSendingChat || !chatInput.trim()}
              aria-label="Gửi câu hỏi"
              className="h-9 shrink-0 rounded-lg bg-[var(--accent-primary)] px-3 text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
            >
              {isSendingChat ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" />
              )}
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
