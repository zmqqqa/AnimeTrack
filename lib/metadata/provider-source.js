const USER_AGENT = 'PersonalAnimeWeb/1.0 (https://github.com/yourname/personal-web)';
const MAX_CAST_MEMBERS = 10;
const JIKAN_RESULT_LIMIT = 5;
const MIN_JIKAN_MATCH_SCORE = 60;
const FETCH_TIMEOUT_MS = 8000;
const SEASON_PATTERN = /第([一二三四五六七八九十0-9]+)季|Season ([0-9]+)|S([0-9]+)/i;
const FOLLOW_UP_SEASON_PATTERN = /第[二三四五六七八九十2-9]+季|Season [2-9]|S[2-9]+/i;

function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeDate(value) {
  if (!value) {
    return undefined;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeTitleToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s\-_:：·・'"`~!！?？,，.。()/\\\[\]【】]/g, '')
    .trim();
}

function containsCjkText(value) {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(String(value || ''));
}

function scoreTitleSimilarity(queryToken, candidateToken) {
  if (!queryToken || !candidateToken) {
    return 0;
  }

  if (queryToken === candidateToken) {
    return 120;
  }

  if (candidateToken.includes(queryToken) || queryToken.includes(candidateToken)) {
    const minLength = Math.min(queryToken.length, candidateToken.length);
    const maxLength = Math.max(queryToken.length, candidateToken.length);
    const ratio = maxLength > 0 ? minLength / maxLength : 0;
    return Math.round(70 + ratio * 20);
  }

  let commonPrefix = 0;
  while (
    commonPrefix < queryToken.length &&
    commonPrefix < candidateToken.length &&
    queryToken[commonPrefix] === candidateToken[commonPrefix]
  ) {
    commonPrefix += 1;
  }

  if (commonPrefix >= Math.min(4, queryToken.length, candidateToken.length)) {
    return 40 + commonPrefix;
  }

  return 0;
}

function buildJikanTitleCandidates(anime) {
  return uniqueValues([
    anime?.title,
    anime?.title_english,
    anime?.title_japanese,
    ...(Array.isArray(anime?.title_synonyms) ? anime.title_synonyms : []),
    ...(Array.isArray(anime?.titles)
      ? anime.titles.map((entry) => (typeof entry?.title === 'string' ? entry.title : ''))
      : []),
  ]);
}

function scoreJikanAnime(anime, queryCandidates) {
  const animeTitles = buildJikanTitleCandidates(anime);
  let bestScore = 0;

  for (const query of queryCandidates) {
    const queryToken = normalizeTitleToken(query);
    if (!queryToken) {
      continue;
    }

    for (const animeTitle of animeTitles) {
      const candidateToken = normalizeTitleToken(animeTitle);
      const score = scoreTitleSimilarity(queryToken, candidateToken);
      if (score > bestScore) {
        bestScore = score;
      }
    }
  }

  return bestScore;
}

function setFieldValue(result, providerMeta, field, value, site, query, extra = {}) {
  if (value === undefined || value === null || value === '') {
    return;
  }

  if (result[field] !== undefined && result[field] !== null && result[field] !== '') {
    return;
  }

  result[field] = value;
  providerMeta.fieldSources[field] = {
    site,
    query: query || null,
    ...extra,
  };
}

function pickBangumiSubject(subjects, title) {
  let subject = subjects.find((item) => item.name_cn === title || item.name === title);

  if (!subject) {
    const hasSeasonInTitle = SEASON_PATTERN.test(title);
    if (!hasSeasonInTitle) {
      subject = subjects.find((item) => {
        const itemName = item.name_cn || item.name || '';
        return !FOLLOW_UP_SEASON_PATTERN.test(itemName);
      });
    } else {
      const seasonQuery = title.match(SEASON_PATTERN)?.[0];
      if (seasonQuery) {
        subject = subjects.find((item) => {
          const itemName = item.name_cn || item.name || '';
          return itemName.includes(seasonQuery);
        });
      }
    }
  }

  return subject || subjects[0] || null;
}

async function fetchBangumiSubject(title) {
  const res = await fetchWithTimeout(`https://api.bgm.tv/search/subject/${encodeURIComponent(title)}?type=2&responseGroup=small&max_results=5`, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  if (!data?.list || !Array.isArray(data.list) || data.list.length === 0) {
    return null;
  }

  return pickBangumiSubject(data.list, title);
}

async function fetchBangumiSubjectDetail(subjectId) {
  try {
    const res = await fetchWithTimeout(`https://api.bgm.tv/subject/${subjectId}?responseGroup=large`, {
      headers: {
        'User-Agent': USER_AGENT,
      },
    });

    if (!res.ok) {
      return null;
    }

    return res.json();
  } catch (error) {
    console.error('Bangumi subject detail fetch failed', error);
    return null;
  }
}

function extractBangumiCast(detail) {
  if (!Array.isArray(detail?.crt)) {
    return [];
  }

  return uniqueValues(
    detail.crt.flatMap((character) =>
      Array.isArray(character?.actors)
        ? character.actors.map((actor) => actor?.name_cn || actor?.name)
        : []
    )
  ).slice(0, MAX_CAST_MEMBERS);
}

async function searchJikanAnime(query) {
  const res = await fetchWithTimeout(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(query)}&limit=${JIKAN_RESULT_LIMIT}`);
  if (!res.ok) {
    return [];
  }

  const data = await res.json();
  if (!Array.isArray(data?.data) || data.data.length === 0) {
    return [];
  }

  return data.data;
}

async function fetchBestJikanAnime(queryCandidates) {
  const dedupedQueries = uniqueValues(queryCandidates);
  const seen = new Map();

  for (const query of dedupedQueries) {
    const animes = await searchJikanAnime(query);

    for (const anime of animes) {
      const key = anime?.mal_id ? String(anime.mal_id) : buildJikanTitleCandidates(anime)[0] || JSON.stringify(anime);
      const score = scoreJikanAnime(anime, dedupedQueries);
      const current = seen.get(key);

      if (!current || score > current.score) {
        seen.set(key, {
          anime,
          query,
          score,
        });
      }
    }
  }

  const ranked = Array.from(seen.values()).sort((left, right) => right.score - left.score);
  const best = ranked[0] || null;

  if (!best || best.score < MIN_JIKAN_MATCH_SCORE) {
    return null;
  }

  return best;
}

async function fetchJikanCast(malId) {
  try {
    const res = await fetchWithTimeout(`https://api.jikan.moe/v4/anime/${malId}/characters`);
    if (!res.ok) {
      return [];
    }

    const data = await res.json();
    if (!Array.isArray(data?.data)) {
      return [];
    }

    const cast = uniqueValues(
      data.data.flatMap((entry) => {
        const allVoiceActors = Array.isArray(entry?.voice_actors) ? entry.voice_actors : [];
        const japaneseVoiceActors = allVoiceActors.filter((actor) => actor?.language === 'Japanese');
        const preferredActors = japaneseVoiceActors.length > 0 ? japaneseVoiceActors : allVoiceActors;
        return preferredActors.map((actor) => actor?.person?.name);
      })
    );

    return cast.slice(0, MAX_CAST_MEMBERS);
  } catch (error) {
    console.error('Jikan cast fetch failed', error);
    return [];
  }
}

async function fetchAnimeMetadata(title) {
  const normalizedTitle = String(title || '').trim();
  if (!normalizedTitle) {
    return null;
  }

  const result = {};
  const providerMeta = {
    fieldSources: {},
    bangumiQuery: normalizedTitle,
    bangumiSubjectId: null,
    jikanQuery: null,
    jikanScore: null,
    selectedJikanTitle: null,
  };
  let found = false;

  console.log(`[AnimeProvider] Searching metadata for: ${normalizedTitle}`);

  try {
    const bangumiSubject = await fetchBangumiSubject(normalizedTitle);

    if (bangumiSubject) {
      providerMeta.bangumiSubjectId = Number(bangumiSubject.id) || null;

      const bgmCover = bangumiSubject.images?.large || bangumiSubject.images?.common || bangumiSubject.images?.medium;
      if (bgmCover) {
        setFieldValue(result, providerMeta, 'coverUrl', String(bgmCover).replace('http://', 'https://'), 'bangumi', normalizedTitle);
      }

      if (bangumiSubject.name_cn) {
        setFieldValue(result, providerMeta, 'title', bangumiSubject.name_cn, 'bangumi', normalizedTitle);
      }

      if (bangumiSubject.name) {
        setFieldValue(result, providerMeta, 'originalTitle', bangumiSubject.name, 'bangumi', normalizedTitle);
      }

      const bangumiSubjectDate = normalizeDate(bangumiSubject.date || bangumiSubject.air_date);
      if (bangumiSubjectDate) {
        setFieldValue(result, providerMeta, 'premiereDate', bangumiSubjectDate, 'bangumi', normalizedTitle);
      }

      if (bangumiSubject.id) {
        const bangumiDetail = await fetchBangumiSubjectDetail(Number(bangumiSubject.id));

        const bangumiDetailDate = normalizeDate(bangumiDetail?.date || bangumiDetail?.air_date);
        if (bangumiDetailDate) {
          setFieldValue(result, providerMeta, 'premiereDate', bangumiDetailDate, 'bangumi', normalizedTitle);
        }

        const bangumiCast = extractBangumiCast(bangumiDetail);
        if (bangumiCast.length > 0) {
          setFieldValue(result, providerMeta, 'cast', bangumiCast, 'bangumi', normalizedTitle);
          setFieldValue(result, providerMeta, 'castAliases', bangumiCast, 'bangumi', normalizedTitle);
        }
      }

      found = true;
    }
  } catch (error) {
    console.error('Bangumi search failed', error);
  }

  if (!result.coverUrl || !result.totalEpisodes || !result.description || !result.cast || result.cast.length === 0 || !result.premiereDate) {
    try {
      const jikanQueryCandidates = uniqueValues([
        result.originalTitle,
        containsCjkText(result.title) ? null : result.title,
        containsCjkText(normalizedTitle) ? null : normalizedTitle,
      ]);

      const jikanResult = await fetchBestJikanAnime([
        ...jikanQueryCandidates,
      ]);

      const anime = jikanResult?.anime || null;

      if (anime) {
        providerMeta.jikanQuery = jikanResult?.query || normalizedTitle;
        providerMeta.jikanScore = jikanResult?.score ?? null;
        providerMeta.selectedJikanTitle = anime.title || anime.title_japanese || anime.title_english || null;

        if (!result.coverUrl) {
          const imageUrl = anime.images?.jpg?.large_image_url || anime.images?.jpg?.image_url;
          if (imageUrl) {
            setFieldValue(result, providerMeta, 'coverUrl', imageUrl, 'jikan', providerMeta.jikanQuery, {
              score: providerMeta.jikanScore,
              selectedTitle: providerMeta.selectedJikanTitle,
            });
          }
        }

        if (!result.totalEpisodes && anime.episodes) {
          setFieldValue(result, providerMeta, 'totalEpisodes', anime.episodes, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        if (!result.description && anime.synopsis) {
          setFieldValue(result, providerMeta, 'description', anime.synopsis, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        if (!result.score && anime.score) {
          setFieldValue(result, providerMeta, 'score', anime.score, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        if (anime.title_japanese) {
          setFieldValue(result, providerMeta, 'originalTitle', anime.title_japanese, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        if (anime.airing !== undefined) {
          setFieldValue(result, providerMeta, 'isFinished', !anime.airing, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        const airedDate = normalizeDate(anime.aired?.from);
        if (airedDate) {
          setFieldValue(result, providerMeta, 'premiereDate', airedDate, 'jikan', providerMeta.jikanQuery, {
            score: providerMeta.jikanScore,
            selectedTitle: providerMeta.selectedJikanTitle,
          });
        }

        if ((!result.cast || result.cast.length === 0) && anime.mal_id) {
          const jikanCast = await fetchJikanCast(Number(anime.mal_id));
          if (jikanCast.length > 0) {
            setFieldValue(result, providerMeta, 'cast', jikanCast, 'jikan', providerMeta.jikanQuery, {
              score: providerMeta.jikanScore,
              selectedTitle: providerMeta.selectedJikanTitle,
            });
            setFieldValue(result, providerMeta, 'castAliases', jikanCast, 'jikan', providerMeta.jikanQuery, {
              score: providerMeta.jikanScore,
              selectedTitle: providerMeta.selectedJikanTitle,
            });
          }
        }

        found = true;
      }
    } catch (error) {
      console.error('Jikan search failed', error);
    }
  }

  if (!found) {
    return null;
  }

  result.__providerMeta = providerMeta;
  return result;
}

function normalizeQueries(queries) {
  const rawQueries = Array.isArray(queries[0]) && queries.length === 1 ? queries[0] : queries;
  return uniqueValues(rawQueries);
}

async function fetchAnimeMetadataByQueriesDetailed(...queries) {
  const dedupedQueries = normalizeQueries(queries);

  for (const query of dedupedQueries) {
    const metadata = await fetchAnimeMetadata(query);
    if (metadata) {
      return { metadata, query };
    }
  }

  return { metadata: null, query: dedupedQueries[0] || '' };
}

async function fetchAnimeMetadataByQueries(...queries) {
  const result = await fetchAnimeMetadataByQueriesDetailed(...queries);
  return result.metadata;
}

module.exports = {
  fetchAnimeMetadata,
  fetchAnimeMetadataByQueries,
  fetchAnimeMetadataByQueriesDetailed,
};