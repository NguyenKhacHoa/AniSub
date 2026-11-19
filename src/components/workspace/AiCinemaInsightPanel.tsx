'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  MessageSquareText,
  RefreshCw,
  Send,
  ThumbsUp,
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
  onRefresh: () => void;
  onSeekToSeconds?: (seconds: number) => void;
}

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

/**
 * Render nội dung văn bản AI hỗ trợ **in đậm** và danh sách gạch đầu dòng sạch sẽ.
 */
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
  onRefresh,
  onSeekToSeconds,
}: AiCinemaInsightPanelProps) {
  const [messages, setMessages] = useState<CinemaChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSendingChat, setIsSendingChat] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Cuộn mượt xuống cuối khung chat khi có tin nhắn mới
  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isSendingChat]);

  const sendChatMessage = async (rawText: string) => {
    const content = rawText.trim();
    if (!content || isSendingChat || !insight) return;

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

  // Trạng thái đang phân tích lần đầu (Skeleton chuyên nghiệp)
  if (isLoading && !insight) {
    return (
      <section
        aria-label="Đang phân tích nội dung phim bằng AI"
        className="mt-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 sm:p-5"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-teal-500/15 text-teal-500 dark:text-teal-400">
            <Loader2 className="size-5 animate-spin" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">
              Đang đọc nội dung phim &amp; quét bình luận...
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              Hệ thống đang đồng thời trích xuất lời thoại phụ đề YouTube, lọc
              bình luận khán giả và chấm điểm tổng quan bằng Gemini AI.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-24 animate-pulse rounded-xl bg-[var(--bg-surface)]" />
          <div className="h-24 animate-pulse rounded-xl bg-[var(--bg-surface)]" />
        </div>
      </section>
    );
  }

  if (!insight) return null;

  const palette = getScorePalette(insight.overallScore);
  const ringRadius = 30;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset =
    ringCircumference - (insight.overallScore / 100) * ringCircumference;

  return (
    <section
      aria-label="AI Cinema Insight & Trợ lý Hỏi Đáp"
      className="mt-4 flex flex-col gap-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4 sm:p-5"
    >
      {/* ===================================================================
          KHỐI A: BẢNG TỔNG QUAN & ĐIỂM SỐ (THANG 100)
          =================================================================== */}
      <div className="flex flex-col gap-4">
        {/* Header Điểm Số + Badges nguồn dữ liệu + Nút Quét lại */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border-subtle)] pb-4">
          <div className="flex items-center gap-4">
            {/* Vòng tròn điểm số thang 100 */}
            <div className="relative flex size-20 shrink-0 items-center justify-center">
              <svg className="size-20 -rotate-90" viewBox="0 0 72 72">
                <circle
                  cx="36"
                  cy="36"
                  r={ringRadius}
                  fill="none"
                  strokeWidth="6"
                  className="stroke-[var(--bg-elevated)]"
                />
                <circle
                  cx="36"
                  cy="36"
                  r={ringRadius}
                  fill="none"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                  className={`transition-all duration-700 ${palette.strokeClass}`}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className={`text-lg font-bold leading-none tabular-nums ${palette.textClass}`}
                >
                  {insight.overallScore}
                </span>
                <span className="mt-0.5 text-[10px] font-medium tabular-nums text-[var(--text-secondary)]">
                  / 100
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  <BarChart3 className="size-3.5 text-teal-500 dark:text-teal-400" />
                  <span>AI Cinema Insight</span>
                </span>
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${palette.badgeClass}`}
                >
                  {insight.verdictLabel}
                </span>
              </div>

              {/* Badges nguồn dữ liệu đã phân tích */}
              <div className="flex flex-wrap items-center gap-1.5">
                {insight.hasTranscript && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-teal-500/30 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-600 dark:text-teal-300">
                    <FileText className="size-3 shrink-0" />
                    <span>Đã đọc lời thoại phim</span>
                  </span>
                )}
                {insight.analyzedCommentCount > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]">
                    <MessageSquareText className="size-3 shrink-0 text-[var(--text-primary)]" />
                    <span>
                      Quét {insight.analyzedCommentCount} bình luận YouTube
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    <span>Chưa có bình luận YouTube</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            disabled={isRefreshing}
            onClick={onRefresh}
            title="Quét lại lời thoại, bình luận mới nhất và phân tích lại bằng AI"
            className="h-8 rounded-lg border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] cursor-pointer"
          >
            <RefreshCw
              className={`mr-1.5 size-3.5 ${isRefreshing ? 'animate-spin text-teal-500' : ''}`}
            />
            <span>{isRefreshing ? 'Đang quét lại...' : 'Quét lại'}</span>
          </Button>
        </div>

        {/* Lưới 4 Thanh Chỉ Số (2x2) */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {METRIC_LABELS.map(({ key, label }) => {
            const val = insight.metrics[key];
            const barPalette = getScorePalette(val);
            return (
              <div
                key={key}
                className="flex flex-col gap-1.5 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-3.5 py-2.5"
              >
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-[var(--text-primary)]">
                    {label}
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${barPalette.textClass}`}
                  >
                    {val}/100
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

        {/* Tóm Tắt Tổng Quan & Mốc Nổi Bật */}
        <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            Tổng quan tập phim (Không Spoil)
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-primary)] text-pretty">
            {insight.overview}
          </p>

          {insight.highlights.length > 0 && (
            <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                Mốc nổi bật
              </p>
              <div className="flex flex-col gap-1.5">
                {insight.highlights.map((hl, idx) => {
                  const seekSec = hl.time
                    ? parseTimestampToSeconds(hl.time)
                    : null;
                  return (
                    <div
                      key={idx}
                      className="flex items-start gap-2 text-xs text-[var(--text-primary)]"
                    >
                      {hl.time ? (
                        seekSec !== null && onSeekToSeconds ? (
                          <button
                            type="button"
                            onClick={() => onSeekToSeconds(seekSec)}
                            title={`Tua tới mốc ${hl.time}`}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal-500/35 bg-teal-500/12 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-teal-600 transition-colors hover:bg-teal-500/20 dark:text-teal-300 cursor-pointer"
                          >
                            <Clock className="size-3" />
                            <span>{hl.time}</span>
                          </button>
                        ) : (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-[var(--text-secondary)]">
                            {hl.time}
                          </span>
                        )
                      ) : (
                        <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-teal-500 dark:bg-teal-400" />
                      )}
                      <span className="leading-relaxed">{hl.description}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Góc Nhìn Cộng Đồng YouTube: 2 cột (Điểm khen & Lưu ý) + Trích dẫn bình luận */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-500/25 bg-[var(--bg-surface)] p-3.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>Điểm được khán giả khen nhiều</span>
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-[var(--text-primary)]">
              {insight.communityPros.map((pro, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span>{pro}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-amber-500/25 bg-[var(--bg-surface)] p-3.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
              <AlertTriangle className="size-4 shrink-0" />
              <span>Lưu ý / Điểm trừ</span>
            </h3>
            <ul className="mt-2 flex flex-col gap-1.5 text-xs leading-relaxed text-[var(--text-primary)]">
              {insight.communityCons.map((con, idx) => (
                <li key={idx} className="flex items-start gap-2">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500" />
                  <span>{con}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Trích dẫn 2-3 bình luận đắt giá từ YouTube */}
        {insight.featuredComments.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
              Bình luận tiêu biểu từ khán giả YouTube
            </p>
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              {insight.featuredComments.map((cmt, idx) => {
                const sMeta = getSentimentMeta(cmt.sentiment);
                return (
                  <blockquote
                    key={idx}
                    className="flex flex-col justify-between gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3"
                  >
                    <p className="line-clamp-3 text-xs leading-relaxed text-[var(--text-primary)] text-pretty">
                      &ldquo;{cmt.text}&rdquo;
                    </p>
                    <footer className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2 text-[11px]">
                      <span className="min-w-0 flex-1 truncate font-medium text-[var(--text-secondary)]">
                        {cmt.author}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded border px-1.5 py-0.2 text-[10px] font-medium ${sMeta.badgeClass}`}
                        >
                          {sMeta.label}
                        </span>
                        <span className="inline-flex items-center gap-0.5 tabular-nums text-[var(--text-secondary)]">
                          <ThumbsUp className="size-3" />
                          <span>{cmt.likes}</span>
                        </span>
                      </div>
                    </footer>
                  </blockquote>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================
          KHỐI B: KHUNG CHAT HỎI ĐÁP TRỰC TIẾP THEO NGỮ CẢNH TẬP PHIM
          =================================================================== */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-500 dark:text-teal-400">
              <MessageSquare className="size-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                Hỏi AI về tập phim này
              </h3>
            </div>
          </div>
          <span className="text-[11px] text-[var(--text-secondary)]">
            Trả lời dựa trên nội dung phim &amp; bình luận thực tế
          </span>
        </div>

        {/* 4 Gợi ý câu hỏi nhanh 1 chạm (Quick Prompt Chips) */}
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_PROMPTS.map((q) => (
            <button
              key={q}
              type="button"
              disabled={isSendingChat}
              onClick={() => void sendChatMessage(q)}
              className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:border-teal-500/50 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
            >
              {q}
            </button>
          ))}
        </div>

        {/* Luồng tin nhắn hội thoại cuộn độc lập */}
        {(messages.length > 0 || isSendingChat) && (
          <div
            ref={chatScrollRef}
            className="flex max-h-72 flex-col gap-2.5 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3"
          >
            {messages.map((msg, idx) => {
              const isUser = msg.role === 'user';
              return (
                <div
                  key={idx}
                  className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[88%] rounded-xl px-3 py-2 ${
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

        {/* Ô nhập câu hỏi + nút Gửi */}
        <form onSubmit={handleSubmitChat} className="flex items-center gap-2">
          <Input
            type="text"
            value={chatInput}
            disabled={isSendingChat}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Hỏi về nhân vật, chiêu thức, tình tiết hoặc phản ứng khán giả..."
            aria-label="Nhập câu hỏi cho AI về tập phim này"
            className="h-10 flex-1 rounded-xl border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]"
          />
          <Button
            type="submit"
            disabled={isSendingChat || !chatInput.trim()}
            className="h-10 shrink-0 rounded-xl bg-[var(--accent-primary)] px-4 text-xs font-semibold text-[var(--accent-foreground)] hover:opacity-90 disabled:opacity-50 cursor-pointer"
          >
            {isSendingChat ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <Send className="mr-1.5 size-3.5" />
                <span>Gửi</span>
              </>
            )}
          </Button>
        </form>
      </div>
    </section>
  );
}
