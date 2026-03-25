import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/auth';
import { getAnimeRecord, updateAnimeRecord, CreateAnimeDTO } from '@/lib/anime';
import { enrichAnimeInput } from '@/lib/anime-enrichment';
import metadataMergePolicy from '@/lib/metadata/merge-policy.js';

type MetadataPatchInput = Partial<CreateAnimeDTO>;

const { DEFAULT_METADATA_FIELDS, buildMetadataPatch } = metadataMergePolicy as unknown as {
  DEFAULT_METADATA_FIELDS: string[];
  buildMetadataPatch: (
    current: Partial<CreateAnimeDTO>,
    candidateLike: MetadataPatchInput | { candidate: MetadataPatchInput; source?: Record<string, string> },
    options?: {
      fields?: string[];
      force?: boolean;
      allowReplaceFilledCover?: boolean;
      allowCastAliasAugment?: boolean;
      allowIsFinishedUpgrade?: boolean;
    }
  ) => { patch: Partial<CreateAnimeDTO>; sources: Record<string, string> };
};

type SessionUser = {
  role?: string;
};

function parseId(idParam: string) {
  const id = Number(idParam);
  if (!Number.isFinite(id) || id <= 0) {
    return null;
  }
  return id;
}

export async function POST(
  _request: Request,
  context: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if ((session?.user as SessionUser | undefined)?.role !== 'admin') {
    return NextResponse.json({ error: '只有管理员可以执行 AI 补全' }, { status: 403 });
  }

  const id = parseId(context.params.id);
  if (!id) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  const record = await getAnimeRecord(id);
  if (!record) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const baseInput: CreateAnimeDTO = {
    title: record.title,
    originalTitle: record.originalTitle,
    coverUrl: record.coverUrl,
    status: record.status,
    score: record.score,
    progress: record.progress,
    totalEpisodes: record.totalEpisodes,
    durationMinutes: record.durationMinutes,
    notes: record.notes,
    tags: record.tags,
    cast: record.cast,
    castAliases: record.castAliases,
    summary: record.summary,
    startDate: record.startDate,
    endDate: record.endDate,
    premiereDate: record.premiereDate,
    isFinished: record.isFinished,
  };

  const enriched = await enrichAnimeInput(baseInput, {
    mode: 'create',
    originalUserTitle: record.title,
  });

  const patch: Partial<CreateAnimeDTO> = {};
  const metadataPatch = buildMetadataPatch(record, enriched, {
    fields: DEFAULT_METADATA_FIELDS,
    force: true,
    allowReplaceFilledCover: true,
    allowCastAliasAugment: true,
    allowIsFinishedUpgrade: true,
  }).patch;

  if (enriched.title && enriched.title !== record.title) {
    patch.title = enriched.title;
  }

  // 保护用户手动填写的字段，不被 AI 覆盖
  const userFields: Array<keyof CreateAnimeDTO> = ['status', 'progress', 'notes', 'startDate', 'endDate'];
  for (const field of userFields) {
    delete metadataPatch[field];
  }
  // score 只在用户未设置时才补充
  if (record.score !== undefined && record.score !== null) {
    delete metadataPatch.score;
  }

  Object.assign(patch, metadataPatch);

  const appliedFields = Object.keys(patch);
  if (appliedFields.length === 0) {
    return NextResponse.json({ ok: true, appliedFields: [], entry: record });
  }

  const updated = await updateAnimeRecord(id, patch);
  if (!updated) {
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, appliedFields, entry: updated });
}
