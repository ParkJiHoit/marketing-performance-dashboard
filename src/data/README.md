# data

데이터 저장, 파싱, 정규화, 마이그레이션 로직을 둘 폴더입니다.

예상 파일:

- `storage.js`: localStorage, 이후 IndexedDB 같은 저장소 어댑터
- `migrations.js`: 데이터 구조 변경 시 마이그레이션
- `csv.js`: CSV import/export
- `normalizers.js`: 채널별 원본 데이터를 공통 구조로 변환

기존 YouTube 저장 키는 `yt-studio-promotions-v1`입니다.
