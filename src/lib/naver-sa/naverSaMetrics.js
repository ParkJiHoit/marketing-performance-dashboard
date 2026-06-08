(function () {
  const rules = () => window.NaverSaPerformanceRules || {};
  const keywordRules = () => window.NaverSaKeywordRules || {};

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  }

  function divide(numerator, denominator) {
    return toNumber(denominator) > 0 ? toNumber(numerator) / toNumber(denominator) : 0;
  }

  function percent(numerator, denominator) {
    return divide(numerator, denominator) * 100;
  }

  function round(value, digits = 2) {
    const factor = 10 ** digits;
    return Math.round((toNumber(value) + Number.EPSILON) * factor) / factor;
  }

  function metricsFromTotals(item) {
    const impression = toNumber(item.impression ?? item.impressions);
    const click = toNumber(item.click ?? item.clicks);
    const cost = toNumber(item.cost);
    const conversion = toNumber(item.conversion ?? item.conversions);
    const conversionValue = toNumber(item.conversionValue ?? item.revenue);
    const dailyBudget = toNumber(item.dailyBudget);
    return {
      ...item,
      impression,
      click,
      cost,
      conversion,
      conversionValue,
      ctr: percent(click, impression),
      avgCpc: divide(cost, click),
      conversionRate: percent(conversion, click),
      cpa: divide(cost, conversion),
      roas: percent(conversionValue, cost),
      budgetUsageRate: dailyBudget ? percent(cost, dailyBudget) : null,
      remainingBudget: dailyBudget ? Math.max(dailyBudget - cost, 0) : null
    };
  }

  function sumStats(stats) {
    return metricsFromTotals(stats.reduce((acc, stat) => {
      acc.impression += toNumber(stat.impression);
      acc.click += toNumber(stat.click);
      acc.cost += toNumber(stat.cost);
      acc.conversion += toNumber(stat.conversion);
      acc.conversionValue += toNumber(stat.conversionValue);
      return acc;
    }, { impression: 0, click: 0, cost: 0, conversion: 0, conversionValue: 0 }));
  }

  function averageContext(rows) {
    const totals = sumStats(rows);
    const rowsWithConversion = rows.filter((row) => toNumber(row.conversion) > 0);
    const cpaValues = rowsWithConversion.map((row) => toNumber(row.cpa)).filter((value) => value > 0);
    return {
      avgCtr: totals.ctr,
      avgCpc: totals.avgCpc,
      avgCpa: cpaValues.length ? cpaValues.reduce((sum, value) => sum + value, 0) / cpaValues.length : 0,
      avgConversionRate: totals.conversionRate,
      avgCost: rows.length ? rows.reduce((sum, row) => sum + toNumber(row.cost), 0) / rows.length : 0
    };
  }

  function groupBy(items, keyGetter) {
    return items.reduce((acc, item) => {
      const key = keyGetter(item);
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  }

  function buildLookups(dataset) {
    const campaigns = Object.fromEntries((dataset.campaigns || []).map((item) => [item.campaignId, item]));
    const adGroups = Object.fromEntries((dataset.adGroups || []).map((item) => [item.adGroupId, item]));
    const keywords = Object.fromEntries((dataset.keywords || []).map((item) => [item.keywordId, item]));
    const creatives = Object.fromEntries((dataset.creatives || []).map((item) => [item.creativeId, item]));
    return { campaigns, adGroups, keywords, creatives };
  }

  function aggregateByEntity(dataset, entity) {
    const lookups = buildLookups(dataset);
    const keyField = {
      campaign: "campaignId",
      adGroup: "adGroupId",
      keyword: "keywordId"
    }[entity];
    const statsByEntity = groupBy(dataset.stats || [], (stat) => stat[keyField]);
    const source = {
      campaign: dataset.campaigns || [],
      adGroup: dataset.adGroups || [],
      keyword: dataset.keywords || []
    }[entity] || [];

    return source.map((item) => {
      const totals = sumStats(statsByEntity[item[keyField]] || []);
      const campaign = lookups.campaigns[item.campaignId] || item;
      const adGroup = lookups.adGroups[item.adGroupId] || {};
      return metricsFromTotals({
        ...item,
        ...totals,
        campaignName: campaign.campaignName || item.campaignName || "-",
        adGroupName: adGroup.adGroupName || item.adGroupName || "-",
        dailyBudget: item.dailyBudget || adGroup.dailyBudget || campaign.dailyBudget || 0,
        status: item.status || "-"
      });
    });
  }

  function aggregateSearchTerms(dataset) {
    const lookups = buildLookups(dataset);
    return (dataset.searchTerms || []).map((term) => {
      const campaign = lookups.campaigns[term.campaignId] || {};
      const adGroup = lookups.adGroups[term.adGroupId] || {};
      return {
        ...metricsFromTotals(term),
        campaignName: campaign.campaignName || "-",
        adGroupName: adGroup.adGroupName || "-",
        classification: classifySearchTerm(term),
        action: recommendSearchTermAction(term)
      };
    });
  }

  function aggregateCreatives(dataset) {
    const lookups = buildLookups(dataset);
    return (dataset.creativeStats || []).map((stat) => {
      const creative = lookups.creatives[stat.creativeId] || {};
      const campaign = lookups.campaigns[stat.campaignId] || {};
      const adGroup = lookups.adGroups[stat.adGroupId] || {};
      return {
        ...metricsFromTotals({ ...creative, ...stat }),
        creativeName: creative.creativeName || stat.creativeId,
        headline: creative.headline || "-",
        status: creative.status || "-",
        campaignName: campaign.campaignName || "-",
        adGroupName: adGroup.adGroupName || "-"
      };
    });
  }

  function classifyEntity(row, context) {
    const cfg = rules();
    if (row.impression < cfg.minimumImpressions || row.click < cfg.minimumClicks) return "데이터 부족";
    if (row.conversion > 0 && context.avgCpa && row.cpa <= context.avgCpa * cfg.goodCpaMultiplier && row.ctr >= context.avgCtr) {
      if (row.budgetUsageRate !== null && row.budgetUsageRate >= cfg.highBudgetUsageRate) return "예산 확대 후보";
      return "고효율";
    }
    if (row.conversion === 0 && row.click >= cfg.enoughClicksForExclusion && row.cost >= context.avgCost * cfg.highCostMultiplier) return "점검 필요";
    if (row.conversion > 0 && context.avgCpa && row.cpa > context.avgCpa * cfg.weakCpaMultiplier) return "효율 개선 필요";
    return "유지 권장";
  }

  function classifyKeywordPerformance(keyword, context) {
    const cfg = rules();
    const relevance = getSearchTermRelevance(keyword.keyword || "");
    if (keyword.impression < cfg.minimumImpressions || keyword.click < cfg.minimumClicks) return "테스트 유지";
    if (keyword.conversion > 0 && context.avgCpa && keyword.cpa <= context.avgCpa && keyword.ctr >= context.avgCtr) return "핵심 키워드";
    if (keyword.conversion === 0 && keyword.click >= cfg.enoughClicksForExclusion && (keyword.ctr < context.avgCtr * cfg.lowCtrMultiplier || relevance === "low")) return "제외 후보";
    if (keyword.ctr >= context.avgCtr && keyword.avgCpc <= context.avgCpc && relevance !== "low") return "확장 후보";
    if (keyword.click > 0 && keyword.conversion === 0) return "개선 필요";
    return "테스트 유지";
  }

  function recommendKeywordAction(keyword, context) {
    const grade = keyword.keywordGrade || classifyKeywordPerformance(keyword, context);
    return {
      "핵심 키워드": "유지 또는 입찰가 상향 검토",
      "확장 후보": "유사 키워드 추가 검토",
      "테스트 유지": "데이터 추가 확보",
      "개선 필요": "소재/랜딩페이지 문구 점검",
      "제외 후보": "입찰가 하향 또는 제외 키워드 검토"
    }[grade] || "유지";
  }

  function getSearchTermRelevance(text) {
    const value = String(text || "").toLowerCase();
    const cfg = keywordRules();
    if ((cfg.lowRelevance || []).some((pattern) => value.includes(pattern.toLowerCase())) || (cfg.buyerIntentTerms || []).some((pattern) => value.includes(pattern.toLowerCase()))) return "low";
    if ((cfg.highRelevance || []).some((pattern) => value.includes(pattern.toLowerCase())) || (cfg.businessTerms || []).some((pattern) => value.includes(pattern.toLowerCase()))) return "high";
    return "medium";
  }

  function classifySearchTerm(term) {
    const enriched = metricsFromTotals(term);
    const relevance = getSearchTermRelevance(term.searchTerm);
    if (enriched.conversion > 0 && relevance !== "low") return "유지";
    if (enriched.click > 0 && relevance === "high" && (enriched.ctr >= 4 || enriched.conversion > 0)) return "확장 키워드 후보";
    if (enriched.click > 0 && enriched.conversion === 0 && relevance === "low") return "제외 키워드 후보";
    return "모니터링 필요";
  }

  function recommendSearchTermAction(term) {
    const classification = classifySearchTerm(term);
    return {
      "확장 키워드 후보": "신규 키워드 등록 검토",
      "제외 키워드 후보": "제외 키워드 추가 검토",
      "모니터링 필요": "추가 데이터 확인",
      "유지": "현재 매칭 유지"
    }[classification];
  }

  function recommendBudgetAction(row, context) {
    const cfg = rules();
    if (row.impression < cfg.minimumImpressions || row.click < cfg.minimumClicks) return { label: "판단 보류", reason: "노출수 또는 클릭수가 적어 추가 모니터링이 필요합니다." };
    if (row.conversion > 0 && context.avgCpa && row.cpa <= context.avgCpa && row.budgetUsageRate !== null && row.budgetUsageRate >= cfg.highBudgetUsageRate) {
      return { label: "예산 증액 후보", reason: `전환 ${row.conversion}건, CPA ${formatWon(row.cpa)}로 평균보다 양호하고 예산 소진율이 ${formatPercent(row.budgetUsageRate)}입니다.` };
    }
    if (row.conversion === 0 && row.click >= cfg.enoughClicksForExclusion && row.cost >= context.avgCost) {
      return { label: "예산 축소 후보", reason: "비용과 클릭은 발생했지만 전환이 없어 예산 축소 또는 구조 점검이 필요합니다." };
    }
    return { label: "예산 유지 후보", reason: "현재 데이터 기준으로 급격한 증액/축소보다 유지하며 관찰하는 편이 적절합니다." };
  }

  function recommendBidAction(row, context) {
    const cfg = rules();
    const relevance = getSearchTermRelevance(row.keyword || row.searchTerm || "");
    if (row.click < cfg.minimumClicks) return { label: "입찰가 유지", reason: "클릭 데이터가 부족해 입찰 변경은 보류하는 것이 좋습니다." };
    if (row.conversion > 0 && context.avgCpa && row.cpa <= context.avgCpa && row.ctr >= context.avgCtr) {
      return { label: "입찰가 상향 검토", reason: `CTR ${formatPercent(row.ctr)}, CPA ${formatWon(row.cpa)}로 효율이 좋아 노출 확대 가능성을 검토할 수 있습니다.` };
    }
    if (row.conversion === 0 && row.avgCpc >= context.avgCpc * cfg.highCpcMultiplier && row.cost > 0) {
      return { label: relevance === "low" ? "제외 검토" : "입찰가 하향 검토", reason: "CPC가 높고 전환이 없어 입찰가 하향 또는 제외 검토가 필요합니다." };
    }
    return { label: "입찰가 유지", reason: "성과가 크게 치우치지 않아 현재 입찰가를 유지하며 관찰하는 것이 적절합니다." };
  }

  function enrichDataset(dataset) {
    const campaigns = aggregateByEntity(dataset, "campaign");
    const campaignContext = averageContext(campaigns);
    const campaignsWithJudgement = campaigns.map((row) => ({ ...row, judgement: classifyEntity(row, campaignContext), budgetAction: recommendBudgetAction(row, campaignContext) }));

    const adGroups = aggregateByEntity(dataset, "adGroup");
    const adGroupContext = averageContext(adGroups);
    const adGroupsWithJudgement = adGroups.map((row) => {
      const bidAction = recommendBidAction(row, adGroupContext);
      return { ...row, judgement: classifyEntity(row, adGroupContext), recommendedAction: actionForEntity(row, adGroupContext), bidAction };
    });

    const keywords = aggregateByEntity(dataset, "keyword");
    const keywordContext = averageContext(keywords);
    const keywordsWithGrade = keywords.map((row) => {
      const keywordGrade = classifyKeywordPerformance(row, keywordContext);
      const bidAction = recommendBidAction(row, keywordContext);
      return { ...row, keywordGrade, recommendedAction: recommendKeywordAction({ ...row, keywordGrade }, keywordContext), bidAction };
    });

    const searchTerms = aggregateSearchTerms(dataset);
    const creatives = aggregateCreatives(dataset);
    const daily = Object.entries(groupBy(dataset.stats || [], (stat) => stat.date))
      .map(([date, stats]) => ({ date, ...sumStats(stats) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const totals = sumStats(dataset.stats || []);

    return {
      raw: dataset,
      meta: dataset.meta || {},
      totals,
      contexts: { campaign: campaignContext, adGroup: adGroupContext, keyword: keywordContext },
      campaigns: campaignsWithJudgement,
      adGroups: adGroupsWithJudgement,
      keywords: keywordsWithGrade,
      searchTerms,
      creatives,
      daily
    };
  }

  function actionForEntity(row, context) {
    const cfg = rules();
    if (row.impression < cfg.minimumImpressions || row.click < cfg.minimumClicks) return "데이터 추가 필요";
    if (row.conversion > 0 && context.avgCpa && row.cpa <= context.avgCpa && (row.budgetUsageRate || 0) >= cfg.highBudgetUsageRate) return "예산 증액 검토";
    if (row.conversion > 0 && context.avgCpa && row.cpa <= context.avgCpa) return "유지";
    if (row.ctr >= context.avgCtr && row.conversion === 0) return "소재/랜딩 점검";
    if (row.avgCpc >= context.avgCpc * cfg.highCpcMultiplier && row.conversion === 0 && row.cost > 0) return "입찰가 하향 검토";
    return "유지";
  }

  function formatWon(value) {
    return `${Math.round(toNumber(value)).toLocaleString("ko-KR")}원`;
  }

  function formatPercent(value) {
    return `${round(value, 2).toLocaleString("ko-KR")}%`;
  }

  window.NaverSaMetrics = {
    toNumber,
    divide,
    percent,
    round,
    metricsFromTotals,
    sumStats,
    averageContext,
    enrichDataset,
    classifyKeywordPerformance,
    classifySearchTerm,
    recommendBudgetAction,
    recommendBidAction,
    getSearchTermRelevance
  };
})();
