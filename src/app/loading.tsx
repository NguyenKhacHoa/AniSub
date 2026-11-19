import React from 'react';

export default function HomeLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải không gian rạp chiếu AniSub"
      className="flex h-dvh w-full overflow-hidden bg-[var(--bg-canvas)] p-2 pb-18 md:gap-3 md:p-3 md:pb-3"
    >
      {/* Skeleton Floating Rail (Desktop) */}
      <aside className="hidden w-16 shrink-0 flex-col items-center justify-between rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] py-3.5 md:flex">
        <div className="flex flex-col items-center gap-3">
          <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          <div className="h-px w-8 bg-[var(--border-subtle)]" />
          <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <div className="size-9 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
          <div className="size-9 animate-pulse rounded-full bg-[var(--bg-elevated)]" />
        </div>
      </aside>

      {/* Main Content Skeleton */}
      <main className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden">
        {/* Command Hub Skeleton */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-2.5">
              <div className="h-10 w-52 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
              <div className="h-10 w-64 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            </div>
            <div className="flex items-center gap-2">
              <div className="h-10 w-44 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
              <div className="h-10 w-28 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="h-8 w-28 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
              <div className="h-8 w-20 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
              <div className="h-8 w-20 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
              <div className="h-8 w-44 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
            </div>
            <div className="h-8 w-36 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
          </div>
        </div>

        {/* Grid Video Cards Skeleton */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="flex flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
            >
              <div className="aspect-video w-full animate-pulse bg-[var(--bg-elevated)]" />
              <div className="flex flex-col gap-2 p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="h-4 w-16 animate-pulse rounded bg-[var(--bg-elevated)]" />
                  <div className="h-3 w-12 animate-pulse rounded bg-[var(--bg-elevated)]" />
                </div>
                <div className="h-4 w-full animate-pulse rounded bg-[var(--bg-elevated)]" />
                <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-elevated)]" />
                <div className="mt-1 h-3 w-1/2 animate-pulse rounded bg-[var(--bg-elevated)]" />
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
