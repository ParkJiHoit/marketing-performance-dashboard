# channels

채널별 대시보드 설정과 렌더링 진입점을 둘 폴더입니다.

예상 파일:

- `youtube.js`
- `naver.js`
- `google.js`
- `meta.js`

각 채널은 `id`, `title`, `storageKey`, `metrics`, `charts`, `tableColumns`, `importers`를 독립적으로 갖는 구조가 좋습니다.
