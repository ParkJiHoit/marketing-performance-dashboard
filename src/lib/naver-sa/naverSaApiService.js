(function () {
  function getMode() {
    return "api";
  }

  async function loadNaverSaData({ startDate, endDate } = {}) {
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      params.set("maxAdGroups", "25");
      params.set("maxKeywords", "100");
      const response = await fetch(`/api/naver-sa/sync?${params.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const authFailed = response.status === 401 || response.status === 403;
        return {
          mode: "api",
          dataset: null,
          error: authFailed
            ? "네이버 SA API 인증에 실패했습니다. 환경변수와 API 권한을 확인해주세요."
            : body.message || "네이버 SA 데이터를 불러오지 못했습니다. API 인증 정보 또는 요청 범위를 확인해주세요."
        };
      }
      const dataset = await response.json();
      return { mode: "api", dataset, error: null };
    } catch (error) {
      return {
        mode: "api",
        dataset: null,
        error: "네이버 SA 데이터를 불러오지 못했습니다. API 인증 정보 또는 요청 범위를 확인해주세요."
      };
    }
  }

  window.NaverSaApiService = {
    getMode,
    loadNaverSaData
  };
})();
