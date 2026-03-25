
"use client";

import { useState, useEffect, useMemo } from 'react';
import { WatchHistoryRecord, ParsedWatchHistory } from '@/lib/dashboard-types';
import { readSessionCache, writeSessionCache } from '@/lib/hooks-shared';

export function useHistoryData() {
    const [watchHistory, setWatchHistory] = useState<WatchHistoryRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const parsedHistory = useMemo<ParsedWatchHistory[]>(() => {
        return watchHistory.map(h => {
            const d = new Date(h.watchedAt);
            return {
                ...h,
                dateObj: d,
                dateStr: h.watchedAt.split('T')[0],
                hour: d.getHours(),
                month: d.getMonth(),
                year: d.getFullYear()
            };
        });
    }, [watchHistory]);

    useEffect(() => {
        const cached = readSessionCache<WatchHistoryRecord[]>('dashboard-history');
        if (cached) {
            setWatchHistory(cached);
            setIsLoading(false);
            return;
        }

        const load = async () => {
            setIsRefreshing(true);
            try {
                const res = await fetch('/api/history?days=370&limit=800');
                const data = await res.json();
                const entries = Array.isArray(data?.entries) ? data.entries : [];
                setWatchHistory(entries);
                writeSessionCache('dashboard-history', entries);
            } catch (err) {
                console.error('Failed to fetch history data', err);
            } finally {
                setIsLoading(false);
                setIsRefreshing(false);
            }
        };

        load();
    }, []);

    return { watchHistory, parsedHistory, isLoading, isRefreshing };
}
