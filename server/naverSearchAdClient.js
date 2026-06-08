const crypto = require("crypto");

const DEFAULT_BASE_URL = "https://api.searchad.naver.com";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function createSignature(timestamp, method, uri, secretKey) {
  const message = `${timestamp}.${method.toUpperCase()}.${uri}`;
  return crypto
    .createHmac("sha256", secretKey)
    .update(message)
    .digest("base64");
}

function createHeaders(method, uri) {
  const timestamp = Date.now().toString();
  const secretKey = requiredEnv("NAVER_SECRET_KEY");
  return {
    "Content-Type": "application/json; charset=UTF-8",
    "X-Timestamp": timestamp,
    "X-API-KEY": requiredEnv("NAVER_ACCESS_LICENSE"),
    "X-Customer": requiredEnv("NAVER_CUSTOMER_ID"),
    "X-Signature": createSignature(timestamp, method, uri, secretKey)
  };
}

function createClient() {
  const baseUrl = process.env.NAVER_API_BASE_URL || DEFAULT_BASE_URL;

  async function request(method, uri, { query, body } = {}) {
    const search = query ? `?${new URLSearchParams(query).toString()}` : "";
    const requestUri = `${uri}${search}`;
    const timeoutMs = Number(process.env.NAVER_API_TIMEOUT_MS || 12000) || 12000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(`${baseUrl}${requestUri}`, {
        method,
        headers: createHeaders(method, uri),
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
    } catch (error) {
      const timedOut = error.name === "AbortError";
      const wrapped = new Error(timedOut ? `Naver Search Ad API timed out after ${timeoutMs}ms` : error.message);
      wrapped.cause = error;
      wrapped.code = timedOut ? "NAVER_API_TIMEOUT" : error.code;
      throw wrapped;
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    const data = text ? JSON.parse(text) : null;

    if (!response.ok) {
      const error = new Error(data?.message || "Naver Search Ad API request failed");
      error.status = response.status;
      error.payload = data;
      throw error;
    }

    return data;
  }

  return {
    get: (uri, options) => request("GET", uri, options),
    post: (uri, options) => request("POST", uri, options)
  };
}

function normalizeCampaign(item) {
  return {
    campaignId: item.nccCampaignId,
    campaignName: item.name,
    status: item.status,
    dailyBudget: Number(item.dailyBudget || 0),
    budget: Number(item.budget || 0),
    campaignType: item.campaignTp || item.campaignType || ""
  };
}

function normalizeAdGroup(item) {
  return {
    adGroupId: item.nccAdgroupId,
    adGroupName: item.name,
    campaignId: item.nccCampaignId,
    status: item.status,
    bidAmt: Number(item.bidAmt || 0),
    dailyBudget: Number(item.dailyBudget || 0),
    target: item.target || item.pcChannelId || item.mobileChannelId || ""
  };
}

function normalizeKeyword(item) {
  return {
    keywordId: item.nccKeywordId,
    keyword: item.keyword,
    adGroupId: item.nccAdgroupId,
    campaignId: item.nccCampaignId,
    status: item.status,
    bidAmt: Number(item.bidAmt || 0),
    qualityIndex: Number(item.qi || item.qualityIndex || 0)
  };
}

function normalizeStat(item) {
  const cost = Number(item.salesAmt || item.cost || 0);
  const click = Number(item.clkCnt || item.click || 0);
  const impression = Number(item.impCnt || item.impression || 0);
  const conversion = Number(item.ccnt || item.conversion || 0);
  const conversionValue = Number(item.convAmt || item.conversionValue || 0);
  return {
    date: item.dateStart || item.date || item.dateEnd || item.period,
    entityId: item.id || item.nccCampaignId || item.nccAdgroupId || item.nccKeywordId,
    campaignId: item.nccCampaignId || (String(item.id || "").startsWith("cmp-") ? item.id : undefined),
    adGroupId: item.nccAdgroupId || (String(item.id || "").startsWith("grp-") ? item.id : undefined),
    keywordId: item.nccKeywordId || (String(item.id || "").startsWith("nkw-") ? item.id : undefined),
    impression,
    click,
    cost,
    conversion,
    conversionValue,
    ctr: impression ? (click / impression) * 100 : 0,
    avgCpc: click ? cost / click : 0,
    conversionRate: click ? (conversion / click) * 100 : 0,
    cpa: conversion ? cost / conversion : 0,
    roas: cost ? (conversionValue / cost) * 100 : 0
  };
}

function normalizeSearchTerm(item) {
  const normalized = normalizeStat(item);
  return {
    ...normalized,
    searchTerm: item.schKeyword || item.searchTerm || item.query || "",
    matchedKeyword: item.keyword || item.matchedKeyword || "",
    cpa: normalized.conversion ? normalized.cost / normalized.conversion : 0
  };
}

function flattenStatsResponse(response, idField) {
  const data = Array.isArray(response) ? response : response?.data || [];
  return data.flatMap((item) => {
    if (Array.isArray(item.rows)) {
      return item.rows.map((row) => ({ ...row, id: item.id || item[idField] }));
    }
    if (Array.isArray(item.metrics)) {
      return item.metrics.map((row) => ({ ...row, id: item.id || item[idField] }));
    }
    return item;
  });
}

module.exports = {
  createClient,
  createSignature,
  createHeaders,
  normalizeCampaign,
  normalizeAdGroup,
  normalizeKeyword,
  normalizeStat,
  normalizeSearchTerm,
  flattenStatsResponse
};
