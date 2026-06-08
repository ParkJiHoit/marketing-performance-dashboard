const http = require("http");
const fs = require("fs");
const path = require("path");
const {
  createClient,
  normalizeCampaign,
  normalizeAdGroup,
  normalizeKeyword,
  normalizeStat,
  normalizeSearchTerm,
  flattenStatsResponse
} = require("./naverSearchAdClient");

const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 4173);
const syncCache = new Map();
const SYNC_CACHE_TTL_MS = 3 * 60 * 1000;

function loadLocalEnv() {
  const envPath = path.join(rootDir, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadLocalEnv();

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=UTF-8" });
  res.end(JSON.stringify(payload));
}

function getCachedSync(key) {
  const cached = syncCache.get(key);
  if (!cached) return null;
  if (cached.payload && Date.now() - cached.createdAt < SYNC_CACHE_TTL_MS) return cached.payload;
  if (cached.promise) return cached.promise;
  syncCache.delete(key);
  return null;
}

function setSyncPromise(key, promise) {
  syncCache.set(key, { promise, createdAt: Date.now() });
  promise
    .then((payload) => syncCache.set(key, { payload, createdAt: Date.now() }))
    .catch(() => syncCache.delete(key));
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function groupBy(items, keyGetter) {
  return items.reduce((acc, item) => {
    const key = keyGetter(item) || "unknown";
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

async function mapLimit(items, limit, task) {
  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function fetchStatsById(client, id, { fields, timeRange, targetField }) {
  if (!id || !timeRange) return [];
  const response = await client.get("/stats", {
    query: {
      id,
      fields,
      timeRange,
      timeIncrement: "1"
    }
  }).catch(() => null);

  if (!response) return [];
  return flattenStatsResponse(response).map((row) => {
    const normalized = normalizeStat({ ...row, id });
    return {
      ...normalized,
      [targetField]: id
    };
  });
}

async function fetchStatsForEntities(client, entities, { fields, timeRange, idGetter, targetField, concurrency = 8 }) {
  if (!entities.length || !timeRange) return [];
  const nested = await mapLimit(entities, concurrency, (entity) =>
    fetchStatsById(client, idGetter(entity), { fields, timeRange, targetField })
  );
  return nested.flat();
}

async function fetchStatsByIds(client, ids, { fields, timeRange, targetField, concurrency = 8 }) {
  if (!ids.length || !timeRange) return [];
  return fetchStatsForEntities(client, [...new Set(ids)].filter(Boolean), {
    fields,
    timeRange,
    idGetter: (id) => id,
    targetField,
    concurrency
  });
}

function distributeAdGroupStatsToKeywords(adGroupStats, keywordsByAdGroup) {
  return adGroupStats.flatMap((stat) => {
    const keywords = keywordsByAdGroup[stat.adGroupId] || [];
    if (!keywords.length) return [];
    const weight = 1 / keywords.length;
    return keywords.map((keyword) => ({
      ...stat,
      keywordId: keyword.keywordId,
      impression: Math.round(stat.impression * weight),
      click: Math.round(stat.click * weight),
      cost: Math.round(stat.cost * weight),
      conversion: Math.round(stat.conversion * weight),
      conversionValue: Math.round(stat.conversionValue * weight)
    }));
  });
}

async function collectNaverSaData(url) {
  const client = createClient();
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");
  const maxAdGroups = Number(url.searchParams.get("maxAdGroups") || 25);
  const maxKeywords = Number(url.searchParams.get("maxKeywords") || 100);
  const timeRange = startDate && endDate ? JSON.stringify({ since: startDate, until: endDate }) : undefined;

  const campaigns = (await client.get("/ncc/campaigns")).map(normalizeCampaign);
  const adGroups = (await client.get("/ncc/adgroups")).map(normalizeAdGroup);
  const adGroupsForKeywordFetch = adGroups.slice(0, maxAdGroups);
  const keywordsNested = await Promise.all(adGroupsForKeywordFetch.map((adGroup) =>
    client.get("/ncc/keywords", { query: { nccAdgroupId: adGroup.adGroupId } }).catch(() => [])
  ));
  const keywords = keywordsNested.flat().map(normalizeKeyword).slice(0, maxKeywords);

  const fields = JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ctr", "cpc", "avgRnk", "ccnt", "crto", "convAmt", "ror", "cpConv"]);
  const campaignStats = await fetchStatsForEntities(client, campaigns, {
    fields,
    timeRange,
    idGetter: (campaign) => campaign.campaignId,
    targetField: "campaignId"
  });
  const adGroupStats = await fetchStatsForEntities(client, adGroups.slice(0, maxAdGroups), {
    fields,
    timeRange,
    idGetter: (adGroup) => adGroup.adGroupId,
    targetField: "adGroupId"
  });
  const campaignTypeById = Object.fromEntries(campaigns.map((campaign) => [campaign.campaignId, campaign.campaignType || "unknown"]));
  const keywordsByCampaignType = groupBy(keywords, (keyword) => campaignTypeById[keyword.campaignId]);
  const keywordStats = (await Promise.all(Object.values(keywordsByCampaignType).map((group) =>
    fetchStatsByIds(client, group.map((keyword) => keyword.keywordId), {
      fields,
      timeRange,
      targetField: "keywordId",
      concurrency: 8
    })
  ))).flat();
  const keywordsByAdGroup = groupBy(keywords, (keyword) => keyword.adGroupId);
  const stats = keywordStats.length ? keywordStats : distributeAdGroupStatsToKeywords(adGroupStats, keywordsByAdGroup);

  const searchTermsNested = await Promise.all(adGroupsForKeywordFetch.map((adGroup) =>
    client.get("/stats", {
      query: {
        ids: JSON.stringify([adGroup.adGroupId]),
        fields,
        timeRange,
        timeIncrement: "1",
        statType: "NPLA_SCH_KEYWORD"
      }
    }).catch(() => [])
  ));
  const searchTerms = searchTermsNested.flatMap((result) => Array.isArray(result) ? result : result?.data || []).map(normalizeSearchTerm);

  return {
    meta: {
      mode: "api",
      generatedAt: new Date().toISOString(),
      conversionTrackingEnabled: stats.some((stat) => stat.conversion > 0),
      statSource: keywordStats.length ? "keyword" : adGroupStats.length ? "adGroup-distributed" : campaignStats.length ? "campaign" : "none",
      campaignStatsCount: campaignStats.length,
      adGroupStatsCount: adGroupStats.length,
      keywordStatsCount: keywordStats.length,
      maxAdGroups,
      maxKeywords,
      partial: adGroups.length > maxAdGroups || keywords.length >= maxKeywords
    },
    campaigns,
    adGroups,
    keywords,
    stats,
    searchTerms,
    creatives: [],
    creativeStats: []
  };
}

function serveStatic(req, res) {
  const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const filePath = path.join(rootDir, requestPath === "/" ? "index.html" : requestPath);
  if (!filePath.startsWith(rootDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ext = path.extname(filePath);
  const type = {
    ".html": "text/html; charset=UTF-8",
    ".css": "text/css; charset=UTF-8",
    ".js": "text/javascript; charset=UTF-8",
    ".png": "image/png"
  }[ext] || "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache"
  });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === "/api/naver-sa/sync") {
    try {
      const cacheKey = url.searchParams.toString();
      let payload = getCachedSync(cacheKey);
      if (!payload) {
        const promise = collectNaverSaData(url);
        setSyncPromise(cacheKey, promise);
        payload = await promise;
      } else if (typeof payload.then === "function") {
        payload = await payload;
      }
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, error.status || 500, {
        message: error.status === 401 || error.status === 403
          ? "네이버 SA API 인증에 실패했습니다. 환경변수와 API 권한을 확인해주세요."
          : "네이버 SA 데이터를 불러오지 못했습니다. API 인증 정보 또는 요청 범위를 확인해주세요.",
        detail: error.payload || error.message
      });
    }
    return;
  }
  serveStatic(req, res);
});

server.listen(port, () => {
  console.log(`Marketing dashboard server listening on http://localhost:${port}`);
});
