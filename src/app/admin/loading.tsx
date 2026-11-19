import React from 'react';

export default function AdminLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Đang tải bảng điều khiển quản trị Admin"
      className="min-h-dvh w-full bg-[var(--bg-canvas)] text-[var(--text-primary)]"
    >
      {/* Header Skeleton */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3.5 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="h-9 w-24 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            <div className="size-9 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            <div className="flex flex-col gap-1.5">
              <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-elevated)]" />
              <div className="h-3 w-32 animate-pulse rounded bg-[var(--bg-elevated)]" />
            </div>
          </div>
          <div className="h-9 w-28 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
        </div>
      </header>

      {/* 2-Column Content Skeleton */}
      <main className="mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-12">
        {/* Cột trái: Đơn xin cấp quyền đang chờ */}
        <section className="lg:col-span-6">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3.5">
              <div className="flex items-center gap-2.5">
                <div className="size-9 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
                <div className="flex flex-col gap-1.5">
                  <div className="h-4 w-44 animate-pulse rounded bg-[var(--bg-elevated)]" />
                  <div className="h-3 w-56 animate-pulse rounded bg-[var(--bg-elevated)]" />
                </div>
              </div>
              <div className="h-7 w-16 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
            </div>
            <div className="mt-4 flex flex-col gap-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div
                  key={idx}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="size-10 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
                    <div className="flex flex-1 flex-col gap-1.5">
                      <div className="h-4 w-36 animate-pulse rounded bg-[var(--bg-elevated)]" />
                      <div className="h-3 w-48 animate-pulse rounded bg-[var(--bg-elevated)]" />
                    </div>
                  </div>
                  <div className="mt-3.5 flex justify-end gap-2">
                    <div className="h-9 w-24 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
                    <div className="h-9 w-28 animate-pulse rounded-lg bg-[var(--bg-elevated)]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Cột phải: Thành viên Whitelist */}
        <section className="lg:col-span-6">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-2.5 border-b border-[var(--border-subtle)] pb-3.5">
              <div className="size-9 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
              <div className="flex flex-col gap-1.5">
                <div className="h-4 w-40 animate-pulse rounded bg-[var(--bg-elevated)]" />
                <div className="h-3 w-48 animate-pulse rounded bg-[var(--bg-elevated)]" />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <div className="h-10 flex-1 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
              <div className="h-10 w-24 animate-pulse rounded-xl bg-[var(--bg-elevated)]" />
            </div>
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3.5 py-3"
                >
                  <div className="flex flex-col gap-1.5">
                    <div className="h-4 w-44 animate-pulse rounded bg-[var(--bg-elevated)]" />
                    <div className="h-3 w-28 animate-pulse rounded bg-[var(--bg-elevated)]" />
                  </div>
                  <div className="h-5 w-10 animate-pulse rounded-full bg-[var(--bg-elevated)]" />
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
