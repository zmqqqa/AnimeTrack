"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import { MagnifyingGlassIcon, TvIcon, TagIcon, SparklesIcon, FireIcon, Squares2X2Icon, ListBulletIcon } from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import AnimeHeader from '@/components/anime/AnimeHeader';
import AnimeFilterBar from '@/components/anime/AnimeFilterBar';
import AnimeForm from '@/components/anime/AnimeForm';
import AnimeGrid, { type ViewMode } from '@/components/anime/AnimeGrid';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { containsCjkText, matchesTextQuery, uniqueStrings } from '@/lib/anime-cast';
import type { AnimeStatus, AnimeSortBy, SessionUser, AnimeListItem, AnimeCardItem } from '@/lib/anime-shared';

function compareNumberValues(left: number, right: number, order: 'asc' | 'desc') {
  return order === 'asc' ? left - right : right - left;
}

function compareTextValues(left: string, right: string, order: 'asc' | 'desc') {
  const result = left.localeCompare(right, 'zh-CN');
  return order === 'asc' ? result : -result;
}

function compareDateValues(left: string | undefined, right: string | undefined, order: 'asc' | 'desc') {
  const leftTime = left ? new Date(left).getTime() : Number.NaN;
  const rightTime = right ? new Date(right).getTime() : Number.NaN;
  const leftMissing = Number.isNaN(leftTime);
  const rightMissing = Number.isNaN(rightTime);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  return order === 'asc' ? leftTime - rightTime : rightTime - leftTime;
}

function formatRecentWatchDate(value: string | undefined) {
  if (!value) return '时间未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

export default function AnimePageClient() {
  const { data: session } = useSession();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isAdmin = (session?.user as SessionUser | undefined)?.role === 'admin';
  const [items, setItems] = useState<AnimeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [quickInput, setQuickInput] = useState('');
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickMessage, setQuickMessage] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    if (typeof window !== 'undefined') {
      return (sessionStorage.getItem('anime_view_mode') as ViewMode) || 'grid';
    }
    return 'grid';
  });
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; title: string } | null>(null);
  
  // 筛选与排序状态
  const [filterStatus, setFilterStatus] = useState<AnimeStatus | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [castQuery, setCastQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortBy, setSortBy] = useState<AnimeSortBy>('lastWatchedAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const hasSyncedUrlFilters = useRef(false);
  const lastFilterKeyRef = useRef('');
  
  // 从 URL 读取页码，默认 1，缺失时回退 sessionStorage
  const currentPage = useMemo(() => {
    const urlPage = Number(searchParams.get('page'));
    return Number.isFinite(urlPage) && urlPage > 0 ? urlPage : 1;
  }, [searchParams]);

  const setCurrentPage = useCallback((page: number) => {
    const nextPage = Math.max(1, page);
    const params = new URLSearchParams(searchParams.toString());
    if (nextPage === 1) {
      params.delete('page');
    } else {
      params.set('page', String(nextPage));
    }

    const query = params.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
    sessionStorage.setItem('anime_last_page', String(nextPage));
  }, [pathname, router, searchParams]);

  // 缺少页码时，用上次停留的页码填充 URL
  useEffect(() => {
    if (!searchParams.get('page')) {
      const cached = sessionStorage.getItem('anime_last_page');
      if (cached) {
        const cachedPage = Number(cached);
        if (Number.isFinite(cachedPage) && cachedPage > 0) {
          setCurrentPage(cachedPage);
        }
      }
    }
  }, [searchParams, setCurrentPage]);

  const pageSize = 12;

  // 表单初始数据
  const [formData, setFormData] = useState({
    title: '',
    originalTitle: '',
    progress: '0',
    totalEpisodes: '',
    status: 'watching' as AnimeStatus,
    notes: '',
    coverUrl: '',
    tags: '',
    durationMinutes: '',
    startDate: '',
    endDate: '',
    isFinished: false,
  });

  const loadItems = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/anime?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setItems(Array.isArray(data) ? (data as AnimeListItem[]) : []);
      }
    } catch (err) {
      console.error('Failed to load anime:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    if (hasSyncedUrlFilters.current) {
      return;
    }

    const castFromUrl = searchParams.get('cast')?.trim();
    const tagFromUrl = searchParams.get('tag')?.trim();
    const statusFromUrl = searchParams.get('status')?.trim();

    if (castFromUrl) {
      setCastQuery(castFromUrl);
    }

    if (tagFromUrl) {
      setTagFilter(tagFromUrl);
    }

    if (statusFromUrl && ['watching', 'completed', 'dropped', 'plan_to_watch'].includes(statusFromUrl)) {
      setFilterStatus(statusFromUrl as AnimeStatus);
    }

    hasSyncedUrlFilters.current = true;
  }, [searchParams]);

  const filterStateKey = useMemo(
    () => [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder].join('||'),
    [filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder]
  );

  useEffect(() => {
    if (!lastFilterKeyRef.current) {
      lastFilterKeyRef.current = filterStateKey;
      return;
    }

    if (lastFilterKeyRef.current === filterStateKey) {
      return;
    }

    lastFilterKeyRef.current = filterStateKey;
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, filterStateKey, setCurrentPage]);

  const resetForm = () => {
    setShowForm(false);
    setEditingId(null);
    setFormData({
      title: '',
      originalTitle: '',
      progress: '0',
      totalEpisodes: '',
      status: 'watching',
      notes: '',
      coverUrl: '',
      tags: '',
      durationMinutes: '',
      startDate: '',
      endDate: '',
      isFinished: false,
    });
  };

  const startEdit = (item: AnimeCardItem) => {
    setEditingId(item.id);
    setFormData({
      title: item.title,
      originalTitle: item.originalTitle || '',
      progress: String(item.progress),
      totalEpisodes: item.totalEpisodes ? String(item.totalEpisodes) : '',
      status: item.status,
      notes: item.notes || '',
      coverUrl: item.coverUrl || '',
      tags: item.tags ? item.tags.join(', ') : '',
      durationMinutes: item.durationMinutes ? String(item.durationMinutes) : '',
      startDate: item.startDate || '',
      endDate: item.endDate || '',
      isFinished: item.isFinished || false,
    });
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const toggleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    sessionStorage.setItem('anime_view_mode', mode);
  }, []);

  const updateProgress = async (id: number, current: number, total?: number | null) => {
    if (current < 0) return;
    try {
      const isFinishing = total && current >= total;
      const res = await fetch(`/api/anime/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          progress: current,
          status: isFinishing ? 'completed' : undefined,
          recordHistory: true
        })
      });
      if (res.ok) {
        loadItems();
        if (isFinishing) {
          toast.success('🎉 恭喜完结！');
        } else {
          toast.success(`已更新进度至 EP ${current}`);
        }
      }
    } catch (err) {
      console.error('Update failed:', err);
      toast.error('更新失败，请重试');
    }
  };

  const deleteAnime = async (id: number) => {
    const item = items.find(i => i.id === id);
    setDeleteConfirm({ id, title: item?.title || '这部番剧' });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id } = deleteConfirm;
    setDeleteConfirm(null);
    try {
      const res = await fetch(`/api/anime/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setItems(prev => prev.filter(item => item.id !== id));
        resetForm();
        toast.success('已删除');
      } else {
        toast.error('删除失败');
      }
    } catch (err) {
      console.error('Delete failed:', err);
      toast.error('删除失败，请重试');
    }
  };

  const handleQuickRecord = async () => {
    const text = quickInput.trim();
    if (!text) {
      setQuickMessage('请输入一句话记录');
      return;
    }

    setQuickLoading(true);
    setQuickMessage('');

    try {
      const res = await fetch('/api/anime/quick-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setQuickMessage(data.error || 'AI录入失败');
        toast.error(data.error || 'AI录入失败');
        return;
      }

      await loadItems();
      setQuickInput('');
      toast.success('AI 录入成功');

      const results = Array.isArray(data?.results)
        ? (data.results as Array<{
            entry?: { title?: string };
            recognition?: { matchedTitle?: string; standardTitle?: string };
          }>)
        : [];
      if (results.length > 1) {
        const titlePreview = results
          .slice(0, 3)
          .map((item) => item?.entry?.title || item?.recognition?.matchedTitle || item?.recognition?.standardTitle || '番剧')
          .join('、');
        const tail = results.length > 3 ? ` 等${results.length}部` : '';
        const countsText = `新建${Number(data?.createdCount) || 0}，更新${Number(data?.updatedCount) || 0}，补记${Number(data?.replayCount) || 0}`;
        const historyText = Number(data?.historySkippedCount) > 0 ? `；${data.historySkippedCount}条历史记录未写入今日时间` : '';
        const errorText = Array.isArray(data?.errors) && data.errors.length > 0 ? `；${data.errors.length}条处理失败` : '';
        setQuickMessage(`已处理 ${results.length} 条：${titlePreview}${tail}；${countsText}${historyText}${errorText}`);
        return;
      }

      const title = data?.entry?.title || data?.recognition?.matchedTitle || '番剧';
      const progress = data?.entry?.progress;
      const standardTitle = typeof data?.recognition?.standardTitle === 'string' ? data.recognition.standardTitle : data?.parsed?.animeTitle;
      const originalTitle = typeof data?.recognition?.originalTitle === 'string' ? data.recognition.originalTitle : data?.parsed?.originalTitle;
      const enriched = Boolean(data?.recognition?.enriched);
      const historyWritten = data?.recognition?.historyWritten !== false;
      const rewatchTag = typeof data?.rewatchTag === 'string' ? data.rewatchTag : '';
      const stateText = data?.created ? (rewatchTag ? `${rewatchTag}已新建并记录` : '已新建并记录') : (data?.replay ? '已补记' : '已记录');
      const recognizedText = standardTitle ? `；识别：${standardTitle}${originalTitle ? ` / ${originalTitle}` : ''}` : '';
      const enrichedText = enriched ? '（已AI补全）' : '';
      const historyText = historyWritten ? '' : '；历史补录未写入今日观看时间';
      setQuickMessage(`${stateText}：${title}${Number.isFinite(progress) ? `（EP ${progress}）` : ''}${recognizedText}${enrichedText}${historyText}`);
    } catch (error) {
      console.error('Quick record failed:', error);
      setQuickMessage('AI录入失败，请稍后重试');
      toast.error('AI录入失败，请稍后重试');
    } finally {
      setQuickLoading(false);
    }
  };

  const voiceActorSuggestions = useMemo(() => {
    const counts = new Map<string, number>();

    for (const item of items) {
      const names = uniqueStrings([
        ...(item.castAliases || []).filter((name: string) => containsCjkText(name)),
        ...(item.cast || []),
      ]);
      for (const name of names) {
        counts.set(name, (counts.get(name) || 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([name]) => name);
  }, [items]);

  const tagPreferences = useMemo(() => {
    return Array.from(new Set(items.flatMap((item) => item.tags || [])))
      .map((tag) => ({
        tag,
        count: items.filter((item) => (item.tags || []).includes(tag)).length,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 18);
  }, [items]);

  const toggleTagFilter = useCallback((tag: string) => {
    setTagFilter((current) => (current === tag ? '' : tag));
    if (currentPage !== 1) {
      setCurrentPage(1);
    }
  }, [currentPage, setCurrentPage]);

  const recentWatchItems = useMemo(() => {
    return [...items]
      .filter((item) => Boolean(item.lastWatchedAt))
      .sort((a, b) => compareDateValues(a.lastWatchedAt, b.lastWatchedAt, 'desc'))
      .slice(0, 5);
  }, [items]);

  // 综合过滤与排序
  const filteredItems = useMemo(() => {
    const result = items.filter(item => {
      const matchesStatus = filterStatus === 'all' || item.status === filterStatus;
      const matchesSearch = matchesTextQuery(searchQuery, [item.title, item.originalTitle], item.cast, item.castAliases);
      const matchesCast = matchesTextQuery(castQuery, item.cast, item.castAliases);
      const matchesTag = matchesTextQuery(tagFilter, item.tags);
      return matchesStatus && matchesSearch && matchesCast && matchesTag;
    });

    return result.sort((a, b) => {
      if (sortBy === 'score') {
        return compareNumberValues(a.score ?? 0, b.score ?? 0, sortOrder);
      }

      if (sortBy === 'progress') {
        return compareNumberValues(a.progress, b.progress, sortOrder);
      }

      if (sortBy === 'title') {
        return compareTextValues(a.title, b.title, sortOrder);
      }

      if (sortBy === 'lastWatchedAt') {
        const leftHasWatch = Boolean(a.lastWatchedAt);
        const rightHasWatch = Boolean(b.lastWatchedAt);

        if (leftHasWatch && rightHasWatch) {
          return compareDateValues(a.lastWatchedAt, b.lastWatchedAt, sortOrder);
        }

        if (leftHasWatch !== rightHasWatch) {
          return leftHasWatch ? -1 : 1;
        }

        return compareDateValues(a.createdAt, b.createdAt, sortOrder);
      }

      if (sortBy === 'updatedAt') {
        return compareDateValues(a.updatedAt, b.updatedAt, sortOrder);
      }

      if (sortBy === 'createdAt') {
        return compareDateValues(a.createdAt, b.createdAt, sortOrder);
      }

      if (sortBy === 'startDate') {
        return compareDateValues(a.startDate, b.startDate, sortOrder);
      }

      return compareDateValues(a.endDate, b.endDate, sortOrder);
    });
  }, [items, filterStatus, searchQuery, castQuery, tagFilter, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  useEffect(() => {
    if (safePage !== currentPage) setCurrentPage(safePage);
  }, [safePage, currentPage, setCurrentPage]);

  const pagedItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, safePage, pageSize]);

  return (
    <main className="p-4 md:p-8 max-w-[1600px] mx-auto space-y-8 pb-20">
      <AnimeHeader 
        showForm={showForm}
        editingId={editingId}
        setShowForm={setShowForm}
        resetForm={resetForm}
        isAdmin={isAdmin}
      />

      {isAdmin && (
        <section className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-5 shadow-xl">
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-300 uppercase tracking-wider">
            <SparklesIcon className="w-4 h-4 text-cyan-400" />
            AI 一句话录入
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleQuickRecord();
            }}
            className="mt-3 flex flex-col md:flex-row gap-2"
          >
            <input
              type="text"
              value={quickInput}
              onChange={(e) => setQuickInput(e.target.value)}
              placeholder="例如：今天看了 间谍过家家第三季 第1集"
              className="flex-1 bg-zinc-950 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-cyan-500/50"
            />
            <button
              type="submit"
              disabled={quickLoading}
              className="px-4 py-2.5 rounded-xl bg-cyan-500/90 hover:bg-cyan-400 text-black text-sm font-bold disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {quickLoading ? '录入中...' : 'AI录入'}
            </button>
          </form>

          <p className="text-xs text-zinc-500 mt-2">支持自然语言拆成多条记录；AI 先返回结构化字段，缺失资料再补全。句子里写“以前 / 之前”时，不会再默认写成今天开始看。</p>
          {quickMessage && (
            <p className={`text-xs mt-2 ${quickMessage.includes('失败') || quickMessage.includes('请输入') ? 'text-red-400' : 'text-emerald-400'}`}>
              {quickMessage}
            </p>
          )}
        </section>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-8 space-y-6">
          <div className="space-y-4">
            {/* 搜索框 + 视图切换 */}
            <div className="flex gap-3">
              <div className="relative group shadow-sm flex-1">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <MagnifyingGlassIcon className="h-5 w-5 text-zinc-500 group-focus-within:text-purple-500 transition-colors" />
                </div>
                <input
                  type="text"
                  placeholder="搜索番剧、原名或声优..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-2xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all shadow-xl"
                />
              </div>
              <div className="flex items-center rounded-2xl border border-white/5 bg-zinc-900/50 overflow-hidden flex-shrink-0">
                <button
                  type="button"
                  onClick={() => toggleViewMode('grid')}
                  className={`p-3 transition-all ${viewMode === 'grid' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                  aria-label="网格视图"
                >
                  <Squares2X2Icon className="w-5 h-5" />
                </button>
                <button
                  type="button"
                  onClick={() => toggleViewMode('list')}
                  className={`p-3 transition-all ${viewMode === 'list' ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                  aria-label="列表视图"
                >
                  <ListBulletIcon className="w-5 h-5" />
                </button>
              </div>
            </div>

            <AnimeFilterBar 
              filterStatus={filterStatus}
              setFilterStatus={setFilterStatus}
              castQuery={castQuery}
              setCastQuery={setCastQuery}
              voiceActorSuggestions={voiceActorSuggestions}
              sortBy={sortBy}
              setSortBy={setSortBy}
              sortOrder={sortOrder}
              setSortOrder={setSortOrder}
              itemsCount={filteredItems.length}
            />

            {tagFilter && (
              <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-purple-500/10 px-3 py-2">
                <span className="text-xs text-purple-200">已按标签筛选：#{tagFilter}</span>
                <button
                  type="button"
                  onClick={() => setTagFilter('')}
                  className="text-[11px] text-purple-200/80 hover:text-white"
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {isAdmin && showForm && (
            <AnimeForm 
              key={editingId || 'new'}
              editingId={editingId}
              initialData={formData}
              resetForm={resetForm}
              loadItems={loadItems}
              deleteAnime={deleteAnime}
            />
          )}

          <AnimeGrid 
            items={pagedItems}
            onEdit={startEdit}
            updateProgress={updateProgress}
            loading={loading}
            isAdmin={isAdmin}
            viewMode={viewMode}
          />

          {!loading && filteredItems.length > 0 && (
            <div className="flex items-center justify-between bg-zinc-900/40 border border-white/5 rounded-2xl px-4 py-3">
              <button
                type="button"
                  onClick={() => setCurrentPage(Math.max(1, safePage - 1))}
                disabled={safePage === 1}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-white/5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                上一页
              </button>
              <div className="text-xs text-zinc-400">
                第 {safePage} / {totalPages} 页
              </div>
              <button
                type="button"
                onClick={() => setCurrentPage(Math.min(totalPages, safePage + 1))}
                disabled={safePage === totalPages}
                className="px-3 py-1.5 rounded-lg bg-zinc-950 border border-white/5 text-xs text-zinc-300 hover:bg-zinc-900 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                下一页
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-4 space-y-6 sticky top-8">
          {/* 库统计 */}
          <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8 shadow-xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <TvIcon className="w-20 h-20 text-white" />
             </div>
             <h3 className="text-base font-bold text-zinc-300 mb-8 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse shadow-[0_0_10px_rgba(59,130,246,0.5)]"></span>
                库统计
             </h3>
             <div className="grid grid-cols-2 gap-6">
                <div className="p-5 rounded-2xl bg-blue-500/5 border border-blue-500/10 hover:bg-blue-500/10 transition-all group/stat">
                  <p className="text-xs text-blue-400 font-bold uppercase mb-3 tracking-wider group-hover/stat:translate-x-1 transition-transform">还没看完</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold text-white tracking-tighter leading-none">{items.filter(i => i.status !== 'completed').length}</p>
                    <p className="text-xs text-zinc-500 font-bold">部</p>
                  </div>
                </div>
                <div className="p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/10 hover:bg-emerald-500/10 transition-all group/stat">
                  <p className="text-xs text-emerald-400 font-bold uppercase mb-3 tracking-wider group-hover/stat:translate-x-1 transition-transform">已经看完</p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold text-white tracking-tighter leading-none">{items.filter(i => i.status === 'completed').length}</p>
                    <p className="text-xs text-zinc-500 font-bold">部</p>
                  </div>
                </div>
             </div>
             
             <div className="mt-8 pt-8 border-t border-white/5 space-y-6">
                <div className="flex justify-between items-center group/info">
                    <span className="text-sm font-medium text-zinc-500 group-hover/info:text-zinc-300 transition-colors">累计观看剧集</span>
                    <span className="text-lg font-mono font-bold text-zinc-200 tracking-tight">
                        {items.reduce((acc, curr) => acc + (Number(curr.progress) || 0), 0)} <span className="text-[10px] text-zinc-600 ml-1 uppercase">Episodes</span>
                    </span>
                </div>
                <div className="flex justify-between items-center group/info">
                    <span className="text-sm font-medium text-zinc-500 group-hover/info:text-zinc-300 transition-colors">累计时间估计</span>
                    <span className="text-lg font-mono font-bold text-blue-400 tracking-tight">
                        {(() => {
                            const totalMinutes = items.reduce((acc, curr) => {
                                const prog = Number(curr.progress) || 0;
                                const duration = Number(curr.durationMinutes) || 24; // 默认24分钟
                                return acc + (prog * duration);
                            }, 0);
                            const hours = Math.floor(totalMinutes / 60);
                            const days = (hours / 24).toFixed(1);
                            return `${hours}h / ${days}d`;
                        })()}
                    </span>
                </div>
             </div>
          </div>

          {/* 风格偏好 */}
          <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-8 shadow-xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <TagIcon className="w-20 h-20 text-white" />
             </div>
             <h3 className="text-base font-bold text-zinc-300 mb-8 uppercase tracking-widest flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]"></span>
                风格偏好
             </h3>
             <div className="flex flex-wrap gap-2.5 relative z-10">
              {tagPreferences.map(({ tag, count }) => {
                const isActive = tagFilter === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTagFilter(tag)}
                    className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all group/tag ${
                      isActive
                        ? 'bg-purple-500/15 border-purple-500/40'
                        : 'bg-zinc-950/50 border-white/5 hover:border-purple-500/30 hover:bg-purple-500/5'
                    }`}
                  >
                    <span className={`text-xs font-medium transition-colors ${isActive ? 'text-purple-200' : 'text-zinc-400 group-hover/tag:text-purple-300'}`}>{tag}</span>
                    <span className={`text-[10px] font-mono ${isActive ? 'text-purple-300/80' : 'text-zinc-600 group-hover/tag:text-purple-500/50'}`}>{count}</span>
                  </button>
                );
              })}
              {!tagPreferences.length && <div className="text-xs text-zinc-500">标签还在累计中。</div>}
             </div>
          </div>

           {/* 最近观看 */}
          <div className="bg-zinc-900/50 backdrop-blur-xl border border-white/5 rounded-2xl p-6 shadow-xl relative overflow-hidden group">
             <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                <FireIcon className="w-16 h-16 text-white" />
             </div>
             <h3 className="text-sm font-bold text-zinc-400 mb-6 uppercase tracking-widest flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
               最近观看
             </h3>
             <div className="space-y-3 relative z-10">
               {recentWatchItems.length > 0 ? recentWatchItems.map(item => (
                    <div 
                        key={item.id} 
                        onClick={() => isAdmin && startEdit(item)}
                        className={`flex items-center gap-3 p-2.5 -mx-2 rounded-xl transition-all ${isAdmin ? 'cursor-pointer hover:bg-white/5 hover:translate-x-1' : ''} group/item`}
                    >
                        <div className="w-10 h-10 rounded-lg overflow-hidden bg-zinc-800 flex-shrink-0 border border-white/5 group-hover/item:border-blue-500/30 transition-colors shadow-lg relative">
                            {item.coverUrl ? (
                                <Image src={item.coverUrl} fill sizes="40px" className="object-cover transition-transform group-hover/item:scale-110" alt="" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-[10px] text-zinc-600 uppercase">IMG</div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-zinc-200 truncate group-hover/item:text-blue-400 transition-colors uppercase tracking-tight">{item.title}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5 flex items-center gap-2">
                            <span className="font-medium">看到第 {item.progress} 集</span>
                                <span className="w-1 h-1 rounded-full bg-zinc-800"></span>
                            <span className="italic font-mono">{formatRecentWatchDate(item.lastWatchedAt)}</span>
                            </div>
                        </div>
                        {isAdmin && (
                            <div className="opacity-0 group-hover/item:opacity-100 transition-opacity">
                                <div className="p-1 rounded-md bg-blue-500/10 text-blue-400">
                                    <SparklesIcon className="w-3 h-3" />
                                </div>
                            </div>
                        )}
                    </div>
                  )) : (
                    <div className="text-sm text-zinc-500">暂无观看记录，先用“看一集”或 AI 录入补几条历史。</div>
                  )}
             </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="删除番剧"
        message={`确定要删除「${deleteConfirm?.title || ''}」吗？删除后其观看历史也会一并清除，无法恢复。`}
        confirmText="确认删除"
        cancelText="再想想"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirm(null)}
      />
    </main>
  );
}

