const fs = require("fs");
const path = require("path");
const { createClient } = require("./naverSearchAdClient");

function loadLocalEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) return;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms))
  ]);
}

async function main() {
  loadLocalEnv();
  const client = createClient();
  const campaigns = await withTimeout(client.get("/ncc/campaigns"), 20000);
  const adGroups = await withTimeout(client.get("/ncc/adgroups"), 20000).catch((error) => ({ error: error.message, status: error.status || null }));
  const keywords = await withTimeout(client.get("/ncc/keywords"), 20000).catch((error) => ({ error: error.message, status: error.status || null }));
  const firstAdGroupId = Array.isArray(adGroups) && adGroups[0] ? adGroups[0].nccAdgroupId : null;
  const firstAdGroupKeywords = firstAdGroupId
    ? await withTimeout(client.get("/ncc/keywords", { query: { nccAdgroupId: firstAdGroupId } }), 20000).catch((error) => ({ error: error.message, status: error.status || null, detail: error.payload || null }))
    : [];
  const firstKeywordId = Array.isArray(firstAdGroupKeywords) && firstAdGroupKeywords[0] ? firstAdGroupKeywords[0].nccKeywordId : null;
  const firstCampaignId = Array.isArray(campaigns) && campaigns[0] ? campaigns[0].nccCampaignId : null;
  const fields = JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ctr", "cpc"]);
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const campaignStats = firstCampaignId
    ? await withTimeout(client.get("/stats", {
      query: {
        ids: JSON.stringify([firstCampaignId]),
        fields,
        timeRange: JSON.stringify({ since: yesterday, until: today }),
        timeIncrement: "1"
      }
    }), 20000).catch((error) => ({ error: error.message, status: error.status || null, detail: error.payload || null }))
    : [];
  const campaignStatsPreset = firstCampaignId
    ? await withTimeout(client.get("/stats", {
      query: {
        ids: JSON.stringify([firstCampaignId]),
        fields,
        datePreset: "last7days",
        timeIncrement: "1"
      }
    }), 20000).catch((error) => ({ error: error.message, status: error.status || null, detail: error.payload || null }))
    : [];
  const stats = firstKeywordId
    ? await withTimeout(client.get("/stats", {
      query: {
        ids: JSON.stringify([firstKeywordId]),
        fields,
        timeRange: JSON.stringify({ since: yesterday, until: today }),
        timeIncrement: "1"
      }
    }), 20000).catch((error) => ({ error: error.message, status: error.status || null, detail: error.payload || null }))
    : [];
  console.log(JSON.stringify({
    ok: true,
    campaigns: Array.isArray(campaigns) ? campaigns.length : 0,
    adGroups: Array.isArray(adGroups) ? adGroups.length : adGroups,
    keywords: Array.isArray(keywords) ? keywords.length : keywords,
    firstAdGroupKeywords: Array.isArray(firstAdGroupKeywords) ? firstAdGroupKeywords.length : firstAdGroupKeywords,
    statsDateRange: { since: yesterday, until: today },
    campaignStatsType: Array.isArray(campaignStats) ? "array" : typeof campaignStats,
    campaignStatsCount: Array.isArray(campaignStats) ? campaignStats.length : Array.isArray(campaignStats?.data) ? campaignStats.data.length : null,
    campaignStatsKeys: campaignStats && typeof campaignStats === "object" && !Array.isArray(campaignStats) ? Object.keys(campaignStats).slice(0, 12) : [],
    campaignStatsError: campaignStats?.error || null,
    campaignStatsDetail: campaignStats?.detail || null,
    campaignStatsPresetCount: Array.isArray(campaignStatsPreset) ? campaignStatsPreset.length : Array.isArray(campaignStatsPreset?.data) ? campaignStatsPreset.data.length : null,
    campaignStatsPresetError: campaignStatsPreset?.error || null,
    campaignStatsPresetDetail: campaignStatsPreset?.detail || null,
    firstKeywordStatsType: Array.isArray(stats) ? "array" : typeof stats,
    firstKeywordStatsCount: Array.isArray(stats) ? stats.length : Array.isArray(stats?.data) ? stats.data.length : null,
    firstKeywordStatsKeys: stats && typeof stats === "object" && !Array.isArray(stats) ? Object.keys(stats).slice(0, 12) : [],
    firstKeywordStatsError: stats?.error || null,
    firstKeywordStatsDetail: stats?.detail || null,
    firstCampaignFields: Array.isArray(campaigns) && campaigns[0] ? Object.keys(campaigns[0]).slice(0, 12) : [],
    firstAdGroupFields: Array.isArray(adGroups) && adGroups[0] ? Object.keys(adGroups[0]).slice(0, 12) : [],
    firstKeywordFields: Array.isArray(keywords) && keywords[0] ? Object.keys(keywords[0]).slice(0, 12) : []
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    status: error.status || null,
    message: error.message,
    detail: error.payload || null
  }));
  process.exit(1);
});
