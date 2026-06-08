(function () {
  const tableKeys = ["campaigns", "adgroups", "keywords", "searchTerms", "creatives"];
  const state = {
    initialized: false,
    active: false,
    loading: false,
    error: "",
    dataset: null,
    enriched: null,
    charts: {},
    activeTab: "overview",
    filters: {
      datePreset: "7d",
      startDate: "",
      endDate: "",
      campaignId: "all",
      adGroupId: "all",
      keyword: "",
      performance: "all"
    },
    sort: {
      campaigns: { field: "cost", dir: "desc" },
      adgroups: { field: "cost", dir: "desc" },
      keywords: { field: "cost", dir: "desc" },
      searchTerms: { field: "cost", dir: "desc" },
      creatives: { field: "cost", dir: "desc" }
    },
    page: {
      campaigns: 1,
      adgroups: 1,
      keywords: 1,
      searchTerms: 1,
      creatives: 1
    },
    requestId: 0
  };

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => Array.from(document.querySelectorAll(selector));
  const metrics = () => window.NaverSaMetrics;
  const rules = () => window.NaverSaPerformanceRules || {};

  const dom = {
    modeBadge: () => $("#naverSaModeBadge"),
    notice: () => $("#naverSaNotice"),
    refreshBtn: () => $("#naverSaRefreshBtn"),
    datePreset: () => $("#naverSaDatePreset"),
    startDate: () => $("#naverSaStartDate"),
    endDate: () => $("#naverSaEndDate"),
    campaignFilter: () => $("#naverSaCampaignFilter"),
    adGroupFilter: () => $("#naverSaAdGroupFilter"),
    keywordSearch: () => $("#naverSaKeywordSearch"),
    performanceFilter: () => $("#naverSaPerformanceFilter"),
    kpiGrid: () => $("#naverSaKpiGrid"),
    loading: () => $("#naverSaLoading"),
    error: () => $("#naverSaError"),
    errorMessage: () => $("#naverSaErrorMessage"),
    empty: () => $("#naverSaEmpty")
  };

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    localStorage.removeItem("naver-sa-data-mode");
    setDefaultDates();
    bindEvents();
  }

  async function activate() {
    init();
    state.active = true;
    if (!state.dataset) await loadData();
    render();
    syncLayout();
  }

  function deactivate() {
    state.active = false;
  }

  function setDefaultDates() {
    const range = getPresetRange("7d");
    state.filters.startDate = range.startDate;
    state.filters.endDate = range.endDate;
    if (dom.startDate()) dom.startDate().value = range.startDate;
    if (dom.endDate()) dom.endDate().value = range.endDate;
  }

  function getPresetRange(preset) {
    const today = dayjs();
    if (preset === "today") return { startDate: today.format("YYYY-MM-DD"), endDate: today.format("YYYY-MM-DD") };
    if (preset === "yesterday") {
      const yesterday = today.subtract(1, "day");
      return { startDate: yesterday.format("YYYY-MM-DD"), endDate: yesterday.format("YYYY-MM-DD") };
    }
    const days = { "7d": 7, "14d": 14, "30d": 30 }[preset] || 7;
    return { startDate: today.subtract(days - 1, "day").format("YYYY-MM-DD"), endDate: today.format("YYYY-MM-DD") };
  }

  function bindEvents() {
    dom.refreshBtn()?.addEventListener("click", loadData);
    dom.datePreset()?.addEventListener("change", (event) => {
      state.filters.datePreset = event.target.value;
      if (event.target.value !== "custom") {
        const range = getPresetRange(event.target.value);
        state.filters.startDate = range.startDate;
        state.filters.endDate = range.endDate;
        dom.startDate().value = range.startDate;
        dom.endDate().value = range.endDate;
      }
      loadData();
    });
    dom.startDate()?.addEventListener("change", (event) => updateFilter("startDate", event.target.value));
    dom.endDate()?.addEventListener("change", (event) => updateFilter("endDate", event.target.value));
    dom.campaignFilter()?.addEventListener("change", (event) => {
      state.filters.campaignId = event.target.value;
      state.filters.adGroupId = "all";
      resetPages();
      render();
    });
    dom.adGroupFilter()?.addEventListener("change", (event) => updateFilter("adGroupId", event.target.value));
    dom.keywordSearch()?.addEventListener("input", (event) => updateFilter("keyword", event.target.value));
    dom.performanceFilter()?.addEventListener("change", (event) => updateFilter("performance", event.target.value));
    $("#naverSaTabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-naver-sa-tab]");
      if (!button) return;
      state.activeTab = button.dataset.naverSaTab;
      renderTabs();
      render();
      syncLayout();
    });
    $("#naverSaKeywordSort")?.addEventListener("change", (event) => {
      applyKeywordSortPreset(event.target.value);
      state.page.keywords = 1;
      renderKeywordTab();
    });
    document.addEventListener("click", (event) => {
      const sortButton = event.target.closest("[data-naver-sort]");
      if (sortButton) {
        const { table, field } = sortButton.dataset;
        toggleSort(table, field);
        renderTableByKey(table);
      }
      const pageButton = event.target.closest("[data-naver-page]");
      if (pageButton) {
        state.page[pageButton.dataset.table] = Number(pageButton.dataset.naverPage);
        renderTableByKey(pageButton.dataset.table);
      }
      const csvButton = event.target.closest("[data-naver-csv]");
      if (csvButton) downloadCsv(csvButton.dataset.naverCsv);
    });
    window.addEventListener("resize", syncLayout);
  }

  function updateFilter(key, value) {
    state.filters[key] = value;
    resetPages();
    render();
  }

  function resetPages() {
    tableKeys.forEach((key) => {
      state.page[key] = 1;
    });
  }

  async function loadData() {
    const requestId = state.requestId + 1;
    state.requestId = requestId;
    state.loading = true;
    state.error = "";
    setStatusVisibility();
    const result = await window.NaverSaApiService.loadNaverSaData(state.filters);
    if (requestId !== state.requestId) return;
    state.loading = false;
    if (result.error) {
      state.error = result.error;
      state.dataset = null;
      state.enriched = null;
    } else {
      state.dataset = result.dataset;
      state.enriched = metrics().enrichDataset(filterDatasetByDate(result.dataset));
    }
    render();
  }

  function filterDatasetByDate(dataset) {
    const startDate = state.filters.startDate;
    const endDate = state.filters.endDate;
    if (!startDate || !endDate) return dataset;
    return {
      ...dataset,
      stats: (dataset.stats || []).filter((row) => !row.date || (row.date >= startDate && row.date <= endDate)),
      searchTerms: (dataset.searchTerms || []).filter((row) => !row.date || (row.date >= startDate && row.date <= endDate))
    };
  }

  function render() {
    if (!state.active || !state.initialized) return;
    setStatusVisibility();
    renderMode();
    if (!state.enriched) return;
    renderFilters();
    renderKpis();
    renderTabs();
    if (state.activeTab === "overview") renderOverview();
    if (state.activeTab === "campaigns") renderCampaignTab();
    if (state.activeTab === "adgroups") renderAdGroupTab();
    if (state.activeTab === "keywords") renderKeywordTab();
    if (state.activeTab === "searchTerms") renderSearchTermTab();
    if (state.activeTab === "creatives") renderCreativeTab();
    if (state.activeTab === "budgetBid") renderBudgetBid();
    if (state.activeTab === "insights") renderInsightSummary();
    syncLayout();
  }

  function setStatusVisibility() {
    if (dom.loading()) dom.loading().hidden = !state.loading;
    if (dom.error()) dom.error().hidden = !state.error;
    if (dom.errorMessage()) dom.errorMessage().textContent = state.error;
    const empty = state.enriched && !state.enriched.stats.length && !state.enriched.campaigns.length && !state.enriched.adGroups.length && !state.enriched.keywords.length;
    if (dom.empty()) dom.empty().hidden = !empty || state.loading || Boolean(state.error);
    if ($("#naverSaTabPanels")) $("#naverSaTabPanels").hidden = state.loading || Boolean(state.error) || empty;
  }

  function renderMode() {
    if (dom.modeBadge()) {
      dom.modeBadge().textContent = "API Data";
      dom.modeBadge().className = "pill completed";
    }
    if (dom.notice()) {
      const conversionNote = state.enriched?.meta?.conversionTrackingEnabled === false
        ? "전환 추적 미연동 상태에서는 전환/CPA/ROAS 지표가 0 또는 전환 없음으로 표시될 수 있습니다."
        : "일부 지표는 API 응답 또는 전환 설정 여부에 따라 표시되지 않을 수 있습니다.";
      const counts = state.enriched
        ? `캠페인 ${state.enriched.campaigns.length}개 · 광고그룹 ${state.enriched.adGroups.length}개 · 키워드 ${state.enriched.keywords.length}개 · 성과 ${state.enriched.stats.length}건`
        : "";
      const partial = state.enriched?.meta?.partial ? "빠른 로딩을 위해 일부 키워드 기준으로 먼저 표시 중입니다." : "";
      dom.notice().innerHTML = `<span>${conversionNote}${partial ? ` ${partial}` : ""}</span>${counts ? `<strong>${counts}</strong>` : ""}`;
    }
  }

  function renderFilters() {
    const campaigns = state.enriched.campaigns;
    const adGroups = state.enriched.adGroups.filter((item) => state.filters.campaignId === "all" || item.campaignId === state.filters.campaignId);
    setOptions(dom.campaignFilter(), [{ value: "all", label: "전체 캠페인" }, ...campaigns.map((item) => ({ value: item.campaignId, label: item.campaignName }))], state.filters.campaignId);
    setOptions(dom.adGroupFilter(), [{ value: "all", label: "전체 광고그룹" }, ...adGroups.map((item) => ({ value: item.adGroupId, label: item.adGroupName }))], state.filters.adGroupId);
  }

  function setOptions(select, options, selected) {
    if (!select) return;
    const current = select.value;
    const nextHtml = options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
    if (select.innerHTML !== nextHtml) select.innerHTML = nextHtml;
    select.value = options.some((option) => option.value === selected) ? selected : current || "all";
  }

  function getFilteredRows(key) {
    if (!state.enriched) return [];
    const source = state.enriched[key] || [];
    const keyword = state.filters.keyword.trim().toLowerCase();
    return source.filter((row) => {
      const campaignMatch = state.filters.campaignId === "all" || row.campaignId === state.filters.campaignId;
      const adGroupMatch = state.filters.adGroupId === "all" || !row.adGroupId || row.adGroupId === state.filters.adGroupId;
      const keywordMatch = !keyword || [row.keyword, row.searchTerm, row.matchedKeyword, row.campaignName, row.adGroupName, row.creativeName, row.headline]
        .join(" ")
        .toLowerCase()
        .includes(keyword);
      const performanceMatch = matchesPerformance(row);
      return campaignMatch && adGroupMatch && keywordMatch && performanceMatch;
    });
  }

  function matchesPerformance(row) {
    const filter = state.filters.performance;
    if (filter === "all") return true;
    if (filter === "hasConversion") return row.conversion > 0;
    if (filter === "hasCost") return row.cost > 0;
    if (filter === "hasClick") return row.click > 0;
    if (filter === "noConversion") return row.conversion === 0;
    if (filter === "lowEfficiency") return ["점검 필요", "제외 후보", "개선 필요", "효율 개선 필요"].includes(row.judgement || row.keywordGrade || row.classification);
    if (filter === "highEfficiency") return ["고효율", "예산 확대 후보", "핵심 키워드", "유지"].includes(row.judgement || row.keywordGrade || row.classification);
    return true;
  }

  function renderKpis() {
    const totals = metrics().sumStats(getFilteredRows("keywords"));
    const budgets = getFilteredRows("campaigns").map((row) => row.dailyBudget).filter(Boolean);
    const totalBudget = budgets.reduce((sum, value) => sum + value, 0);
    const budgetUsage = totalBudget ? metrics().percent(totals.cost, totalBudget) : null;
    const cards = [
      ["총 광고비", formatWon(totals.cost), "선택 기간 사용금액"],
      ["총 노출수", formatNumber(totals.impression), "검색광고 노출 합계"],
      ["총 클릭수", formatNumber(totals.click), "클릭 발생 합계"],
      ["평균 CTR", formatPercent(totals.ctr), "클릭 / 노출"],
      ["평균 CPC", totals.click ? formatWon(totals.avgCpc) : "-", "비용 / 클릭"],
      ["총 전환수", formatNumber(totals.conversion), "전환 추적 설정 기준"],
      ["전환율", totals.conversion ? formatPercent(totals.conversionRate) : "전환 없음", "전환 / 클릭"],
      ["CPA", totals.conversion ? formatWon(totals.cpa) : "전환 없음", "비용 / 전환"],
      ["예산 소진율", budgetUsage === null ? "예산 정보 없음" : formatPercent(budgetUsage), totalBudget ? `${formatWon(totalBudget)} 기준` : "캠페인 예산 미수집"]
    ];
    dom.kpiGrid().innerHTML = cards.map(([label, value, note]) => `
      <article class="kpi-card">
        <div class="kpi-label"><span>${label}</span><i class="kpi-dot"></i></div>
        <span class="kpi-value">${value}</span>
        <div class="kpi-note">${note}</div>
      </article>
    `).join("");
  }

  function renderTabs() {
    $$("[data-naver-sa-tab]").forEach((button) => button.classList.toggle("active", button.dataset.naverSaTab === state.activeTab));
    $$("[data-naver-sa-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.naverSaPanel === state.activeTab));
  }

  function renderOverview() {
    renderOverviewCharts();
    const insights = buildInsights();
    $("#naverSaOverviewInsights").innerHTML = insights.slice(0, 6).map(insightCard).join("");
  }

  function renderOverviewCharts() {
    const daily = filterDailyRows();
    const campaigns = getFilteredRows("campaigns");
    const adGroups = getFilteredRows("adgroups");
    const searchTerms = getFilteredRows("searchTerms");
    createChart("naverSaDailyTrendChart", {
      type: "bar",
      data: {
        labels: daily.map((row) => row.date),
        datasets: [
          { type: "bar", label: "비용", data: daily.map((row) => row.cost), backgroundColor: colors().blue },
          { type: "line", label: "클릭", data: daily.map((row) => row.click), borderColor: colors().green, tension: 0.35, yAxisID: "count" },
          { type: "line", label: "전환", data: daily.map((row) => row.conversion), borderColor: colors().youtube, tension: 0.35, yAxisID: "count" }
        ]
      },
      options: chartOptions({ scales: dualScales() })
    });
    createChart("naverSaCampaignCostChart", barConfig(campaigns, "campaignName", "cost", "광고비"));
    createChart("naverSaCampaignCpaChart", barConfig(campaigns, "campaignName", "cpa", "CPA", (row) => row.conversion ? row.cpa : 0));
    createChart("naverSaAdGroupScatterChart", {
      type: "scatter",
      data: {
        datasets: [{
          label: "광고그룹",
          data: adGroups.map((row) => ({ x: row.cost, y: row.conversion, label: row.adGroupName })),
          pointRadius: 7,
          backgroundColor: adGroups.map((row) => row.conversion > 0 ? colors().green : colors().youtube)
        }]
      },
      options: chartOptions({
        parsing: false,
        scales: {
          x: axis("비용", (value) => formatCompactWon(value)),
          y: axis("전환수", (value) => formatNumber(value))
        },
        plugins: { tooltip: { callbacks: { title: (context) => context[0].raw.label } } }
      })
    });
    const share = countBy(searchTerms, (row) => row.classification);
    createChart("naverSaSearchTermShareChart", {
      type: "doughnut",
      data: {
        labels: Object.keys(share),
        datasets: [{ data: Object.values(share), backgroundColor: [colors().green, colors().youtube, colors().blue, colors().amber] }]
      },
      options: chartOptions({ scales: {}, cutout: "62%" })
    });
  }

  function renderCampaignTab() {
    renderTable("campaigns", $("#naverSaCampaignTable"), [
      ["campaignName", "캠페인명", "text"],
      ["status", "상태", "badge"],
      ["cost", "광고비", "won"],
      ["impression", "노출수", "number"],
      ["click", "클릭수", "number"],
      ["ctr", "CTR", "percent"],
      ["avgCpc", "평균 CPC", "won"],
      ["conversion", "전환수", "number"],
      ["conversionRate", "전환율", "percentOrNone"],
      ["cpa", "CPA", "cpa"],
      ["dailyBudget", "일예산", "wonOrNone"],
      ["budgetUsageRate", "예산 소진율", "budget"],
      ["judgement", "판단 상태", "statusBadge"]
    ]);
  }

  function renderAdGroupTab() {
    renderTable("adgroups", $("#naverSaAdGroupTable"), [
      ["campaignName", "캠페인명", "text"],
      ["adGroupName", "광고그룹명", "text"],
      ["status", "상태", "badge"],
      ["cost", "광고비", "won"],
      ["impression", "노출수", "number"],
      ["click", "클릭수", "number"],
      ["ctr", "CTR", "percent"],
      ["avgCpc", "평균 CPC", "won"],
      ["conversion", "전환수", "number"],
      ["conversionRate", "전환율", "percentOrNone"],
      ["cpa", "CPA", "cpa"],
      ["bidAmt", "기본 입찰가", "won"],
      ["dailyBudget", "일예산", "wonOrNone"],
      ["judgement", "판단 상태", "statusBadge"],
      ["recommendedAction", "추천 액션", "actionBadge"]
    ]);
  }

  function renderKeywordTab() {
    const keywords = getFilteredRows("keywords");
    createChart("naverSaKeywordCostTopChart", barConfig([...keywords].sort((a, b) => b.cost - a.cost).slice(0, 10), "keyword", "cost", "광고비"));
    createChart("naverSaKeywordCpaTopChart", barConfig([...keywords].filter((row) => row.conversion > 0).sort((a, b) => a.cpa - b.cpa).slice(0, 10), "keyword", "cpa", "CPA"));
    renderTable("keywords", $("#naverSaKeywordTable"), [
      ["campaignName", "캠페인명", "text"],
      ["adGroupName", "광고그룹명", "text"],
      ["keyword", "키워드", "textStrong"],
      ["status", "상태", "badge"],
      ["bidAmt", "입찰가", "won"],
      ["cost", "광고비", "won"],
      ["impression", "노출수", "number"],
      ["click", "클릭수", "number"],
      ["ctr", "CTR", "percent"],
      ["avgCpc", "평균 CPC", "won"],
      ["conversion", "전환수", "number"],
      ["conversionRate", "전환율", "percentOrNone"],
      ["cpa", "CPA", "cpa"],
      ["qualityIndex", "품질/연관 지수", "number"],
      ["keywordGrade", "키워드 등급", "statusBadge"],
      ["recommendedAction", "추천 액션", "actionBadge"]
    ]);
  }

  function renderSearchTermTab() {
    renderTable("searchTerms", $("#naverSaSearchTermTable"), [
      ["searchTerm", "실제 검색어", "textStrong"],
      ["matchedKeyword", "매칭 키워드", "text"],
      ["campaignName", "캠페인명", "text"],
      ["adGroupName", "광고그룹명", "text"],
      ["cost", "광고비", "won"],
      ["impression", "노출수", "number"],
      ["click", "클릭수", "number"],
      ["ctr", "CTR", "percent"],
      ["conversion", "전환수", "number"],
      ["cpa", "CPA", "cpa"],
      ["classification", "분류", "statusBadge"],
      ["action", "추천 액션", "actionBadge"]
    ]);
  }

  function renderCreativeTab() {
    renderTable("creatives", $("#naverSaCreativeTable"), [
      ["campaignName", "캠페인명", "text"],
      ["adGroupName", "광고그룹명", "text"],
      ["creativeName", "소재명", "textStrong"],
      ["headline", "문구", "text"],
      ["status", "상태", "badge"],
      ["cost", "광고비", "won"],
      ["impression", "노출수", "number"],
      ["click", "클릭수", "number"],
      ["ctr", "CTR", "percent"],
      ["conversion", "전환수", "number"],
      ["cpa", "CPA", "cpa"]
    ]);
  }

  function renderBudgetBid() {
    const campaigns = getFilteredRows("campaigns").map((row) => row.budgetAction);
    const keywords = getFilteredRows("keywords").map((row) => ({ ...row.bidAction, subject: row.keyword }));
    const sections = [
      { title: "예산 증액 후보", rows: campaigns.filter((item) => item.label === "예산 증액 후보") },
      { title: "예산 축소 후보", rows: campaigns.filter((item) => item.label === "예산 축소 후보") },
      { title: "입찰가 상향 검토", rows: keywords.filter((item) => item.label === "입찰가 상향 검토") },
      { title: "입찰가 하향/제외 검토", rows: keywords.filter((item) => item.label === "입찰가 하향 검토" || item.label === "제외 검토") },
      { title: "판단 보류", rows: [...campaigns, ...keywords].filter((item) => item.label === "판단 보류") }
    ];
    $("#naverSaBudgetBidCards").innerHTML = sections.map((section) => insightCard({
      title: section.title,
      value: section.rows.length ? `${section.rows.length}건` : "해당 없음",
      detail: section.rows[0]?.reason || "현재 필터 기준으로 즉시 조정이 필요한 항목은 많지 않습니다."
    })).join("");
  }

  function renderInsightSummary() {
    const totals = metrics().sumStats(getFilteredRows("keywords"));
    const insights = buildInsights();
    $("#naverSaInsightSummary").innerHTML = `
      <article class="insight-card featured">
        <h3>성과 요약</h3>
        <p>선택 기간 총 광고비는 <strong>${formatWon(totals.cost)}</strong>, 전환수는 <strong>${formatNumber(totals.conversion)}건</strong>, CPA는 <strong>${totals.conversion ? formatWon(totals.cpa) : "전환 없음"}</strong>입니다.</p>
        <p>전체 CTR은 <strong>${formatPercent(totals.ctr)}</strong>, 평균 CPC는 <strong>${totals.click ? formatWon(totals.avgCpc) : "-"}</strong>입니다.</p>
      </article>
      ${["좋은 흐름", "점검 필요", "추천 액션"].map((title, index) => `
        <article class="insight-card">
          <h3>${title}</h3>
          <ul class="naver-sa-bullets">
            ${insights.slice(index * 3, index * 3 + 3).map((item) => `<li>${escapeHtml(item.detail)}</li>`).join("") || "<li>데이터가 부족해 추가 모니터링이 필요합니다.</li>"}
          </ul>
        </article>
      `).join("")}
    `;
  }

  function renderTable(key, target, columns) {
    const rows = sortRows(key, getFilteredRows(key));
    const pageSize = rules().defaultPageSize || 8;
    const pageCount = Math.max(Math.ceil(rows.length / pageSize), 1);
    state.page[key] = Math.min(state.page[key], pageCount);
    const start = (state.page[key] - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);
    target.innerHTML = `
      <div class="naver-sa-table-head">
        <strong>${tableTitle(key)} <span>${formatNumber(rows.length)}건</span></strong>
        <button class="btn" type="button" data-naver-csv="${key}">CSV 다운로드</button>
      </div>
      <div class="table-wrap naver-sa-table-wrap">
        <table class="naver-sa-table">
          <thead>
            <tr>${columns.map(([field, label]) => `<th><button type="button" data-naver-sort="${field}" data-table="${key}">${label}${sortMark(key, field)}</button></th>`).join("")}</tr>
          </thead>
          <tbody>
            ${pageRows.length ? pageRows.map((row) => `<tr>${columns.map(([field, , type]) => `<td class="${cellClass(type)}">${formatCell(row, field, type)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}">선택한 조건에 맞는 데이터가 없습니다.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="naver-sa-pagination">
        ${Array.from({ length: pageCount }, (_, index) => `<button class="mini-btn ${state.page[key] === index + 1 ? "active" : ""}" type="button" data-table="${key}" data-naver-page="${index + 1}">${index + 1}</button>`).join("")}
      </div>
    `;
  }

  function renderTableByKey(key) {
    if (key === "campaigns") renderCampaignTab();
    if (key === "adgroups") renderAdGroupTab();
    if (key === "keywords") renderKeywordTab();
    if (key === "searchTerms") renderSearchTermTab();
    if (key === "creatives") renderCreativeTab();
  }

  function toggleSort(table, field) {
    const current = state.sort[table];
    state.sort[table] = { field, dir: current.field === field && current.dir === "desc" ? "asc" : "desc" };
  }

  function applyKeywordSortPreset(value) {
    const map = {
      costDesc: ["cost", "desc"],
      clickDesc: ["click", "desc"],
      ctrDesc: ["ctr", "desc"],
      cpcDesc: ["avgCpc", "desc"],
      conversionDesc: ["conversion", "desc"],
      cpaAsc: ["cpa", "asc"],
      excludeFirst: ["keywordGrade", "excludeFirst"],
      coreFirst: ["keywordGrade", "coreFirst"]
    };
    const [field, dir] = map[value] || map.costDesc;
    state.sort.keywords = { field, dir };
  }

  function sortRows(key, rows) {
    const { field, dir } = state.sort[key];
    const priority = {
      excludeFirst: { "제외 후보": 1, "개선 필요": 2, "테스트 유지": 3, "확장 후보": 4, "핵심 키워드": 5 },
      coreFirst: { "핵심 키워드": 1, "확장 후보": 2, "개선 필요": 3, "테스트 유지": 4, "제외 후보": 5 }
    }[dir];
    return [...rows].sort((a, b) => {
      if (priority) return (priority[a[field]] || 99) - (priority[b[field]] || 99);
      const av = a[field];
      const bv = b[field];
      const diff = typeof av === "number" || typeof bv === "number" ? Number(av || 0) - Number(bv || 0) : String(av || "").localeCompare(String(bv || ""), "ko");
      return dir === "asc" ? diff : -diff;
    });
  }

  function downloadCsv(key) {
    const rows = sortRows(key, getFilteredRows(key));
    const csv = Papa.unparse(rows.map(flattenForCsv));
    const filename = `naver-sa-${key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}-${dayjs().format("YYYYMMDD")}.csv`;
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function flattenForCsv(row) {
    return {
      캠페인명: row.campaignName,
      광고그룹명: row.adGroupName,
      키워드: row.keyword,
      검색어: row.searchTerm,
      소재명: row.creativeName,
      광고비: Math.round(row.cost || 0),
      노출수: row.impression || 0,
      클릭수: row.click || 0,
      CTR: metrics().round(row.ctr || 0, 2),
      평균CPC: Math.round(row.avgCpc || 0),
      전환수: row.conversion || 0,
      전환율: metrics().round(row.conversionRate || 0, 2),
      CPA: row.conversion ? Math.round(row.cpa || 0) : "전환 없음",
      판단: row.judgement || row.keywordGrade || row.classification || "",
      추천액션: row.recommendedAction || row.action || row.bidAction?.label || ""
    };
  }

  function buildInsights() {
    const campaigns = getFilteredRows("campaigns");
    const adGroups = getFilteredRows("adgroups");
    const keywords = getFilteredRows("keywords");
    const searchTerms = getFilteredRows("searchTerms");
    const topCostCampaign = maxBy(campaigns, "cost");
    const bestCpaCampaign = minBy(campaigns.filter((row) => row.conversion > 0), "cpa");
    const noConversionAdGroup = maxBy(adGroups.filter((row) => row.conversion === 0 && row.cost > 0), "cost");
    const highCtrNoConversionKeyword = maxBy(keywords.filter((row) => row.conversion === 0), "ctr");
    const budgetCandidate = campaigns.find((row) => row.budgetAction?.label === "예산 증액 후보");
    const bidDownCandidate = keywords.find((row) => row.bidAction?.label === "입찰가 하향 검토" || row.bidAction?.label === "제외 검토");
    const expansion = searchTerms.find((row) => row.classification === "확장 키워드 후보");
    const exclusion = searchTerms.find((row) => row.classification === "제외 키워드 후보");
    return [
      topCostCampaign && { title: "가장 많은 비용 사용", value: topCostCampaign.campaignName, detail: `${topCostCampaign.campaignName}이 ${formatWon(topCostCampaign.cost)}로 가장 많은 비용을 사용했습니다.` },
      bestCpaCampaign && { title: "CPA 우수 캠페인", value: bestCpaCampaign.campaignName, detail: `${bestCpaCampaign.campaignName}은 CPA ${formatWon(bestCpaCampaign.cpa)}로 전환 효율이 좋은 편입니다.` },
      noConversionAdGroup && { title: "전환 없는 비용 발생", value: noConversionAdGroup.adGroupName, detail: `${noConversionAdGroup.adGroupName}은 비용 ${formatWon(noConversionAdGroup.cost)}가 발생했지만 전환이 없어 점검 후보입니다.` },
      highCtrNoConversionKeyword && { title: "CTR 높고 전환 없음", value: highCtrNoConversionKeyword.keyword, detail: `${highCtrNoConversionKeyword.keyword}는 CTR ${formatPercent(highCtrNoConversionKeyword.ctr)}이나 전환이 없어 랜딩/문의 흐름 확인이 필요합니다.` },
      budgetCandidate && { title: "예산 증액 검토", value: budgetCandidate.campaignName, detail: budgetCandidate.budgetAction.reason },
      bidDownCandidate && { title: "입찰가 하향 검토", value: bidDownCandidate.keyword, detail: `${bidDownCandidate.keyword}: ${bidDownCandidate.bidAction.reason}` },
      expansion && { title: "검색어 확장 후보", value: expansion.searchTerm, detail: `${expansion.searchTerm}은 비즈니스 관련성이 높아 신규 키워드 검토 대상입니다.` },
      exclusion && { title: "검색어 제외 후보", value: exclusion.searchTerm, detail: `${exclusion.searchTerm}은 구매자성 검색어로 보여 제외 키워드 검토가 필요합니다.` }
    ].filter(Boolean);
  }

  function filterDailyRows() {
    const rows = state.enriched.daily.filter((row) => row.date >= state.filters.startDate && row.date <= state.filters.endDate);
    return rows.length ? rows : state.enriched.daily;
  }

  function createChart(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || !window.Chart) return;
    if (state.charts[id]) state.charts[id].destroy();
    state.charts[id] = new Chart(canvas, config);
  }

  function barConfig(rows, labelField, valueField, label, valueGetter) {
    const visibleRows = rows.slice(0, 10);
    return {
      type: "bar",
      data: {
        labels: visibleRows.map((row) => String(row[labelField] || "-").slice(0, 18)),
        datasets: [{ label, data: visibleRows.map((row) => valueGetter ? valueGetter(row) : row[valueField]), backgroundColor: colors().green, borderRadius: 7 }]
      },
      options: chartOptions({ plugins: { legend: { display: false } } })
    };
  }

  function chartOptions(extra = {}) {
    const c = colors();
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 280 },
      plugins: {
        legend: { labels: { color: c.muted, boxWidth: 10, boxHeight: 10 } },
        tooltip: { backgroundColor: c.ink, titleColor: c.surface, bodyColor: c.surface, padding: 10 }
      },
      scales: {
        x: { grid: { color: c.line }, ticks: { color: c.muted, maxRotation: 0 } },
        y: { beginAtZero: true, grid: { color: c.line }, ticks: { color: c.muted } }
      },
      ...extra
    };
  }

  function dualScales() {
    const c = colors();
    return {
      x: { grid: { color: c.line }, ticks: { color: c.muted, maxRotation: 0 } },
      y: { beginAtZero: true, position: "left", grid: { color: c.line }, ticks: { color: c.muted, callback: formatCompactWon } },
      count: { beginAtZero: true, position: "right", grid: { drawOnChartArea: false }, ticks: { color: c.muted } }
    };
  }

  function axis(title, callback) {
    const c = colors();
    return { beginAtZero: true, title: { display: true, text: title, color: c.muted }, grid: { color: c.line }, ticks: { color: c.muted, callback } };
  }

  function colors() {
    const styles = getComputedStyle(document.documentElement);
    return ["ink", "muted", "line", "surface", "youtube", "green", "blue", "amber"].reduce((acc, name) => {
      acc[name] = styles.getPropertyValue(`--${name}`).trim();
      return acc;
    }, {});
  }

  function insightCard(item) {
    return `
      <article class="insight-card">
        <h3>${escapeHtml(item.title)}</h3>
        <h4>${escapeHtml(item.value)}</h4>
        <p>${escapeHtml(item.detail)}</p>
      </article>
    `;
  }

  function formatCell(row, field, type) {
    const value = row[field];
    if (type === "won") return formatWon(value);
    if (type === "wonOrNone") return value ? formatWon(value) : "예산 정보 없음";
    if (type === "number") return formatNumber(value);
    if (type === "percent") return formatPercent(value);
    if (type === "percentOrNone") return row.conversion ? formatPercent(value) : "전환 없음";
    if (type === "cpa") return row.conversion ? formatWon(value) : "전환 없음";
    if (type === "budget") return value === null || value === undefined ? "예산 정보 없음" : formatPercent(value);
    if (type === "badge") return `<span class="pill">${escapeHtml(value || "-")}</span>`;
    if (type === "statusBadge") return `<span class="pill ${badgeClass(value)}">${escapeHtml(value || "-")}</span>`;
    if (type === "actionBadge") return `<span class="action-badge ${badgeClass(value)}">${escapeHtml(value || "-")}</span>`;
    if (type === "textStrong") return `<strong>${escapeHtml(value || "-")}</strong>`;
    return escapeHtml(value || "-");
  }

  function cellClass(type) {
    return ["won", "number", "percent", "percentOrNone", "cpa", "budget", "wonOrNone"].includes(type) ? "num" : "";
  }

  function badgeClass(value) {
    if (["고효율", "핵심 키워드", "유지", "유지 권장", "확장 키워드 후보"].includes(value)) return "active";
    if (["예산 확대 후보", "예산 증액 검토", "입찰가 상향 검토", "확장 후보"].includes(value)) return "completed";
    if (["점검 필요", "개선 필요", "효율 개선 필요", "소재/랜딩 점검", "입찰가 하향 검토", "모니터링 필요"].includes(value)) return "paused";
    if (["제외 후보", "제외 키워드 후보", "제외 검토"].includes(value)) return "danger";
    return "draft";
  }

  function sortMark(table, field) {
    const current = state.sort[table];
    if (!current || current.field !== field) return "";
    return current.dir === "asc" ? " ↑" : " ↓";
  }

  function tableTitle(key) {
    return { campaigns: "캠페인 성과", adgroups: "광고그룹 성과", keywords: "키워드 성과", searchTerms: "검색어 분석", creatives: "소재 성과" }[key];
  }

  function countBy(rows, getter) {
    return rows.reduce((acc, row) => {
      const key = getter(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }

  function maxBy(rows, field) {
    return rows.reduce((best, row) => !best || row[field] > best[field] ? row : best, null);
  }

  function minBy(rows, field) {
    return rows.reduce((best, row) => !best || row[field] < best[field] ? row : best, null);
  }

  function formatNumber(value) {
    return Math.round(Number(value || 0)).toLocaleString("ko-KR");
  }

  function formatWon(value) {
    return `${formatNumber(value)}원`;
  }

  function formatCompactWon(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${metrics().round(number / 1000000, 1)}백만`;
    if (number >= 10000) return `${metrics().round(number / 10000, 1)}만`;
    return formatNumber(number);
  }

  function formatPercent(value) {
    return `${metrics().round(value || 0, 2).toLocaleString("ko-KR")}%`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function syncLayout() {
    requestAnimationFrame(() => {
      Object.values(state.charts).forEach((chart) => chart.resize());
    });
  }

  window.NaverSaDashboard = {
    init,
    activate,
    deactivate,
    syncLayout
  };
})();
