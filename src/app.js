dayjs.locale("ko");

    // 채널별 확장을 염두에 둔 설정입니다. 현재는 YouTube만 활성화하고,
    // 이후 Naver/Google/Meta 모듈은 같은 구조에 storageKey와 렌더러를 추가하면 됩니다.
    const CHANNELS = {
      youtube: {
        id: "youtube",
        title: "YouTube Studio",
        storageKey: "yt-studio-promotions-v1"
      },
      naverSa: {
        id: "naverSa",
        title: "Naver SA"
      }
    };

    const STATUS_LABELS = {
      active: "진행중",
      completed: "완료",
      paused: "일시중지",
      draft: "초안"
    };

    const GOAL_LABELS = {
      awareness: "인지",
      traffic: "방문",
      subscriber: "구독",
      conversion: "전환"
    };

    const STORAGE_KEYS = {
      promotions: CHANNELS.youtube.storageKey,
      theme: "marketing-dashboard-theme-v2"
    };

    // 앱 전역 상태입니다. 서버 없이 LocalStorage를 원본 데이터 저장소로 쓰고,
    // 화면에는 필터가 반영된 파생 데이터를 렌더링합니다.
    const appState = {
      promotions: [],
      currentEditId: null,
      promotionEntryMode: "direct",
      youtubeInsightTab: "summary",
      pendingConfirm: null,
      table: null,
      charts: {},
      dashboardLayoutTimers: [],
      dashboardFontsQueued: false,
      filters: {
        search: "",
        status: "all",
        goal: "all"
      }
    };

    const $ = (selector) => document.querySelector(selector);

    const dom = {
      pageTitle: $("#pageTitle"),
      pageSubtitle: $("#pageSubtitle"),
      hubPage: $("#hubPage"),
      dashboardPage: $("#dashboardPage"),
      naverSaPage: $("#naverSaPage"),
      backToHubBtn: $("#backToHubBtn"),
      themeToggleBtn: $("#themeToggleBtn"),
      themeIcon: $("#themeIcon"),
      youtubeChannelCard: $("#youtubeChannelCard"),
      naverSaChannelCard: $("#naverSaChannelCard"),
      addPromotionBtn: $("#addPromotionBtn"),
      loadSampleBtn: $("#loadSampleBtn"),
      kpiGrid: $("#kpiGrid"),
      youtubeInsightTabs: $("#youtubeInsightTabs"),
      youtubeInsightSummary: $("#youtubeInsightSummary"),
      youtubeBudgetJudgment: $("#youtubeBudgetJudgment"),
      youtubeCreativeJudgment: $("#youtubeCreativeJudgment"),
      tableSearchInput: $("#tableSearchInput"),
      statusFilterSelect: $("#statusFilterSelect"),
      goalFilterSelect: $("#goalFilterSelect"),
      columnPanel: $("#columnPanel"),
      exportCsvBtn: $("#exportCsvBtn"),
      importCsvBtn: $("#importCsvBtn"),
      resetDataBtn: $("#resetDataBtn"),
      csvFileInput: $("#csvFileInput"),
      promotionModalBackdrop: $("#promotionModalBackdrop"),
      promotionModalTitle: $("#promotionModalTitle"),
      promotionForm: $("#promotionForm"),
      promotionTabs: $("#promotionTabs"),
      directEntryPanel: $("#directEntryPanel"),
      pasteEntryPanel: $("#pasteEntryPanel"),
      studioPasteInput: $("#studioPasteInput"),
      pastePreview: $("#pastePreview"),
      savePromotionBtn: $("#savePromotionBtn"),
      importPasteBtn: $("#importPasteBtn"),
      closePromotionModalBtn: $("#closePromotionModalBtn"),
      cancelPromotionBtn: $("#cancelPromotionBtn"),
      confirmModalBackdrop: $("#confirmModalBackdrop"),
      confirmTitle: $("#confirmTitle"),
      confirmMessage: $("#confirmMessage"),
      confirmCancelBtn: $("#confirmCancelBtn"),
      confirmOkBtn: $("#confirmOkBtn"),
      metricDetailModalBackdrop: $("#metricDetailModalBackdrop"),
      metricDetailTitle: $("#metricDetailTitle"),
      metricDetailBody: $("#metricDetailBody"),
      closeMetricDetailBtn: $("#closeMetricDetailBtn"),
      toast: $("#toast")
    };

    function uid() {
      return `promo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function toNumber(value) {
      const cleaned = String(value ?? "").replaceAll(",", "").replace(/[^\d.-]/g, "").trim();
      const number = Number(cleaned);
      return Number.isFinite(number) && number >= 0 ? number : 0;
    }

    function divide(numerator, denominator) {
      return denominator > 0 ? numerator / denominator : 0;
    }

    function percent(numerator, denominator) {
      return divide(numerator, denominator) * 100;
    }

    function round(value, digits = 2) {
      const factor = 10 ** digits;
      return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
    }

    function formatNumber(value) {
      return Math.round(toNumber(value)).toLocaleString("ko-KR");
    }

    function formatCurrency(value, digits = 0) {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
      }).format(toNumber(value));
    }

    function formatUnitCurrency(value) {
      return formatCurrency(value, 2);
    }

    function formatPercent(value) {
      return `${round(value, 2).toLocaleString("ko-KR")} %`;
    }

    function formatKpiCurrency(value) {
      if (toNumber(value) >= 1000000) return `$${round(value / 1000000, 1)}M`;
      if (toNumber(value) >= 1000) return `$${round(value / 1000, 1)}K`;
      return formatCurrency(value);
    }

    // 개별 프로모션 KPI 산식입니다. 분모가 0인 경우 0으로 처리해
    // Infinity/NaN이 테이블, 차트, CSV에 새어 나가지 않게 합니다.
    function calculateMetrics(item) {
      const cost = toNumber(item.cost);
      const impressions = toNumber(item.impressions);
      const views = toNumber(item.views);
      const subscribers = toNumber(item.subscribers);
      const visitors = toNumber(item.visitors);

      return {
        cpv: divide(cost, visitors),
        viewCost: divide(cost, views),
        cpm: divide(cost, impressions) * 1000,
        viewRate: percent(views, impressions),
        impressionVisitRate: percent(visitors, impressions),
        visitRate: percent(visitors, views),
        costPerVisitor: divide(cost, visitors),
        subscribeRate: percent(subscribers, views)
      };
    }

    // 원본 데이터에 라벨과 계산 KPI를 붙여 화면용 데이터로 변환합니다.
    // 저장되는 값은 원본 입력값뿐이고, KPI는 항상 최신 입력값 기준으로 재계산됩니다.
    function enrichPromotion(item) {
      const metrics = calculateMetrics(item);
      return {
        ...item,
        cost: toNumber(item.cost),
        impressions: toNumber(item.impressions),
        views: toNumber(item.views),
        subscribers: toNumber(item.subscribers),
        visitors: toNumber(item.visitors),
        statusLabel: STATUS_LABELS[item.status] || item.status || "-",
        goalLabel: GOAL_LABELS[item.goal] || item.goal || "-",
        createdAtLabel: item.createdAt ? dayjs(item.createdAt).format("YYYY.MM.DD") : "-",
        cpv: metrics.cpv,
        viewCost: metrics.viewCost,
        cpm: metrics.cpm,
        viewRate: metrics.viewRate,
        impressionVisitRate: metrics.impressionVisitRate,
        visitRate: metrics.visitRate,
        costPerVisitor: metrics.costPerVisitor,
        subscribeRate: metrics.subscribeRate
      };
    }

    function getPromotionBenchmarks(items) {
      const active = items.filter((item) => item.views > 0 || item.impressions > 0 || item.visitors > 0);
      const visitRates = active.map((item) => item.visitRate).filter(Number.isFinite);
      const viewRates = active.map((item) => item.viewRate).filter(Number.isFinite);
      const impressionVisitRates = active.map((item) => item.impressionVisitRate).filter(Number.isFinite);
      const visitors = active.map((item) => item.visitors).filter(Number.isFinite);
      const views = active.map((item) => item.views).filter(Number.isFinite);
      return {
        avgCost: divide(active.reduce((sum, item) => sum + item.cost, 0), active.length),
        avgViews: divide(active.reduce((sum, item) => sum + item.views, 0), active.length),
        avgVisitors: divide(active.reduce((sum, item) => sum + item.visitors, 0), active.length),
        avgViewRate: percent(active.reduce((sum, item) => sum + item.views, 0), active.reduce((sum, item) => sum + item.impressions, 0)),
        avgImpressionVisitRate: percent(active.reduce((sum, item) => sum + item.visitors, 0), active.reduce((sum, item) => sum + item.impressions, 0)),
        avgVisitRate: percent(active.reduce((sum, item) => sum + item.visitors, 0), active.reduce((sum, item) => sum + item.views, 0)),
        medianViews: median(views),
        medianVisitors: median(visitors),
        medianViewRate: median(viewRates),
        medianVisitRate: median(visitRates),
        medianImpressionVisitRate: median(impressionVisitRates),
        p75VisitRate: percentile(visitRates, 0.75),
        p75ViewRate: percentile(viewRates, 0.75),
        p75ImpressionVisitRate: percentile(impressionVisitRates, 0.75),
        medianCpv: median(active.map((item) => item.cpv).filter((value) => value > 0))
      };
    }

    function classifyPromotion(item, benchmarks) {
      if (item.impressions < 5000 || item.views < 300) {
        return {
          key: "insufficient",
          label: "데이터 부족",
          reason: "노출 또는 조회수가 아직 적어 추가 관찰이 필요합니다."
        };
      }

      const strongVisit = benchmarks.p75VisitRate > 0 && item.visitRate >= benchmarks.p75VisitRate;
      const healthyVisit = benchmarks.medianVisitRate > 0 && item.visitRate >= benchmarks.medianVisitRate * 1.08;
      const weakVisit = benchmarks.medianVisitRate > 0 && item.visitRate < benchmarks.medianVisitRate * 0.88;
      const strongView = benchmarks.medianViewRate > 0 && item.viewRate >= benchmarks.medianViewRate;
      const strongImpressionVisit = benchmarks.p75ImpressionVisitRate > 0 && item.impressionVisitRate >= benchmarks.p75ImpressionVisitRate;
      const enoughVisitors = benchmarks.medianVisitors > 0 && item.visitors >= benchmarks.medianVisitors;
      const efficientCpv = item.cpv > 0 && (!benchmarks.medianCpv || item.cpv <= benchmarks.medianCpv * 1.15);
      const costly = benchmarks.avgCost > 0 && item.cost >= benchmarks.avgCost * 1.15;
      const weakView = benchmarks.medianViewRate > 0 && item.viewRate < benchmarks.medianViewRate * 0.75;
      const highVisitCost = item.cpv > 0 && benchmarks.medianCpv > 0 && item.cpv >= benchmarks.medianCpv * 1.35;

      if (strongVisit && strongView && enoughVisitors && efficientCpv) {
        return {
          key: "core",
          label: "핵심 프로모션",
          reason: "조회 후 방문 전환이 상위권이고 조회 흐름도 안정적입니다."
        };
      }

      if ((strongVisit || (healthyVisit && strongImpressionVisit)) && enoughVisitors && efficientCpv) {
        return {
          key: "scale",
          label: "확대 후보",
          reason: "조회에서 방문으로 이어지는 흐름이 좋아 예산 확대를 검토할 수 있습니다."
        };
      }

      if (costly && (weakVisit || weakView || highVisitCost)) {
        return {
          key: "review",
          label: "점검 필요",
          reason: "비용 규모 대비 조회 또는 방문 전환 흐름이 약합니다."
        };
      }

      if (item.views >= benchmarks.medianViews * 1.1 && weakVisit) {
        return {
          key: "creative",
          label: "조회-방문 약함",
          reason: "조회는 발생하지만 웹사이트 방문으로 충분히 이어지지 않습니다."
        };
      }

      return {
        key: "maintain",
        label: "유지",
        reason: "현재 필터 기준에서 평균적인 성과 흐름입니다."
      };
    }

    function applyPromotionAnalysis(items) {
      const benchmarks = getPromotionBenchmarks(items);
      const scoreMap = new Map(scorePromotions(items).map((item) => [item.id, item.performanceScore]));
      return items.map((item) => {
        const grade = classifyPromotion(item, benchmarks);
        return {
          ...item,
          performanceScore: scoreMap.get(item.id) ?? 0,
          gradeKey: grade.key,
          gradeLabel: grade.label,
          gradeReason: grade.reason
        };
      });
    }

    function getEnrichedPromotions() {
      return appState.promotions.map(enrichPromotion);
    }

    function getFilteredPromotions() {
      const keyword = appState.filters.search.trim().toLowerCase();
      const filtered = getEnrichedPromotions().filter((item) => {
        const matchesSearch = !keyword || [item.name, item.title, item.description, item.videoUrl]
          .join(" ")
          .toLowerCase()
          .includes(keyword);
        const matchesStatus = appState.filters.status === "all" || item.status === appState.filters.status;
        const matchesGoal = appState.filters.goal === "all" || item.goal === appState.filters.goal;
        return matchesSearch && matchesStatus && matchesGoal;
      });
      return applyPromotionAnalysis(filtered);
    }

    function loadPromotions() {
      try {
        appState.promotions = JSON.parse(localStorage.getItem(STORAGE_KEYS.promotions)) || [];
      } catch (error) {
        appState.promotions = [];
        showToast("저장된 데이터를 읽지 못해 빈 상태로 시작합니다.");
      }
    }

    function savePromotions() {
      localStorage.setItem(STORAGE_KEYS.promotions, JSON.stringify(appState.promotions));
    }

    function setRoute(route) {
      if (route === "dashboard") window.location.hash = "#youtube";
      else if (route === "naverSa") window.location.hash = "#naver-sa";
      else window.location.hash = "#hub";
    }

    function isDashboardActive() {
      return dom.dashboardPage.classList.contains("active");
    }

    function isNaverSaActive() {
      return dom.naverSaPage.classList.contains("active");
    }

    function syncDashboardLayout() {
      if (!isDashboardActive()) return;

      appState.dashboardLayoutTimers.forEach((timer) => clearTimeout(timer));
      appState.dashboardLayoutTimers = [];

      const sync = () => {
        document.documentElement.scrollLeft = 0;
        document.body.scrollLeft = 0;
        document.querySelectorAll(".table-wrap").forEach((wrap) => {
          wrap.scrollLeft = 0;
        });
        if (appState.table) appState.table.redraw(true);
        Object.values(appState.charts).forEach((chart) => chart.resize());
      };

      requestAnimationFrame(() => {
        sync();
        requestAnimationFrame(sync);
      });

      [80, 180, 360].forEach((delay) => {
        appState.dashboardLayoutTimers.push(setTimeout(sync, delay));
      });
    }

    function ensureDashboardReady() {
      if (!appState.table) initTable();
      renderAll();
      syncDashboardLayout();
      if (!appState.dashboardFontsQueued && document.fonts && document.fonts.ready) {
        appState.dashboardFontsQueued = true;
        document.fonts.ready.then(syncDashboardLayout);
      }
    }

    function applyRoute() {
      const route = window.location.hash === "#youtube" ? "dashboard" : window.location.hash === "#naver-sa" ? "naverSa" : "hub";
      dom.hubPage.classList.toggle("active", route === "hub");
      dom.dashboardPage.classList.toggle("active", route === "dashboard");
      dom.naverSaPage.classList.toggle("active", route === "naverSa");
      dom.backToHubBtn.hidden = route === "hub";
      dom.loadSampleBtn.hidden = route !== "dashboard";
      dom.addPromotionBtn.hidden = route !== "dashboard";
      dom.pageTitle.textContent = route === "naverSa" ? "네이버 SA 성과 분석" : "성과 분석 대시보드";
      dom.pageSubtitle.textContent = route === "dashboard" ? "프로모션 성과 분석" : route === "naverSa" ? "검색광고 성과 판단" : "채널별 성과 보기";
      if (route === "dashboard") {
        ensureDashboardReady();
      } else if (route === "naverSa") {
        if (window.NaverSaDashboard) window.NaverSaDashboard.activate();
      } else if (window.NaverSaDashboard) {
        window.NaverSaDashboard.deactivate();
      }
    }

    function applyTheme(theme) {
      document.documentElement.dataset.theme = theme;
      dom.themeIcon.textContent = theme === "dark" ? "L" : "D";
      localStorage.setItem(STORAGE_KEYS.theme, theme);
      if (isDashboardActive()) {
        updateFunnelChart();
        syncDashboardLayout();
      } else if (isNaverSaActive() && window.NaverSaDashboard) {
        window.NaverSaDashboard.activate();
      }
    }

    function initTheme() {
      const stored = localStorage.getItem(STORAGE_KEYS.theme);
      applyTheme(stored || "light");
    }

    function getChartColors() {
      const styles = getComputedStyle(document.documentElement);
      return {
        ink: styles.getPropertyValue("--ink").trim(),
        muted: styles.getPropertyValue("--muted").trim(),
        line: styles.getPropertyValue("--line").trim(),
        surface: styles.getPropertyValue("--surface").trim(),
        youtube: styles.getPropertyValue("--youtube").trim(),
        green: styles.getPropertyValue("--green").trim(),
        blue: styles.getPropertyValue("--blue").trim(),
        amber: styles.getPropertyValue("--amber").trim()
      };
    }

    function getTotals(items = getEnrichedPromotions()) {
      const totals = items.reduce((acc, item) => {
        acc.cost += toNumber(item.cost);
        acc.impressions += toNumber(item.impressions);
        acc.views += toNumber(item.views);
        acc.subscribers += toNumber(item.subscribers);
        acc.visitors += toNumber(item.visitors);
        return acc;
      }, { cost: 0, impressions: 0, views: 0, subscribers: 0, visitors: 0 });

      return {
        ...totals,
        averageCpv: divide(totals.cost, totals.visitors),
        averageViewCost: divide(totals.cost, totals.views),
        averageVisitCpv: divide(totals.cost, totals.visitors),
        averageVisitRate: percent(totals.visitors, totals.views),
        averageSubscribeRate: percent(totals.subscribers, totals.views)
      };
    }

    // 베스트 프로모션 추천 점수입니다.
    // 방문율과 구독 전환율은 높을수록, 방문자당 비용과 CPV는 낮을수록 높은 점수를 받습니다.
    function scorePromotions(items = getEnrichedPromotions()) {
      if (!items.length) return [];
      const values = {
        viewRate: items.map((item) => item.viewRate),
        impressionVisitRate: items.map((item) => item.impressionVisitRate),
        visitRate: items.map((item) => item.visitRate),
        cpv: items.map((item) => item.cpv).filter((value) => value > 0)
      };

      const minMax = (list) => ({
        min: Math.min(...list, 0),
        max: Math.max(...list, 0)
      });

      const ranges = {
        viewRate: minMax(values.viewRate),
        impressionVisitRate: minMax(values.impressionVisitRate),
        visitRate: minMax(values.visitRate),
        cpv: minMax(values.cpv.length ? values.cpv : [0])
      };

      const normalizeHigh = (value, range) => range.max === range.min ? 0.5 : (value - range.min) / (range.max - range.min);
      const normalizeLow = (value, range) => {
        if (!value) return 0;
        return range.max === range.min ? 0.5 : (range.max - value) / (range.max - range.min);
      };

      return items.map((item) => {
        const score =
          normalizeHigh(item.visitRate, ranges.visitRate) * 62 +
          normalizeHigh(item.impressionVisitRate, ranges.impressionVisitRate) * 17 +
          normalizeHigh(item.viewRate, ranges.viewRate) * 13 +
          normalizeLow(item.cpv, ranges.cpv) * 8;

        return {
          ...item,
          performanceScore: round(score, 1)
        };
      }).sort((a, b) => b.performanceScore - a.performanceScore);
    }

    function median(list) {
      const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
      if (!sorted.length) return 0;
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    }

    function percentile(list, ratio) {
      const sorted = list.filter(Number.isFinite).sort((a, b) => a - b);
      if (!sorted.length) return 0;
      const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
      return sorted[index];
    }

    // 이상치 탐지는 중앙값 기반의 가벼운 규칙으로 처리합니다.
    // 데이터가 적은 내부 운영 환경에서도 평균값보다 덜 흔들리는 기준을 쓰기 위함입니다.
    function detectOutliers(items = getEnrichedPromotions()) {
      if (items.length < 2) return [];
      const medianViews = median(items.map((item) => item.views));
      const medianVisitRate = median(items.map((item) => item.visitRate));
      const medianCostPerVisitor = median(items.map((item) => item.costPerVisitor).filter((value) => value > 0));
      const outliers = [];

      items.forEach((item) => {
        if (item.views > medianViews * 1.25 && item.visitRate < medianVisitRate * 0.7) {
          outliers.push({
            type: "조회 대비 방문 저조",
            item,
            detail: `${formatNumber(item.views)}회 조회를 만들었지만 방문율은 ${formatPercent(item.visitRate)}입니다.`
          });
        }
        if (item.costPerVisitor > medianCostPerVisitor * 1.45 && item.visitors > 0) {
          outliers.push({
            type: "방문자당 비용 높음",
            item,
            detail: `방문자당 비용이 ${formatUnitCurrency(item.costPerVisitor)}로 중앙값보다 높습니다.`
          });
        }
        if (item.subscribeRate > median(items.map((target) => target.subscribeRate)) * 1.5 && item.subscribers > 0) {
          outliers.push({
            type: "구독 전환 강세",
            item,
            detail: `구독 전환율 ${formatPercent(item.subscribeRate)}로 후속 소재 확장 후보입니다.`
          });
        }
      });

      return outliers.slice(0, 4);
    }

    function renderKpis() {
      const totals = getTotals(getFilteredPromotions());
      const kpis = [
        { label: "총 비용", value: formatKpiCurrency(totals.cost), note: formatCurrency(totals.cost), color: "var(--youtube)" },
        { label: "총 조회수", value: formatNumber(totals.views), note: "전체 프로모션 합산", color: "var(--green)" },
        { label: "총 방문자 수", value: formatNumber(totals.visitors), note: `방문율 ${formatPercent(totals.averageVisitRate)}`, color: "var(--blue)" },
        { label: "방문 CPV", value: formatUnitCurrency(totals.averageCpv), note: "비용 ÷ 방문자 수", color: "var(--green)" }
      ];

      dom.kpiGrid.innerHTML = kpis.map((kpi) => `
        <article class="kpi-card">
          <div class="kpi-label"><span>${kpi.label}</span><i class="kpi-dot" style="background:${kpi.color}"></i></div>
          <span class="kpi-value">${kpi.value}</span>
          <div class="kpi-note">${kpi.note}</div>
        </article>
      `).join("");
    }

    function renderCoreMetrics() {
      const items = getFilteredPromotions();
      if (!items.length) {
        dom.coreMetricGrid.innerHTML = emptyStateMarkup("표시할 핵심 지표가 없습니다", "프로모션을 등록하거나 CSV를 가져오면 CPV와 방문율 기준으로 정리됩니다.");
        return;
      }

      const lowCpv = [...items].filter((item) => item.cpv > 0).sort((a, b) => a.cpv - b.cpv).slice(0, 5);
      const highVisitRate = [...items].filter((item) => item.views > 0).sort((a, b) => b.visitRate - a.visitRate).slice(0, 5);
      const lowVisitRate = [...items].filter((item) => item.views > 0).sort((a, b) => a.visitRate - b.visitRate).slice(0, 5);

      dom.coreMetricGrid.innerHTML = [
        metricRankCard("CPV 낮은 순", "lowCpv", lowCpv, (item) => formatUnitCurrency(item.cpv)),
        metricRankCard("방문율 높은 순", "highVisitRate", highVisitRate, (item) => formatPercent(item.visitRate)),
        metricRankCard("방문율 낮은 순", "lowVisitRate", lowVisitRate, (item) => formatPercent(item.visitRate))
      ].join("");
    }

    function metricRankCard(title, detailKey, items, valueFormatter) {
      if (!items.length) {
        return `
          <article class="insight-card">
            <h3>${title}</h3>
            <p>계산 가능한 데이터가 아직 없습니다.</p>
          </article>
        `;
      }

      return `
        <article class="insight-card">
          <div class="section-header" style="margin-bottom:0;">
            <h3>${title}</h3>
            <button class="btn btn-ghost" type="button" data-metric-detail="${detailKey}">자세히 보기</button>
          </div>
          <div class="rank-list">
            ${items.map((item, index) => `
              <div class="rank-row">
                <span class="rank-index">${index + 1}</span>
                <span class="rank-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.title || "-")}</span></span>
                <span class="rank-score">${valueFormatter(item)}</span>
              </div>
            `).join("")}
          </div>
        </article>
      `;
    }

    function getMetricDetailConfig(key) {
      return {
        lowCpv: {
          title: "CPV 낮은 순 전체보기",
          valueLabel: "CPV",
          sort: (a, b) => a.cpv - b.cpv,
          filter: (item) => item.cpv > 0,
          value: (item) => formatUnitCurrency(item.cpv)
        },
        highVisitRate: {
          title: "방문율 높은 순 전체보기",
          valueLabel: "방문율",
          sort: (a, b) => b.visitRate - a.visitRate,
          filter: (item) => item.views > 0,
          value: (item) => formatPercent(item.visitRate)
        },
        lowVisitRate: {
          title: "방문율 낮은 순 전체보기",
          valueLabel: "방문율",
          sort: (a, b) => a.visitRate - b.visitRate,
          filter: (item) => item.views > 0,
          value: (item) => formatPercent(item.visitRate)
        }
      }[key];
    }

    function openMetricDetail(key) {
      const config = getMetricDetailConfig(key);
      if (!config) return;
      const rows = getFilteredPromotions().filter(config.filter).sort(config.sort);
      dom.metricDetailTitle.textContent = config.title;
      dom.metricDetailBody.innerHTML = rows.length ? rows.map((item, index) => `
        <div class="detail-row">
          <strong>${index + 1}</strong>
          <strong title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
          <span>${config.value(item)}</span>
          <span>방문율 ${formatPercent(item.visitRate)}</span>
        </div>
      `).join("") : `
        <div class="empty-state">
          <div>
            <h3>표시할 데이터가 없습니다</h3>
            <p>계산 가능한 프로모션 데이터가 생기면 이곳에서 전체 목록을 볼 수 있습니다.</p>
          </div>
        </div>
      `;
      dom.metricDetailModalBackdrop.classList.add("open");
    }

    function closeMetricDetail() {
      dom.metricDetailModalBackdrop.classList.remove("open");
    }

    function renderSignals() {
      const items = getFilteredPromotions();
      const scored = scorePromotions(items);
      const best = scored[0];
      const totals = getTotals(items);
      const outlier = detectOutliers(items)[0];
      const lowVisit = [...items].filter((item) => item.views > 0).sort((a, b) => a.visitRate - b.visitRate)[0];

      if (!items.length) {
        dom.summarySignals.innerHTML = `
          <article class="signal-card">
            <h3>추천</h3>
            <strong>데이터 입력 대기</strong>
            <p>프로모션 데이터를 등록하면 자동 추천과 이상치 탐지가 활성화됩니다.</p>
          </article>
          <article class="signal-card">
            <h3>효율</h3>
            <strong>-</strong>
            <p>방문율, 구독 전환율, 방문자당 비용을 종합합니다.</p>
          </article>
          <article class="signal-card">
            <h3>진단</h3>
            <strong>-</strong>
            <p>조회수는 높지만 방문 전환이 낮은 캠페인을 찾습니다.</p>
          </article>
        `;
        return;
      }

      dom.summarySignals.innerHTML = `
        <article class="signal-card good">
          <h3>베스트 프로모션 추천</h3>
          <strong>${escapeHtml(best.name)}</strong>
          <p>종합 점수 ${best.performanceScore}점. 방문율 ${formatPercent(best.visitRate)}, 구독 전환율 ${formatPercent(best.subscribeRate)}.</p>
        </article>
        <article class="signal-card hot">
          <h3>비용 대비 방문 확보</h3>
          <strong>${formatUnitCurrency(divide(totals.cost, totals.visitors))}</strong>
          <p>전체 방문자당 비용입니다. 방문자 수 ${formatNumber(totals.visitors)}명 기준으로 계산했습니다.</p>
        </article>
        <article class="signal-card warn">
          <h3>${outlier ? outlier.type : "방문 전환 점검"}</h3>
          <strong>${escapeHtml(outlier ? outlier.item.name : lowVisit.name)}</strong>
          <p>${outlier ? escapeHtml(outlier.detail) : `방문율 ${formatPercent(lowVisit.visitRate)}로 가장 낮습니다.`}</p>
        </article>
      `;
    }

    // Tabulator가 데이터 테이블의 검색 결과 표시, 정렬, 페이지네이션,
    // 컬럼 이동/숨김, CSV 다운로드를 담당합니다.
    function initTable() {
      appState.table = new Tabulator("#promotionsTable", {
        data: getFilteredPromotions(),
        layout: "fitDataStretch",
        responsiveLayout: "collapse",
        pagination: "local",
        paginationSize: 10,
        locale: "ko",
        langs: {
          ko: {
            pagination: {
              first: "처음",
              first_title: "처음 페이지",
              last: "마지막",
              last_title: "마지막 페이지",
              prev: "이전",
              prev_title: "이전 페이지",
              next: "다음",
              next_title: "다음 페이지"
            }
          }
        },
        movableColumns: true,
        placeholder: "등록된 프로모션 데이터가 없습니다.",
        columns: [
          { title: "프로모션명", field: "name", frozen: true, minWidth: 180 },
          { title: "상태", field: "statusLabel", width: 110, formatter: statusFormatter },
          { title: "프로모션 등급", field: "gradeLabel", width: 140, formatter: gradeFormatter },
          { title: "목표", field: "goalLabel", width: 100 },
          { title: "생성일", field: "createdAt", width: 120, sorter: "date", formatter: (cell) => dayjs(cell.getValue()).format("YYYY.MM.DD") },
          { title: "비용", field: "cost", hozAlign: "right", sorter: "number", formatter: (cell) => formatCurrency(cell.getValue()) },
          { title: "조회수", field: "views", hozAlign: "right", sorter: "number", formatter: (cell) => formatNumber(cell.getValue()) },
          { title: "방문자 수", field: "visitors", hozAlign: "right", sorter: "number", formatter: (cell) => formatNumber(cell.getValue()) },
          { title: "방문 CPV", field: "cpv", hozAlign: "right", sorter: "number", formatter: (cell) => formatUnitCurrency(cell.getValue()) },
          { title: "방문율", field: "visitRate", hozAlign: "right", sorter: "number", formatter: (cell) => formatPercent(cell.getValue()) },
          { title: "관리", field: "actions", width: 180, hozAlign: "center", headerSort: false, formatter: actionFormatter }
        ]
      });

      $("#promotionsTable").addEventListener("click", handleTableActionClick);
    }

    function statusFormatter(cell) {
      const row = cell.getRow().getData();
      return `<span class="pill ${row.status}">${row.statusLabel}</span>`;
    }

    function gradeFormatter(cell) {
      const row = cell.getRow().getData();
      return `<span class="action-badge grade-${row.gradeKey}" title="${escapeHtml(row.gradeReason || "")}">${escapeHtml(row.gradeLabel || "-")}</span>`;
    }

    function actionFormatter(cell) {
      const id = cell.getRow().getData().id;
      return `
        <span class="table-actions">
          <button class="mini-btn" type="button" data-action="edit" data-id="${id}">수정</button>
          <button class="mini-btn" type="button" data-action="clone" data-id="${id}">복제</button>
          <button class="mini-btn" type="button" data-action="delete" data-id="${id}">삭제</button>
        </span>
      `;
    }

    function handleTableActionClick(event) {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      const { action, id } = button.dataset;
      if (action === "edit") openPromotionModal(id);
      if (action === "clone") clonePromotion(id);
      if (action === "delete") confirmDeletePromotion(id);
    }

    function buildColumnPanel() {
      if (!appState.table) return;
      const columns = appState.table.getColumns().filter((column) => column.getField() && column.getField() !== "actions");
      dom.columnPanel.innerHTML = columns.map((column) => {
        const def = column.getDefinition();
        return `
          <label class="check-row">
            <input type="checkbox" data-field="${def.field}" ${column.isVisible() ? "checked" : ""} />
            <span>${def.title}</span>
          </label>
        `;
      }).join("");
    }

    function updateTable() {
      if (!appState.table) return;
      appState.table.replaceData(getFilteredPromotions());
    }

    function createBaseChart(canvasId, config) {
      const existing = appState.charts[canvasId];
      if (existing) existing.destroy();
      const ctx = document.getElementById(canvasId);
      appState.charts[canvasId] = new Chart(ctx, config);
    }

    function chartOptions(extra = {}) {
      const colors = getChartColors();
      return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        plugins: {
          legend: {
            labels: {
              color: colors.muted,
              boxWidth: 10,
              boxHeight: 10
            }
          },
          tooltip: {
            backgroundColor: colors.ink,
            titleColor: colors.surface,
            bodyColor: colors.surface,
            padding: 12,
            displayColors: false
          }
        },
        scales: {
          x: {
            grid: { color: colors.line },
            ticks: { color: colors.muted, maxRotation: 0, autoSkip: true }
          },
          y: {
            beginAtZero: true,
            grid: { color: colors.line },
            ticks: { color: colors.muted }
          }
        },
        ...extra
      };
    }

    // Chart.js 인스턴스는 필터나 데이터 변경 때마다 재생성합니다.
    // 데이터 규모가 작고 운영자가 즉시 결과를 확인하는 UX라 단순한 갱신 전략이 유지보수에 유리합니다.
    function updateCharts() {
      if (!window.Chart) return;
      const colors = getChartColors();
      const items = getFilteredPromotions();
      const labels = items.map((item) => item.name);
      const shortLabels = labels.map((label) => label.length > 12 ? `${label.slice(0, 12)}...` : label);
      const totals = getTotals(items);

      createBaseChart("costVisitorsChart", {
        type: "scatter",
        data: {
          datasets: [{
            label: "프로모션",
            data: items.map((item) => ({ x: item.cost, y: item.visitors, label: item.name })),
            pointRadius: 6,
            pointHoverRadius: 8,
            backgroundColor: colors.youtube,
            borderColor: colors.ink
          }]
        },
        options: chartOptions({
          parsing: false,
          scales: {
            x: {
              beginAtZero: true,
              title: { display: true, text: "비용", color: colors.muted },
              grid: { color: colors.line },
              ticks: { color: colors.muted, callback: (value) => formatKpiCurrency(value) }
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: "방문자 수", color: colors.muted },
              grid: { color: colors.line },
              ticks: { color: colors.muted, callback: (value) => formatNumber(value) }
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: colors.ink,
              titleColor: colors.surface,
              bodyColor: colors.surface,
              callbacks: {
                title: (context) => context[0].raw.label,
                label: (context) => [`비용 ${formatCurrency(context.raw.x)}`, `방문자 ${formatNumber(context.raw.y)}명`]
              }
            }
          }
        })
      });

      createBaseChart("cpVisitorChart", {
        type: "bar",
        data: {
          labels: shortLabels,
          datasets: [{ label: "방문자당 비용", data: items.map((item) => item.costPerVisitor), backgroundColor: colors.green }]
        },
        options: chartOptions({
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (context) => formatUnitCurrency(context.raw) } }
          },
          scales: { x: chartOptions().scales.x, y: { ...chartOptions().scales.y, ticks: { color: colors.muted, callback: (value) => formatKpiCurrency(value) } } }
        })
      });

      createBaseChart("viewsChart", {
        type: "bar",
        data: {
          labels: shortLabels,
          datasets: [{ label: "조회수", data: items.map((item) => item.views), backgroundColor: colors.blue }]
        },
        options: chartOptions({
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (context) => `${formatNumber(context.raw)}회` } }
          }
        })
      });

      createBaseChart("visitRateChart", {
        type: "bar",
        data: {
          labels: shortLabels,
          datasets: [{ label: "방문율", data: items.map((item) => round(item.visitRate, 2)), backgroundColor: colors.amber }]
        },
        options: chartOptions({
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (context) => formatPercent(context.raw) } }
          },
          scales: { x: chartOptions().scales.x, y: { ...chartOptions().scales.y, ticks: { color: colors.muted, callback: (value) => `${value}%` } } }
        })
      });

      const funnelLabels = ["노출수", "조회수", "방문자 수", "구독자 수"];
      const funnelValues = [totals.impressions, totals.views, totals.visitors, totals.subscribers];
      createBaseChart("funnelChart", {
        type: "bar",
        data: {
          labels: funnelLabels,
          datasets: [{
            label: "퍼널",
            data: funnelValues,
            backgroundColor: [colors.youtube, colors.blue, colors.green, colors.amber],
            borderRadius: 7
          }]
        },
        options: chartOptions({
          indexAxis: "y",
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const previous = context.dataIndex === 0 ? context.raw : funnelValues[context.dataIndex - 1];
                  const retention = context.dataIndex === 0 ? 100 : percent(context.raw, previous);
                  const drop = 100 - retention;
                  return `${formatNumber(context.raw)} · 전 단계 이탈률 ${formatPercent(drop)}`;
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: colors.line },
              ticks: { color: colors.muted, callback: (value) => formatNumber(value) }
            },
            y: {
              grid: { display: false },
              ticks: { color: colors.muted }
            }
          }
        })
      });
    }

    // 인사이트 영역은 마케터의 핵심 질문에 직접 답하도록 구성합니다.
    // 종합 추천, 방문율 TOP, 구독 전환 TOP, 비용 효율, 성과 순위, 이상치를 한 번에 제공합니다.
    function updateFunnelChart() {
      if (!window.Chart || !document.getElementById("funnelChart") || !isDashboardActive()) return;
      const colors = getChartColors();
      const totals = getTotals(getFilteredPromotions());
      const funnelLabels = ["노출수", "조회수", "방문자 수"];
      const funnelValues = [totals.impressions, totals.views, totals.visitors];

      createBaseChart("funnelChart", {
        type: "bar",
        data: {
          labels: funnelLabels,
          datasets: [{
            label: "전체 퍼널",
            data: funnelValues,
            backgroundColor: [colors.blue, colors.green, colors.youtube],
            borderRadius: 14,
            barThickness: 34
          }]
        },
        options: chartOptions({
          indexAxis: "y",
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (context) => {
                  const previous = context.dataIndex === 0 ? context.raw : funnelValues[context.dataIndex - 1];
                  const retention = context.dataIndex === 0 ? 100 : percent(context.raw, previous);
                  const drop = context.dataIndex === 0 ? 0 : 100 - retention;
                  return `${formatNumber(context.raw)} · 전 단계 이탈률 ${formatPercent(drop)}`;
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: colors.line },
              ticks: { color: colors.muted, callback: (value) => formatNumber(value) }
            },
            y: {
              grid: { display: false },
              ticks: { color: colors.muted }
            }
          }
        })
      });
    }

    function switchYoutubeAnalysisTab(tab) {
      appState.youtubeInsightTab = tab;
      if (!dom.youtubeInsightTabs) return;
      dom.youtubeInsightTabs.querySelectorAll("[data-youtube-analysis-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.youtubeAnalysisTab === tab);
      });
      document.querySelectorAll("[data-youtube-analysis-panel]").forEach((panel) => {
        panel.classList.toggle("active", panel.dataset.youtubeAnalysisPanel === tab);
      });
    }

    function promotionListMarkup(items, valueFormatter) {
      if (!items.length) return `<p>현재 필터 기준으로 표시할 항목이 없습니다.</p>`;
      return `
        <div class="decision-list">
          ${items.map((item, index) => `
            <div class="decision-row">
              <span class="rank-index">${index + 1}</span>
              <span class="decision-main">
                <strong>${escapeHtml(item.name)}</strong>
                <span>조회→방문 ${formatPercent(item.visitRate)} · 노출→조회 ${formatPercent(item.viewRate)} · 방문 CPV ${formatUnitCurrency(item.cpv)}</span>
              </span>
              <span class="action-badge grade-${item.gradeKey}">${escapeHtml(item.gradeLabel)}</span>
              <span class="decision-score">${valueFormatter(item)}</span>
            </div>
          `).join("")}
        </div>
      `;
    }

    function renderYoutubeInsightSummary(items, totals) {
      if (!dom.youtubeInsightSummary) return;
      if (!items.length) {
        dom.youtubeInsightSummary.innerHTML = emptyStateMarkup("분석할 프로모션 데이터가 없습니다", "프로모션을 등록하거나 CSV를 가져오면 인사이트가 표시됩니다.");
        return;
      }

      const scored = scorePromotions(items);
      const best = scored[0];
      const benchmarks = getPromotionBenchmarks(items);
      const coreItems = items.filter((item) => ["core", "scale"].includes(item.gradeKey)).sort((a, b) => b.performanceScore - a.performanceScore);
      const reviewItems = items.filter((item) => ["review", "creative"].includes(item.gradeKey)).sort((a, b) => b.cost - a.cost);
      const highViewLowVisit = [...items]
        .filter((item) => item.views >= benchmarks.medianViews && item.visitRate < benchmarks.medianVisitRate)
        .sort((a, b) => b.views - a.views)
        .slice(0, 4);

      dom.youtubeInsightSummary.innerHTML = `
        <div class="analysis-card-grid">
          <article class="analysis-card featured">
            <h3>핵심 퍼널</h3>
            <h4>조회 → 방문 ${formatPercent(totals.averageVisitRate)}</h4>
            <p>총 비용 ${formatCurrency(totals.cost)}, 조회 ${formatNumber(totals.views)}회, 웹사이트 방문 ${formatNumber(totals.visitors)}명입니다. 확대 판단은 조회 후 방문 전환을 최우선으로 봅니다.</p>
            <div class="metric-pairs">
              <div class="metric-pair primary"><span>조회 → 방문</span><strong>${formatPercent(totals.averageVisitRate)}</strong></div>
              <div class="metric-pair"><span>노출 → 방문</span><strong>${formatPercent(percent(totals.visitors, totals.impressions))}</strong></div>
              <div class="metric-pair"><span>노출 → 조회</span><strong>${formatPercent(percent(totals.views, totals.impressions))}</strong></div>
              <div class="metric-pair"><span>방문 CPV</span><strong>${formatUnitCurrency(totals.averageCpv)}</strong></div>
            </div>
          </article>
          <article class="analysis-card positive">
            <h3>확대 가능한 흐름</h3>
            <h4>${coreItems.length ? escapeHtml(coreItems[0].name) : "상위 방문 전환 후보 없음"}</h4>
            <p>${coreItems.length ? escapeHtml(coreItems[0].gradeReason) : "조회→방문 전환이 상위권인 소재가 아직 뚜렷하지 않습니다."}</p>
            ${promotionListMarkup(coreItems.slice(0, 4), (item) => `${item.performanceScore}점`)}
          </article>
          <article class="analysis-card warning">
            <h3>예산/소재 점검</h3>
            <h4>${reviewItems.length ? escapeHtml(reviewItems[0].name) : "뚜렷한 점검 후보 없음"}</h4>
            <p>${reviewItems.length ? escapeHtml(reviewItems[0].gradeReason) : "현재 필터 기준에서는 큰 비용 낭비 신호가 강하지 않습니다."}</p>
            ${promotionListMarkup(reviewItems.slice(0, 4), (item) => formatCurrency(item.cost))}
          </article>
          <article class="analysis-card danger">
            <h3>조회는 있는데 방문이 약함</h3>
            <h4>${highViewLowVisit.length ? escapeHtml(highViewLowVisit[0].name) : "후보 없음"}</h4>
            <p>조회는 만들지만 웹사이트 방문으로 충분히 이어지지 않는 소재입니다. 제목의 약속, CTA, 랜딩 연결을 우선 점검합니다.</p>
            ${promotionListMarkup(highViewLowVisit, (item) => formatPercent(item.visitRate))}
          </article>
        </div>
      `;
    }

    function budgetActionForPromotion(item) {
      if (item.gradeKey === "insufficient") {
        return { key: "hold", label: "판단 보류", reason: "데이터가 적어 예산 판단은 조금 더 지켜보는 편이 좋습니다." };
      }
      if (["core", "scale"].includes(item.gradeKey)) {
        return { key: "up", label: "예산 증액 검토", reason: "조회 후 방문 전환이 좋아 예산 확대 테스트 후보입니다." };
      }
      if (["review", "creative"].includes(item.gradeKey)) {
        return { key: "down", label: "예산 축소/점검", reason: "조회가 방문으로 이어지는 힘이 약해 소재 또는 타겟 점검 후 예산 조정이 필요합니다." };
      }
      return { key: "keep", label: "유지", reason: "성과가 평균권이라 급한 증액/축소보다는 유지 관찰이 적합합니다." };
    }

    function renderYoutubeBudgetJudgment(items) {
      if (!dom.youtubeBudgetJudgment) return;
      if (!items.length) {
        dom.youtubeBudgetJudgment.innerHTML = emptyStateMarkup("예산 판단을 만들 데이터가 없습니다", "프로모션 데이터를 등록하면 예산 증액, 유지, 축소 후보가 정리됩니다.");
        return;
      }

      const withActions = items.map((item) => ({ ...item, budgetAction: budgetActionForPromotion(item) }));
      const groups = [
        ["up", "예산 증액 검토", "조회→방문 전환이 상위권인 후보입니다.", "positive"],
        ["keep", "유지 후보", "성과가 평균권인 프로모션입니다.", "neutral"],
        ["down", "축소/점검 후보", "조회 후 방문 흐름이 약한 후보입니다.", "warning"],
        ["hold", "판단 보류", "데이터가 더 필요한 항목입니다.", "neutral"]
      ];

      dom.youtubeBudgetJudgment.innerHTML = `
        <div class="analysis-card-grid">
          ${groups.map(([key, title, description, tone]) => {
            const groupItems = withActions.filter((item) => item.budgetAction.key === key).sort((a, b) => b.cost - a.cost).slice(0, 5);
            return `
              <article class="analysis-card ${tone}">
                <h3>${title}</h3>
                <h4>${groupItems.length}개 프로모션</h4>
                <p>${description}</p>
                ${promotionListMarkup(groupItems, (item) => formatPercent(item.visitRate))}
              </article>
            `;
          }).join("")}
        </div>
      `;
    }

    function classifyCreativeMessage(text) {
      const source = String(text || "");
      const groups = [
        { key: "profit", label: "수익 강조형", patterns: ["월", "순수익", "매출", "월천", "1000", "2000", "수익"] },
        { key: "risk", label: "위기/문제 제기형", patterns: ["폐업", "불황", "망설", "고민", "현실", "파산", "레드오션"] },
        { key: "case", label: "성공사례형", patterns: ["사장", "점장", "성공사례", "인터뷰", "매장", "호점"] },
        { key: "easy", label: "쉬운 창업형", patterns: ["왕초보", "처음", "경험 없어도", "소자본", "1인", "가능"] }
      ];
      return groups.find((group) => group.patterns.some((pattern) => source.includes(pattern))) || { key: "general", label: "일반 메시지형" };
    }

    function renderYoutubeCreativeJudgment(items) {
      if (!dom.youtubeCreativeJudgment) return;
      if (!items.length) {
        dom.youtubeCreativeJudgment.innerHTML = emptyStateMarkup("소재/문구 판단을 만들 데이터가 없습니다", "제목과 프로모션명이 쌓이면 문구 유형별 성과를 비교합니다.");
        return;
      }

      const typed = items.map((item) => ({ ...item, messageType: classifyCreativeMessage(`${item.name} ${item.title} ${item.description}`) }));
      const typeMap = new Map();
      typed.forEach((item) => {
        const key = item.messageType.key;
        const current = typeMap.get(key) || { label: item.messageType.label, items: [] };
        current.items.push(item);
        typeMap.set(key, current);
      });

      const typeRows = [...typeMap.values()].map((group) => {
        const totals = getTotals(group.items);
        return {
          ...group,
          totals,
          score: percent(totals.visitors, totals.views) * 0.7
            + percent(totals.visitors, totals.impressions) * 0.2
            + percent(totals.views, totals.impressions) * 0.1
        };
      }).sort((a, b) => b.score - a.score);
      const bestType = typeRows[0];
      const weakType = typeRows[typeRows.length - 1];

      dom.youtubeCreativeJudgment.innerHTML = `
        <div class="analysis-card-grid">
          <article class="analysis-card featured">
            <h3>문구 유형 요약</h3>
            <h4>${escapeHtml(bestType.label)} 흐름 우세</h4>
            <p>조회→방문 전환을 가장 크게 반영했을 때 현재 필터에서는 ${escapeHtml(bestType.label)}이 가장 강합니다.</p>
            ${promotionListMarkup(bestType.items.sort((a, b) => b.performanceScore - a.performanceScore).slice(0, 4), (item) => formatPercent(item.visitRate))}
          </article>
          <article class="analysis-card warning">
            <h3>소재 점검 후보</h3>
            <h4>${escapeHtml(weakType.label)}</h4>
            <p>상대적으로 방문 전환이 낮은 문구 유형입니다. 제목의 약속과 랜딩 CTA 연결을 점검해볼 만합니다.</p>
            ${promotionListMarkup(weakType.items.sort((a, b) => a.visitRate - b.visitRate).slice(0, 4), (item) => formatPercent(item.visitRate))}
          </article>
          <article class="analysis-card wide">
            <h3>유형별 성과 비교</h3>
            <div class="analysis-type-table">
              ${typeRows.map((row) => `
                <div>
                  <strong>${escapeHtml(row.label)}</strong>
                  <span>${row.items.length}개</span>
                  <span>조회 ${formatNumber(row.totals.views)}</span>
                  <span>방문율 ${formatPercent(row.totals.averageVisitRate)}</span>
                  <span>노출→방문 ${formatPercent(percent(row.totals.visitors, row.totals.impressions))}</span>
                  <span>방문 CPV ${formatUnitCurrency(row.totals.averageCpv)}</span>
                </div>
              `).join("")}
            </div>
          </article>
        </div>
      `;
    }

    function renderYoutubeAnalysis() {
      if (!dom.youtubeInsightSummary || !isDashboardActive()) return;
      const items = getFilteredPromotions();
      const totals = getTotals(items);
      renderYoutubeInsightSummary(items, totals);
      renderYoutubeBudgetJudgment(items);
      renderYoutubeCreativeJudgment(items);
      switchYoutubeAnalysisTab(appState.youtubeInsightTab);
    }

    function renderInsights() {
      const items = getFilteredPromotions();
      if (!items.length) {
        dom.insightGrid.innerHTML = emptyStateMarkup("인사이트를 만들 데이터가 없습니다", "프로모션을 등록하거나 CSV를 가져오면 베스트 프로모션, 성과 순위, 이상치 탐지가 표시됩니다.");
        return;
      }

      const scored = scorePromotions(items);
      const best = scored[0];
      const bestVisitRate = [...items].sort((a, b) => b.visitRate - a.visitRate)[0];
      const bestSubscribeRate = [...items].sort((a, b) => b.subscribeRate - a.subscribeRate)[0];
      const bestCostVisitor = [...items].filter((item) => item.costPerVisitor > 0).sort((a, b) => a.costPerVisitor - b.costPerVisitor)[0] || best;
      const outliers = detectOutliers(items);

      const cards = [
        insightCardMarkup("베스트 프로모션 추천", best, `종합 점수 ${best.performanceScore}점`, true),
        insightCardMarkup("방문율 TOP", bestVisitRate, formatPercent(bestVisitRate.visitRate)),
        insightCardMarkup("구독 전환율 TOP", bestSubscribeRate, formatPercent(bestSubscribeRate.subscribeRate)),
        insightCardMarkup("방문자당 비용 최저", bestCostVisitor, formatUnitCurrency(bestCostVisitor.costPerVisitor)),
        rankCardMarkup("성과 순위", scored.slice(0, 4)),
        outlierCardMarkup(outliers)
      ];

      dom.insightGrid.innerHTML = cards.join("");
    }

    function insightCardMarkup(label, item, badge, featured = false) {
      return `
        <article class="insight-card ${featured ? "featured" : ""}">
          <h3>${label} · ${badge}</h3>
          <h4>${escapeHtml(item.name)}</h4>
          <p>${escapeHtml(item.title || "-")}</p>
          <p>${escapeHtml(item.description || "-")}</p>
          <div class="metric-pairs">
            <div class="metric-pair"><span>비용</span><strong>${formatCurrency(item.cost)}</strong></div>
            <div class="metric-pair"><span>조회수</span><strong>${formatNumber(item.views)}</strong></div>
            <div class="metric-pair"><span>방문자</span><strong>${formatNumber(item.visitors)}</strong></div>
            <div class="metric-pair"><span>방문율</span><strong>${formatPercent(item.visitRate)}</strong></div>
            <div class="metric-pair"><span>구독 전환율</span><strong>${formatPercent(item.subscribeRate)}</strong></div>
            <div class="metric-pair"><span>방문자당 비용</span><strong>${formatUnitCurrency(item.costPerVisitor)}</strong></div>
          </div>
        </article>
      `;
    }

    function rankCardMarkup(title, items) {
      return `
        <article class="insight-card">
          <h3>${title}</h3>
          <div class="rank-list">
            ${items.map((item, index) => `
              <div class="rank-row">
                <span class="rank-index">${index + 1}</span>
                <span class="rank-main"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.title || "-")}</span></span>
                <span class="rank-score">${item.performanceScore}점</span>
              </div>
            `).join("")}
          </div>
        </article>
      `;
    }

    function outlierCardMarkup(outliers) {
      if (!outliers.length) {
        return `
          <article class="insight-card">
            <h3>이상치 탐지</h3>
            <h4>뚜렷한 이상치 없음</h4>
            <p>현재 필터 기준에서는 조회 대비 방문 저조, 방문자당 비용 급등, 구독 전환 급등 신호가 강하지 않습니다.</p>
          </article>
        `;
      }

      return `
        <article class="insight-card">
          <h3>이상치 탐지</h3>
          <div class="rank-list">
            ${outliers.map((outlier, index) => `
              <div class="rank-row">
                <span class="rank-index">${index + 1}</span>
                <span class="rank-main"><strong>${escapeHtml(outlier.type)}</strong><span>${escapeHtml(outlier.item.name)}</span></span>
                <span class="rank-score">${escapeHtml(outlier.detail)}</span>
              </div>
            `).join("")}
          </div>
        </article>
      `;
    }

    function renderCreativeLibrary() {
      const scored = scorePromotions(getFilteredPromotions()).slice(0, 6);
      if (!scored.length) {
        dom.creativeGrid.innerHTML = emptyStateMarkup("크리에이티브 라이브러리가 비어 있습니다", "상위 성과 프로모션의 제목과 설명 문구가 이곳에 모입니다.");
        return;
      }

      dom.creativeGrid.innerHTML = scored.map((item) => `
        <article class="creative-card">
          <h3>성과 점수 ${item.performanceScore}점 · ${escapeHtml(item.goalLabel)}</h3>
          <h4>${escapeHtml(item.title || "-")}</h4>
          <p>${escapeHtml(item.description || "-")}</p>
          <div class="metric-pairs">
            <div class="metric-pair"><span>프로모션</span><strong>${escapeHtml(item.name)}</strong></div>
            <div class="metric-pair"><span>방문율</span><strong>${formatPercent(item.visitRate)}</strong></div>
            <div class="metric-pair"><span>구독 전환율</span><strong>${formatPercent(item.subscribeRate)}</strong></div>
            <div class="metric-pair"><span>방문자당 비용</span><strong>${formatUnitCurrency(item.costPerVisitor)}</strong></div>
          </div>
        </article>
      `).join("");
    }

    function emptyStateMarkup(title, description) {
      return `
        <div class="empty-state" style="grid-column:1/-1;">
          <div>
            <h3>${title}</h3>
            <p>${description}</p>
            <button class="btn btn-primary" type="button" onclick="openPromotionModal()">프로모션 등록</button>
          </div>
        </div>
      `;
    }

    function renderAll() {
      renderKpis();
      updateTable();
      updateFunnelChart();
      renderYoutubeAnalysis();
    }

    function openPromotionModal(id = null) {
      appState.currentEditId = id;
      const item = id ? appState.promotions.find((promotion) => promotion.id === id) : null;
      dom.promotionModalTitle.textContent = item ? "프로모션 수정" : "프로모션 등록";
      dom.promotionForm.reset();
      dom.studioPasteInput.value = "";
      dom.pastePreview.textContent = "붙여넣은 내용을 자동으로 분석합니다.";
      switchPromotionTab("direct");
      dom.promotionForm.elements.createdAt.value = dayjs().format("YYYY-MM-DD");

      if (item) {
        Object.entries(item).forEach(([key, value]) => {
          if (dom.promotionForm.elements[key]) dom.promotionForm.elements[key].value = value;
        });
      }

      dom.promotionModalBackdrop.classList.add("open");
      setTimeout(() => dom.promotionForm.elements.name.focus(), 50);
    }

    function closePromotionModal() {
      dom.promotionModalBackdrop.classList.remove("open");
      appState.currentEditId = null;
    }

    function handlePromotionSubmit(event) {
      event.preventDefault();
      const formData = new FormData(dom.promotionForm);
      const payload = normalizePromotion(Object.fromEntries(formData.entries()));

      if (appState.currentEditId) {
        appState.promotions = appState.promotions.map((item) => item.id === appState.currentEditId ? { ...item, ...payload } : item);
        showToast("프로모션이 수정되었습니다.");
      } else {
        appState.promotions.unshift({ id: uid(), ...payload });
        showToast("프로모션이 등록되었습니다.");
      }

      savePromotions();
      closePromotionModal();
      renderAll();
    }

    function normalizePromotion(data) {
      return {
        name: String(data.name || "").trim(),
        status: data.status || "active",
        goal: data.goal || "traffic",
        createdAt: data.createdAt || dayjs().format("YYYY-MM-DD"),
        title: String(data.title || "").trim(),
        description: String(data.description || "").trim(),
        videoUrl: String(data.videoUrl || "").trim(),
        cost: toNumber(data.cost),
        impressions: toNumber(data.impressions),
        views: toNumber(data.views),
        subscribers: toNumber(data.subscribers),
        visitors: toNumber(data.visitors)
      };
    }

    function switchPromotionTab(mode) {
      appState.promotionEntryMode = mode;
      dom.promotionTabs.querySelectorAll("[data-promotion-tab]").forEach((button) => {
        button.classList.toggle("active", button.dataset.promotionTab === mode);
      });
      dom.directEntryPanel.classList.toggle("active", mode === "direct");
      dom.pasteEntryPanel.classList.toggle("active", mode === "paste");
      dom.savePromotionBtn.hidden = mode !== "direct";
      dom.importPasteBtn.hidden = mode !== "paste";
      if (mode === "paste") {
        updatePastePreview();
        setTimeout(() => dom.studioPasteInput.focus(), 50);
      }
    }

    function cleanStudioLine(line) {
      return String(line || "").replace(/\s+/g, " ").trim();
    }

    function isStudioPreviewImageLine(line) {
      return /^(?:동영상\s*)?미리보기\s*이미지\s*:/i.test(cleanStudioLine(line));
    }

    function normalizeStudioPasteLine(line) {
      const cleaned = cleanStudioLine(line);
      return isStudioPreviewImageLine(cleaned) ? "" : cleaned;
    }

    function isStudioMetricLine(line) {
      const text = cleanStudioLine(line);
      if (!text) return false;
      if (/^[₩$]\s*\d/.test(text)) return true;
      if (/^[₩$]?\s*\d[\d,]*(?:\.\d+)?(?:\s+[₩$]?\d[\d,]*(?:\.\d+)?){1,6}$/.test(text)) return true;
      if (/^[₩$]?\s*\d+(?:\.\d{2})\d[\d,]+/.test(text)) return true;
      return false;
    }

    function hasStudioMetricFragment(line) {
      const text = cleanStudioLine(line);
      return /[₩$]\s*\d[\d,]*(?:\.\d+)?/.test(text)
        || /20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?/.test(text);
    }

    function isStudioTitleCandidate(line) {
      const text = cleanStudioLine(line);
      return Boolean(text)
        && !isStudioPreviewImageLine(text)
        && !isDurationLine(text)
        && !isStudioHeaderLine(text)
        && !isStudioStatusLine(text)
        && !isStudioGoalLine(text)
        && !isStudioDate(text)
        && !isStudioMetricLine(text)
        && !hasStudioMetricFragment(text);
    }

    function isDurationLine(line) {
      return /^\d{1,2}:\d{2}(?::\d{2})?$/.test(line);
    }

    function isStudioDate(line) {
      return /20\d{2}\.\s*\d{1,2}\.\s*\d{1,2}\.?/.test(line) || /^\d{4}-\d{1,2}-\d{1,2}$/.test(line);
    }

    function parseStudioDate(line) {
      const text = cleanStudioLine(line);
      const dotted = text.match(/(20\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?/);
      if (dotted) {
        return dayjs(`${dotted[1]}-${dotted[2]}-${dotted[3]}`).format("YYYY-MM-DD");
      }
      const parsed = dayjs(text);
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD");
    }

    function isStudioHeaderLine(line) {
      return ["프로모션", "상태", "목표", "생성일", "비용", "노출수", "조회수", "구독자 수", "웹 사이트 방문", "웹사이트 방문", "웹 사이트 방문자 수", "웹사이트 방문자 수"].includes(line);
    }

    function isStudioStatusLine(line) {
      return /^(진행중|활성(?:\(제한적\))?|게재|운영|완료|종료됨?|일시중지됨?|중지|중단|대기|초안|검토)$/.test(cleanStudioLine(line));
    }

    function isStudioGoalLine(line) {
      return /^(웹\s*사이트\s*방문|웹사이트\s*방문|방문|트래픽|구독|조회수?|인지|노출|전환|구매|문의)$/.test(cleanStudioLine(line));
    }

    function isPlainFormattedInteger(value) {
      return /^(0|[1-9]\d*)$/.test(value);
    }

    function isCommaFormattedInteger(value) {
      return /^(0|[1-9]\d{0,2}(,\d{3})*)$/.test(value);
    }

    function isFormattedInteger(value) {
      return isPlainFormattedInteger(value) || isCommaFormattedInteger(value);
    }

    function parseConcatenatedStudioNumbers(value) {
      const text = cleanStudioLine(value);
      const costMatch = text.match(/^[₩$]?\s*(\d+(?:\.\d{2}))(.+)$/);
      if (!costMatch) {
        const numbers = text.match(/[₩$]?\d[\d,]*(?:\.\d+)?/g) || [];
        return numbers.slice(0, 5);
      }

      const cost = costMatch[1];
      const compact = costMatch[2].replace(/\s+/g, "");
      const candidates = [];

      function collect(start, parts) {
        if (parts.length === 4) {
          if (start === compact.length) candidates.push(parts);
          return;
        }

        const remainingParts = 4 - parts.length;
        for (let end = start + 1; end <= compact.length; end += 1) {
          const part = compact.slice(start, end);
          if (!isFormattedInteger(part)) continue;
          if (compact.length - end < remainingParts - 1) continue;
          collect(end, [...parts, part]);
        }
      }

      collect(0, []);

      if (!candidates.length) return [cost];

      const best = candidates
        .map((parts) => {
          const values = parts.map(toNumber);
          let score = 0;
          if (values[0] >= values[1]) score += 6;
          if (values[0] >= values[3]) score += 4;
          if (values[1] >= values[2]) score += 3;
          if (values[2] <= 99) score += 8;
          if (values[2] <= 9) score += 4;
          if (values[3] > 0) score += 2;
          if (parts[0].includes(",")) score += 3;
          if (parts[1].includes(",") || values[1] < 1000) score += 2;
          if (values[1] >= 100) score += 3;
          if (!parts[2].includes(",")) score += 2;
          if (parts[3].includes(",") || values[3] < 1000) score += 1;
          return { parts, score };
        })
        .sort((a, b) => b.score - a.score || b.parts[0].length - a.parts[0].length)[0];

      return [cost, ...best.parts];
    }

    function normalizeStudioStatus(value) {
      const text = cleanStudioLine(value);
      if (/진행|활성|게재|운영/.test(text)) return "active";
      if (/완료|종료/.test(text)) return "completed";
      if (/일시|중지|중단/.test(text)) return "paused";
      if (/대기|초안|검토/.test(text)) return "draft";
      return "draft";
    }

    function normalizeStudioGoal(value) {
      const text = cleanStudioLine(value);
      if (/웹\s*사이트|방문|트래픽/.test(text)) return "traffic";
      if (/구독/.test(text)) return "subscriber";
      if (/조회|인지|노출/.test(text)) return "awareness";
      if (/전환|구매|문의/.test(text)) return "conversion";
      return "traffic";
    }

    function removeStudioPreviewImageText(text) {
      return String(text || "")
        .replace(/(?:동영상\s*)?미리보기\s*이미지\s*:\s*.*?(?=\s+\d{1,2}:\d{2}(?::\d{2})?\s+)/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function parseStudioInlineRecords(text) {
      const source = removeStudioPreviewImageText(text);
      const statusPattern = "활성\\(제한적\\)|활성|일시중지됨|일시중지|종료됨|종료|완료|진행중|초안|대기|검토";
      const goalPattern = "웹\\s*사이트\\s*방문|웹사이트\\s*방문|방문|트래픽|구독|조회수|조회|인지|노출|전환|구매|문의";
      const datePattern = "20\\d{2}\\.\\s*\\d{1,2}\\.\\s*\\d{1,2}\\.?";
      const moneyPattern = "[₩$]?\\s*\\d[\\d,]*(?:\\.\\d+)?";
      const integerPattern = "\\d[\\d,]*";
      const recordPattern = new RegExp(
        `^(\\d{1,2}:\\d{2}(?::\\d{2})?)\\s+(.+?)\\s+(${statusPattern})\\s+(${goalPattern})\\s+(${datePattern})\\s+(${moneyPattern})\\s+(${integerPattern})\\s+(${integerPattern})\\s+(${integerPattern})\\s+(${integerPattern})\\s*$`
      );
      const records = [];
      const chunks = source
        .split(/(?=\b\d{1,2}:\d{2}(?::\d{2})?\s+)/)
        .map(cleanStudioLine)
        .filter((chunk) => /^\d{1,2}:\d{2}(?::\d{2})?\s+/.test(chunk));

      chunks.forEach((chunk) => {
        const match = chunk.match(recordPattern);
        if (!match) return;
        const title = cleanStudioLine(match[2]);
        if (!isStudioTitleCandidate(title)) return;
        records.push(normalizePromotion({
          name: title,
          status: normalizeStudioStatus(match[3]),
          goal: normalizeStudioGoal(match[4]),
          createdAt: parseStudioDate(match[5]),
          title,
          description: "YouTube Studio에서 붙여넣은 프로모션 데이터",
          videoUrl: "",
          cost: match[6],
          impressions: match[7],
          views: match[8],
          subscribers: match[9],
          visitors: match[10]
        }));
      });

      return records;
    }

    function parseStudioPaste(text) {
      const inlineRecords = parseStudioInlineRecords(text);
      if (inlineRecords.length) return inlineRecords;

      const rawLines = String(text || "")
        .split(/\r?\n/)
        .map(cleanStudioLine)
        .filter(Boolean);
      const lines = rawLines.map(normalizeStudioPasteLine).filter(Boolean);

      const tableRecords = parseStudioTableRecords(lines);
      const titleIndexes = rawLines
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => isStudioPreviewImageLine(line))
        .map(({ index }) => index);

      if (!titleIndexes.length) return tableRecords;

      const legacyRecords = titleIndexes.map((startIndex, position) => {
        const endIndex = titleIndexes[position + 1] ?? lines.length;
        return parseStudioRecord(rawLines.slice(startIndex, endIndex).map(normalizeStudioPasteLine).filter(Boolean));
      }).filter((item) => isStudioTitleCandidate(item.name));

      return legacyRecords.length ? legacyRecords : tableRecords;
    }

    function parseStudioTableRecords(lines) {
      const records = [];

      for (let index = 0; index < lines.length; index += 1) {
        if (!isDurationLine(lines[index])) continue;

        let titleIndex = index + 1;
        while (titleIndex < lines.length && !isDurationLine(lines[titleIndex]) && !isStudioTitleCandidate(lines[titleIndex])) {
          titleIndex += 1;
        }

        const title = lines[titleIndex];
        if (!isStudioTitleCandidate(title)) continue;

        const statusLine = lines[titleIndex + 1] || "";
        const goalLine = lines[titleIndex + 2] || "";
        const dateLine = lines[titleIndex + 3] || "";
        if (!isStudioStatusLine(statusLine) || !isStudioGoalLine(goalLine) || !isStudioDate(dateLine)) continue;

        const metricLines = [];
        let cursor = titleIndex + 4;
        while (cursor < lines.length && !isDurationLine(lines[cursor])) {
          if (!isStudioHeaderLine(lines[cursor])) metricLines.push(lines[cursor]);
          cursor += 1;
        }

        const numbers = metricLines.length === 1
          ? parseConcatenatedStudioNumbers(metricLines[0])
          : metricLines.flatMap(parseConcatenatedStudioNumbers);

        records.push(normalizePromotion({
          name: title,
          status: normalizeStudioStatus(statusLine),
          goal: normalizeStudioGoal(goalLine),
          createdAt: parseStudioDate(dateLine),
          title,
          description: "YouTube Studio에서 붙여넣은 프로모션 데이터",
          videoUrl: "",
          cost: numbers[0] ?? 0,
          impressions: numbers[1] ?? 0,
          views: numbers[2] ?? 0,
          subscribers: numbers[3] ?? 0,
          visitors: numbers[4] ?? 0
        }));

        index = cursor - 1;
      }

      return records.filter((item) => isStudioTitleCandidate(item.name));
    }

    function parseStudioRecord(recordLines) {
      const durationIndex = recordLines.findIndex(isDurationLine);
      const titleRaw = durationIndex >= 0
        ? recordLines.slice(durationIndex + 1).find(isStudioTitleCandidate)
        : recordLines.find(isStudioTitleCandidate);
      const title = titleRaw || "";
      const body = recordLines
        .slice(recordLines.indexOf(titleRaw) + 1)
        .map(normalizeStudioPasteLine)
        .filter((line) => !isDurationLine(line))
        .filter((line) => !isStudioHeaderLine(line));

      const dateIndex = body.findIndex(isStudioDate);
      const beforeDate = dateIndex >= 0 ? body.slice(0, dateIndex) : body;
      const afterDate = dateIndex >= 0 ? body.slice(dateIndex + 1) : [];
      const statusLine = beforeDate.find(isStudioStatusLine) || "draft";
      const goalLine = beforeDate.find(isStudioGoalLine) || "traffic";
      const numbers = afterDate.flatMap(parseConcatenatedStudioNumbers).filter((line) => toNumber(line) || /^[₩$]?0$/.test(line) || line === "0");

      return normalizePromotion({
        name: title,
        status: normalizeStudioStatus(statusLine),
        goal: normalizeStudioGoal(goalLine),
        createdAt: dateIndex >= 0 ? parseStudioDate(body[dateIndex]) : dayjs().format("YYYY-MM-DD"),
        title,
        description: "YouTube Studio에서 붙여넣은 프로모션 데이터",
        videoUrl: "",
        cost: numbers[0] ?? 0,
        impressions: numbers[1] ?? 0,
        views: numbers[2] ?? 0,
        subscribers: numbers[3] ?? 0,
        visitors: numbers[4] ?? 0
      });
    }

    function updatePastePreview() {
      const parsed = parseStudioPaste(dom.studioPasteInput.value);
      if (!dom.studioPasteInput.value.trim()) {
        dom.pastePreview.textContent = "붙여넣은 내용을 자동으로 분석합니다.";
        return;
      }
      if (!parsed.length) {
        dom.pastePreview.textContent = "아직 인식된 프로모션이 없습니다. 유튜브 스튜디오 프로모션 목록에서 복사한 텍스트를 그대로 붙여넣어 주세요.";
        return;
      }

      dom.pastePreview.innerHTML = `
        <strong>${parsed.length}개 프로모션 인식</strong><br>
        ${parsed.slice(0, 4).map((item) => `${escapeHtml(item.name)} · ${item.createdAt} · 조회수 ${formatNumber(item.views)} · 방문자 ${formatNumber(item.visitors)}`).join("<br>")}
        ${parsed.length > 4 ? "<br>..." : ""}
      `;
    }

    function upsertStudioPasteData() {
      const parsed = parseStudioPaste(dom.studioPasteInput.value);
      if (!parsed.length) {
        showToast("인식된 프로모션 데이터가 없습니다.");
        return;
      }

      let added = 0;
      let updated = 0;
      parsed.forEach((incoming) => {
        const keyName = incoming.name.trim().toLowerCase();
        const existingIndex = appState.promotions.findIndex((item) => {
          const sameName = String(item.name || "").trim().toLowerCase() === keyName || String(item.title || "").trim().toLowerCase() === keyName;
          const sameDate = !item.createdAt || item.createdAt === incoming.createdAt;
          return sameName && sameDate;
        });

        if (existingIndex >= 0) {
          appState.promotions[existingIndex] = { ...appState.promotions[existingIndex], ...incoming };
          updated += 1;
        } else {
          appState.promotions.unshift({ id: uid(), ...incoming });
          added += 1;
        }
      });

      savePromotions();
      closePromotionModal();
      renderAll();
      showToast(`붙여넣기 반영 완료: ${added}개 추가, ${updated}개 업데이트`);
    }

    function clonePromotion(id) {
      const source = appState.promotions.find((item) => item.id === id);
      if (!source) return;
      const clone = {
        ...source,
        id: uid(),
        name: `${source.name} 복제본`,
        createdAt: dayjs().format("YYYY-MM-DD")
      };
      appState.promotions.unshift(clone);
      savePromotions();
      renderAll();
      showToast("프로모션이 복제되었습니다.");
    }

    function confirmDeletePromotion(id) {
      const item = appState.promotions.find((promotion) => promotion.id === id);
      openConfirm({
        title: "프로모션 삭제",
        message: `"${item ? item.name : "선택한 프로모션"}" 데이터를 삭제합니다.`,
        okText: "삭제",
        onConfirm: () => {
          appState.promotions = appState.promotions.filter((promotion) => promotion.id !== id);
          savePromotions();
          renderAll();
          showToast("프로모션이 삭제되었습니다.");
        }
      });
    }

    function openConfirm({ title, message, okText = "확인", onConfirm }) {
      dom.confirmTitle.textContent = title;
      dom.confirmMessage.textContent = message;
      dom.confirmOkBtn.textContent = okText;
      appState.pendingConfirm = onConfirm;
      dom.confirmModalBackdrop.classList.add("open");
    }

    function closeConfirm() {
      dom.confirmModalBackdrop.classList.remove("open");
      appState.pendingConfirm = null;
    }

    // 전체 CSV는 원본 입력값과 계산 KPI를 함께 내보냅니다.
    // Tabulator CSV 버튼은 현재 테이블 컬럼/필터 기준 다운로드에 사용됩니다.
    function exportCsv() {
      const rows = getEnrichedPromotions().map((item) => ({
        id: item.id,
        "프로모션명": item.name,
        "상태": item.status,
        "목표": item.goal,
        "생성일": item.createdAt,
        "제목": item.title,
        "설명": item.description,
        "영상 URL": item.videoUrl,
        "비용": item.cost,
        "노출수": item.impressions,
        "조회수": item.views,
        "구독자 수": item.subscribers,
        "웹사이트 방문자 수": item.visitors,
        "방문 CPV": round(item.cpv, 2),
        "방문율": round(item.visitRate, 2),
        "노출 대비 방문율": round(item.impressionVisitRate, 2)
      }));
      downloadText(Papa.unparse(rows), `youtube_promotions_${dayjs().format("YYYYMMDD_HHmm")}.csv`, "text/csv;charset=utf-8");
      showToast("CSV 파일을 내보냈습니다.");
    }

    function downloadText(content, filename, mimeType) {
      const blob = new Blob(["\uFEFF", content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }

    // CSV 가져오기는 한국어 헤더와 영문 헤더를 모두 허용합니다.
    // 외부 스프레드시트에서 복사해 온 파일도 최대한 자연스럽게 흡수하기 위한 매핑입니다.
    function importCsv(file) {
      if (!file) return;
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          const imported = result.data.map(mapCsvRowToPromotion).filter((item) => item.name);
          if (!imported.length) {
            showToast("가져올 수 있는 데이터가 없습니다.");
            return;
          }
          appState.promotions = [...imported, ...appState.promotions];
          savePromotions();
          renderAll();
          showToast(`${imported.length}개 프로모션을 가져왔습니다.`);
        },
        error: () => showToast("CSV 파일을 읽는 중 오류가 발생했습니다.")
      });
      dom.csvFileInput.value = "";
    }

    function pick(row, keys, fallback = "") {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== "") return row[key];
      }
      return fallback;
    }

    function mapCsvRowToPromotion(row) {
      return {
        id: pick(row, ["id"], uid()),
        ...normalizePromotion({
        name: pick(row, ["프로모션명", "name", "promotionName"]),
        status: normalizeStatus(pick(row, ["상태", "status"], "active")),
        goal: normalizeGoal(pick(row, ["목표", "goal"], "traffic")),
        createdAt: normalizeDate(pick(row, ["생성일", "createdAt", "date"], dayjs().format("YYYY-MM-DD"))),
        title: pick(row, ["제목", "title"]),
        description: pick(row, ["설명", "description"]),
        videoUrl: pick(row, ["영상 URL", "videoUrl", "url"]),
        cost: pick(row, ["비용", "cost"], 0),
        impressions: pick(row, ["노출수", "impressions"], 0),
        views: pick(row, ["조회수", "views"], 0),
        subscribers: pick(row, ["구독자 수", "subscribers"], 0),
        visitors: pick(row, ["웹사이트 방문자 수", "방문자 수", "visitors"], 0)
        })
      };
    }

    function normalizeStatus(value) {
      const text = String(value).trim();
      const map = { "진행중": "active", "완료": "completed", "일시중지": "paused", "초안": "draft" };
      return map[text] || (STATUS_LABELS[text] ? text : "active");
    }

    function normalizeGoal(value) {
      const text = String(value).trim();
      const map = { "인지": "awareness", "방문": "traffic", "구독": "subscriber", "전환": "conversion" };
      return map[text] || (GOAL_LABELS[text] ? text : "traffic");
    }

    function normalizeDate(value) {
      const parsed = dayjs(value);
      return parsed.isValid() ? parsed.format("YYYY-MM-DD") : dayjs().format("YYYY-MM-DD");
    }

    function resetAllData() {
      openConfirm({
        title: "전체 데이터 초기화",
        message: "브라우저에 저장된 모든 YouTube 프로모션 데이터를 삭제합니다.",
        okText: "초기화",
        onConfirm: () => {
          appState.promotions = [];
          savePromotions();
          renderAll();
          showToast("전체 데이터가 초기화되었습니다.");
        }
      });
    }

    function loadSampleData() {
      openConfirm({
        title: "샘플 데이터 추가",
        message: "운영 데이터 앞에 샘플 프로모션 6개를 추가합니다.",
        okText: "추가",
        onConfirm: () => {
          appState.promotions = [...createSamplePromotions(), ...appState.promotions];
          savePromotions();
          renderAll();
          showToast("샘플 데이터가 추가되었습니다.");
        }
      });
    }

    function createSamplePromotions() {
      const baseDate = dayjs();
      const samples = [
        ["브랜드 키워드 A", "completed", "traffic", "대표 원장 상담 프로세스 공개", "상담부터 시술 설계까지 실제 고객 흐름을 보여주는 소재", 580, 182000, 12800, 122, 942],
        ["후기 스토리 B", "active", "subscriber", "재방문 고객이 말한 선택 이유", "고객 신뢰와 경험 중심 메시지를 전면에 둔 인터뷰형 소재", 420, 121000, 9300, 188, 612],
        ["가격 비교 C", "completed", "conversion", "비용이 아니라 결과 기준으로 비교하세요", "가격 장벽을 낮추고 상담 전환을 유도하는 설명형 소재", 760, 215000, 15100, 95, 530],
        ["문제 해결 D", "paused", "traffic", "방문 전 꼭 확인해야 할 세 가지", "잠재 고객의 불안을 먼저 해소하는 체크리스트형 소재", 310, 98000, 8400, 61, 710],
        ["원장 브리핑 E", "active", "awareness", "시술 선택이 어려운 이유", "전문가 관점에서 오해를 짚는 교육형 짧은 영상", 250, 142000, 19200, 74, 388],
        ["혜택 고지 F", "draft", "traffic", "이번 달 상담 혜택 정리", "기간성 혜택과 예약 동선을 강조한 직접 반응형 소재", 190, 67000, 4200, 27, 335]
      ];

      return samples.map((sample, index) => ({
        id: uid(),
        name: sample[0],
        status: sample[1],
        goal: sample[2],
        createdAt: baseDate.subtract(index * 4, "day").format("YYYY-MM-DD"),
        title: sample[3],
        description: sample[4],
        videoUrl: `https://youtube.com/watch?v=sample${index + 1}`,
        cost: sample[5],
        impressions: sample[6],
        views: sample[7],
        subscribers: sample[8],
        visitors: sample[9]
      }));
    }

    function escapeHtml(value) {
      return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
    }

    function showToast(message) {
      dom.toast.textContent = message;
      dom.toast.classList.add("show");
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => dom.toast.classList.remove("show"), 2500);
    }

    function bindEvents() {
      dom.youtubeChannelCard.addEventListener("click", () => setRoute("dashboard"));
      dom.youtubeChannelCard.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") setRoute("dashboard");
      });
      dom.naverSaChannelCard.addEventListener("click", () => setRoute("naverSa"));
      dom.naverSaChannelCard.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") setRoute("naverSa");
      });
      dom.backToHubBtn.addEventListener("click", () => setRoute("hub"));
      dom.themeToggleBtn.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        applyTheme(next);
      });

      dom.addPromotionBtn.addEventListener("click", () => openPromotionModal());
      dom.loadSampleBtn.addEventListener("click", loadSampleData);
      if (dom.youtubeInsightTabs) {
        dom.youtubeInsightTabs.addEventListener("click", (event) => {
          const button = event.target.closest("[data-youtube-analysis-tab]");
          if (button) switchYoutubeAnalysisTab(button.dataset.youtubeAnalysisTab);
        });
      }
      dom.closePromotionModalBtn.addEventListener("click", closePromotionModal);
      dom.cancelPromotionBtn.addEventListener("click", closePromotionModal);
      dom.promotionForm.addEventListener("submit", handlePromotionSubmit);
      dom.promotionTabs.addEventListener("click", (event) => {
        const button = event.target.closest("[data-promotion-tab]");
        if (button) switchPromotionTab(button.dataset.promotionTab);
      });
      dom.studioPasteInput.addEventListener("input", updatePastePreview);
      dom.importPasteBtn.addEventListener("click", upsertStudioPasteData);
      dom.promotionModalBackdrop.addEventListener("click", (event) => {
        if (event.target === dom.promotionModalBackdrop) closePromotionModal();
      });

      dom.tableSearchInput.addEventListener("input", (event) => {
        appState.filters.search = event.target.value;
        renderAll();
      });
      dom.statusFilterSelect.addEventListener("change", (event) => {
        appState.filters.status = event.target.value;
        renderAll();
      });
      dom.goalFilterSelect.addEventListener("change", (event) => {
        appState.filters.goal = event.target.value;
        renderAll();
      });
      document.addEventListener("click", (event) => {
        if (dom.columnPanel && !event.target.closest(".column-menu")) dom.columnPanel.classList.remove("open");
      });

      dom.exportCsvBtn.addEventListener("click", exportCsv);
      dom.importCsvBtn.addEventListener("click", () => dom.csvFileInput.click());
      dom.resetDataBtn.addEventListener("click", resetAllData);
      dom.csvFileInput.addEventListener("change", (event) => importCsv(event.target.files[0]));

      dom.confirmCancelBtn.addEventListener("click", closeConfirm);
      dom.confirmOkBtn.addEventListener("click", () => {
        if (typeof appState.pendingConfirm === "function") appState.pendingConfirm();
        closeConfirm();
      });
      dom.confirmModalBackdrop.addEventListener("click", (event) => {
        if (event.target === dom.confirmModalBackdrop) closeConfirm();
      });

      window.addEventListener("hashchange", applyRoute);
      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          closePromotionModal();
          closeConfirm();
        }
      });
    }

    function boot() {
      initTheme();
      loadPromotions();
      bindEvents();
      applyRoute();
    }

    document.addEventListener("DOMContentLoaded", boot);
