"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import ConfirmDialog from '@/components/shared/ConfirmDialog';

interface HistoryRecord {
  id: number;
  animeId: number;
  animeTitle: string;
  episode: number;
  watchedAt: string;
}

type SessionUser = { role?: string };

export default function AdminPageClient() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as SessionUser | undefined)?.role;

  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<{ type: 'single' | 'batch'; ids: number[] } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Redirect non-admin users
  useEffect(() => {
    if (status === 'authenticated' && role !== 'admin') {
      router.replace('/');
    }
  }, [status, role, router]);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (search) params.set('search', search);
      const res = await fetch(`/api/admin/history?${params}`);
      if (!res.ok) throw new Error('加载失败');
      const data = await res.json();
      setRecords(data.records);
      setTotal(data.total);
    } catch {
      toast.error('加载历史记录失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    if (role === 'admin') fetchRecords();
  }, [fetchRecords, role]);

  const handleSearchInput = (value: string) => {
    setSearchInput(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 400);
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === records.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(records.map((r) => r.id)));
    }
  };

  const handleDelete = async (ids: number[]) => {
    setDeleting(true);
    try {
      if (ids.length === 1) {
        const res = await fetch(`/api/admin/history/${ids[0]}`, { method: 'DELETE' });
        if (!res.ok) throw new Error();
      } else {
        const res = await fetch('/api/admin/history', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error();
      }
      toast.success(`已删除 ${ids.length} 条记录`);
      setSelected((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      fetchRecords();
    } catch {
      toast.error('删除失败');
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
  };

  if (status === 'loading' || (status === 'authenticated' && role !== 'admin')) {
    return <main className="p-6 text-zinc-400">验证权限中...</main>;
  }

  return (
    <main className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display tracking-tight text-zinc-100">数据管理</h1>
          <p className="text-sm text-zinc-500 mt-1">管理观看历史记录 · 共 {total} 条</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="搜索番剧名称..."
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/[0.04] border border-white/10 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-400/30 focus:bg-white/[0.06] transition-all"
          />
        </div>

        {selected.size > 0 && (
          <button
            onClick={() => setConfirmDelete({ type: 'batch', ids: Array.from(selected) })}
            disabled={deleting}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm hover:bg-red-500/20 transition-all disabled:opacity-50"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
            </svg>
            删除选中 ({selected.size})
          </button>
        )}
      </div>

      {/* Table */}
      <div className="glass-panel rounded-3xl border border-white/5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-zinc-400 text-left">
                <th className="px-4 py-3 w-12">
                  <input
                    type="checkbox"
                    checked={records.length > 0 && selected.size === records.length}
                    onChange={toggleSelectAll}
                    className="rounded border-white/20 bg-white/5 text-emerald-400 focus:ring-emerald-400/30 focus:ring-offset-0 cursor-pointer"
                  />
                </th>
                <th className="px-4 py-3 font-medium">ID</th>
                <th className="px-4 py-3 font-medium">番剧名称</th>
                <th className="px-4 py-3 font-medium">集数</th>
                <th className="px-4 py-3 font-medium">观看时间</th>
                <th className="px-4 py-3 font-medium w-20">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-white/[0.03]">
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 bg-white/5 rounded-lg animate-pulse" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-zinc-500">
                    {search ? '没有找到匹配的记录' : '暂无历史记录'}
                  </td>
                </tr>
              ) : (
                records.map((record) => (
                  <tr
                    key={record.id}
                    className={`border-b border-white/[0.03] transition-colors ${
                      selected.has(record.id) ? 'bg-emerald-400/[0.04]' : 'hover:bg-white/[0.02]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(record.id)}
                        onChange={() => toggleSelect(record.id)}
                        className="rounded border-white/20 bg-white/5 text-emerald-400 focus:ring-emerald-400/30 focus:ring-offset-0 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3 text-zinc-500 tabular-nums">{record.id}</td>
                    <td className="px-4 py-3 text-zinc-200 font-medium max-w-[240px] truncate" title={record.animeTitle}>
                      {record.animeTitle}
                    </td>
                    <td className="px-4 py-3 text-zinc-300 tabular-nums">第 {record.episode} 集</td>
                    <td className="px-4 py-3 text-zinc-400 tabular-nums">{formatDate(record.watchedAt)}</td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setConfirmDelete({ type: 'single', ids: [record.id] })}
                        disabled={deleting}
                        className="p-1.5 rounded-xl text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                        title="删除"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-white/5">
            <p className="text-xs text-zinc-500">
              第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条，共 {total} 条
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(1)}
                disabled={page <= 1}
                className="px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                首页
              </button>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <span className="px-3 py-1.5 text-xs text-zinc-300 tabular-nums">
                {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                下一页
              </button>
              <button
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
                className="px-2.5 py-1.5 rounded-xl text-xs text-zinc-400 hover:bg-white/5 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                末页
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Dialog */}
      <ConfirmDialog
        open={confirmDelete !== null}
        title="确认删除"
        message={
          confirmDelete?.type === 'batch'
            ? `确定要删除选中的 ${confirmDelete.ids.length} 条观看记录吗？此操作不可撤销。`
            : '确定要删除这条观看记录吗？此操作不可撤销。'
        }
        confirmText="删除"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete.ids)}
        onCancel={() => setConfirmDelete(null)}
      />
    </main>
  );
}
