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

async function tryStats(client, label, query) {
  try {
    const response = await client.get("/stats", { query });
    const data = Array.isArray(response) ? response : response?.data || [];
    return {
      label,
      ok: true,
      topLevelType: Array.isArray(response) ? "array" : typeof response,
      count: data.length,
      keys: response && typeof response === "object" && !Array.isArray(response) ? Object.keys(response).slice(0, 8) : [],
      firstKeys: data[0] ? Object.keys(data[0]).slice(0, 12) : []
    };
  } catch (error) {
    return {
      label,
      ok: false,
      status: error.status || null,
      message: error.message,
      detail: error.payload || null
    };
  }
}

async function main() {
  loadLocalEnv();
  const client = createClient();
  const campaigns = await client.get("/ncc/campaigns");
  const campaign = campaigns.find((item) => item.status === "ELIGIBLE" || item.status === "ENABLED") || campaigns[0];
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const fields = JSON.stringify(["impCnt", "clkCnt", "salesAmt", "ctr", "cpc"]);
  const base = {
    fields,
    timeRange: JSON.stringify({ since: yesterday, until: today })
  };
  const results = [];
  for (const query of [
    ["id no increment", { ...base, id: campaign.nccCampaignId }],
    ["id DAILY", { ...base, id: campaign.nccCampaignId, timeIncrement: "DAILY" }],
    ["id 1", { ...base, id: campaign.nccCampaignId, timeIncrement: "1" }],
    ["ids json no increment", { ...base, ids: JSON.stringify([campaign.nccCampaignId]) }],
    ["ids json DAILY", { ...base, ids: JSON.stringify([campaign.nccCampaignId]), timeIncrement: "DAILY" }],
    ["ids json 1", { ...base, ids: JSON.stringify([campaign.nccCampaignId]), timeIncrement: "1" }],
    ["id datePreset yesterday", { fields, id: campaign.nccCampaignId, datePreset: "yesterday" }],
    ["id datePreset last7days", { fields, id: campaign.nccCampaignId, datePreset: "last7days" }]
  ]) {
    results.push(await tryStats(client, query[0], query[1]));
  }
  console.log(JSON.stringify({
    campaign: {
      id: campaign.nccCampaignId,
      name: campaign.name,
      campaignTp: campaign.campaignTp,
      status: campaign.status,
      totalChargeCost: campaign.totalChargeCost
    },
    range: { since: yesterday, until: today },
    results
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, message: error.message, status: error.status || null, detail: error.payload || null }));
  process.exit(1);
});
