# Project Structure

이 프로젝트는 현재 정적 HTML 앱입니다. 당장은 빌드 도구 없이 실행되지만, 파일 위치는 이후 채널별 모듈화와 프론트엔드 고도화를 염두에 두고 나눕니다.

```text
.
├── index.html
├── README.md
├── assets/
│   ├── brand/
│   ├── images/
│   └── exports/
├── data/
│   └── imports/
├── docs/
├── src/
│   ├── app.js
│   ├── channels/
│   ├── components/
│   ├── data/
│   ├── lib/
│   └── styles/
└── src/styles/app.css
```

## Root

- `index.html`: 앱의 HTML 진입점입니다. 외부 CDN, 기본 레이아웃, 앱 스크립트와 스타일 링크만 유지하는 방향이 좋습니다.
- `README.md`: 프로젝트 목적, 실행 방식, 주요 문서 링크를 담습니다.

## assets

- `assets/brand/`: 로고, 워드마크, 브랜드 고정 자산을 둡니다.
- `assets/images/`: 대시보드 배경, 캠페인 이미지, 채널별 시각 자산을 둡니다.
- `assets/exports/`: 사용자가 내보낸 리포트, 스냅샷, 이미지 등을 임시 보관할 때 사용합니다.

## data

- `data/imports/`: CSV, TSV, Google Sheets export 등 원본 입력 파일을 보관합니다.
- 브라우저 앱의 실제 운영 데이터는 현재 `localStorage`에 저장됩니다.
- 샘플 데이터와 테스트용 데이터는 실제 운영 데이터와 분리합니다.

## docs

프로젝트 방향, 데이터 정책, 채널 추가 규칙, 디자인 기준을 문서화합니다. 기능이 커질수록 코드보다 먼저 기준을 여기에 적어두면 좋습니다.

## src

- `src/app.js`: 현재 앱 로직입니다. 다음 단계에서 채널, 데이터, 차트, UI 컴포넌트로 점진 분리합니다.
- `src/channels/`: YouTube, Naver, Google, Meta 등 채널별 설정과 렌더링 로직을 둘 위치입니다.
- `src/components/`: KPI 카드, 차트 카드, 모달, 필터바, 테이블 툴바처럼 재사용 가능한 UI 단위를 둡니다.
- `src/data/`: 저장소 어댑터, CSV 파서, 데이터 정규화, 마이그레이션 로직을 둡니다.
- `src/lib/`: 포맷터, 날짜 유틸, 차트 헬퍼, 공통 계산 함수를 둡니다.
- `src/styles/`: 전역 스타일, 디자인 토큰, 채널별 테마 스타일을 둡니다.

## 채널 추가 기준

새 채널은 아래 요소가 분리되어야 합니다.

- 채널 ID와 표시 이름
- 저장소 키
- 지표 정의
- 원본 데이터 입력 방식
- 카드/차트/테이블 렌더링 방식
- CSV export/import 포맷

현재 YouTube 저장소 키 `yt-studio-promotions-v1`은 기존 데이터 유지를 위해 변경하지 않습니다.
