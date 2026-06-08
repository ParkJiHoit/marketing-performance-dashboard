# Roadmap

## Phase 1: Static App 정리

- `index.html`에서 CSS와 JS를 분리합니다.
- 브랜드 자산과 문서를 정리합니다.
- 기존 `localStorage` 데이터 키를 보존합니다.

## Phase 2: 채널 확장 준비

- `src/channels/youtube.js`로 YouTube 설정을 분리합니다.
- `src/channels/naver.js`, `src/channels/google.js`, `src/channels/meta.js`의 골격을 만듭니다.
- 채널별 KPI, 차트, 테이블 컬럼 정의를 설정화합니다.
- 공통 formatter, chart helper, storage adapter를 분리합니다.

## Phase 3: 디자인 시스템 고도화

- `src/styles/tokens.css`에 색상, 간격, 그림자, 타이포그래피 토큰을 분리합니다.
- 채널별 브랜드 색을 테마 변수로 관리합니다.
- KPI 카드, 필터, 모달, 테이블, 차트 카드의 컴포넌트 규칙을 정리합니다.
- 모바일과 대형 모니터 화면을 별도로 QA합니다.

## Phase 4: 빌드 환경 도입

필요성이 생기면 Vite 기반 앱으로 이전합니다.

- ES Modules 기반 파일 분리
- npm dependency 관리
- lint/format/test 도입
- 배포용 build 산출물 생성

## Phase 5: 데이터 계층 강화

- CSV/붙여넣기 외 데이터 소스 추가
- Google Sheets 또는 API 연동
- IndexedDB 저장소 도입
- 데이터 백업/복원 UX 강화
- 채널별 데이터 품질 검증
