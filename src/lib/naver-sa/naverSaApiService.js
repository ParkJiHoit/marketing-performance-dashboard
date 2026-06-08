(function () {
  function getMode() {
    return "api";
  }

  function detailToText(detail) {
    if (!detail) return "";
    if (typeof detail === "string") return detail;
    if (detail.message) return detail.message;
    if (detail.code) return `code ${detail.code}`;
    try {
      return JSON.stringify(detail);
    } catch (error) {
      return "";
    }
  }

  function buildErrorMessage(status, body = {}, fallback = "") {
    const detail = detailToText(body.detail);
    if (status === 0) {
      return "네이버 SA API 서버에 연결하지 못했습니다. 파일을 직접 열지 말고 `npm start`로 실행한 뒤 localhost 주소로 접속해주세요.";
    }
    if (status === 401 || status === 403) {
      return "네이버 SA API 인증에 실패했습니다. .env.local의 API 키, 시크릿 키, 고객 ID와 API 권한을 확인해주세요.";
    }
    if (detail === "fetch failed") {
      return "서버에서 네이버 API로 접속하지 못했습니다. 인터넷 연결, 방화벽/VPN, 또는 실행 환경의 네트워크 권한을 확인해주세요.";
    }
    return [
      body.message || fallback || "네이버 SA 데이터를 불러오지 못했습니다.",
      detail ? `상세: ${detail}` : ""
    ].filter(Boolean).join(" ");
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
        return {
          mode: "api",
          dataset: null,
          error: buildErrorMessage(response.status, body, "네이버 SA 데이터를 불러오지 못했습니다.")
        };
      }

      const dataset = await response.json();
      return { mode: "api", dataset, error: null };
    } catch (error) {
      return {
        mode: "api",
        dataset: null,
        error: buildErrorMessage(0)
      };
    }
  }

  window.NaverSaApiService = {
    getMode,
    loadNaverSaData
  };
})();
