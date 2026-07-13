# PROJECT_CONTEXT.md
# 링고 고객센터 관리자 평가 보고 시스템

---

## 1. 기술 스택

| 구분 | 기술 |
|------|------|
| Framework | Hono v4 (Cloudflare Pages/Workers용 경량 웹 프레임워크) |
| Runtime | Cloudflare Workers (edge runtime, `nodejs_compat` flag) |
| Database | Cloudflare D1 (SQLite 기반, `--local` 모드로 개발) |
| Build Tool | Vite v6 + `@hono/vite-build/cloudflare-pages` |
| Process Manager | PM2 (ecosystem.config.cjs, fork mode, port 3000) |
| Charts | Chart.js v4.4.0 + chartjs-plugin-datalabels v2.2.0 (CDN) |
| Styling | Tailwind CSS CDN + CSS 변수(`--accent`, `--sidebar-from` 등) |
| Theme 저장 | `localStorage('lingo_theme')` JSON 직렬화 |
| Icons | Font Awesome 6.4.0 (CDN) |
| Fonts | Noto Sans KR (Google Fonts CDN) |
| Static Files | `serveStatic` from `hono/cloudflare-workers` |
| Language | TypeScript (`.tsx`) |

---

## 2. 파일 구조

```
/home/user/webapp/
├── src/
│   └── index.tsx              ★ 단일 파일 — 백엔드 API + 메인 앱 HTML + 색상 설정 HTML 전체 포함 (약 2800줄)
├── migrations/
│   └── 0001_initial_schema.sql   DB 스키마 (6개 테이블)
├── public/
│   └── static/
│       └── style.css          전역 기본 스타일 (최소)
├── seed.sql                   초기 데이터 (직책 5 / 관리자 7 / 항목 27 / 결과 전체)
├── ecosystem.config.cjs       PM2 설정 (wrangler pages dev + D1 --local, port 3000)
├── wrangler.jsonc             Cloudflare Pages 설정 (D1 바인딩: webapp-production)
├── vite.config.ts             Vite 빌드 설정
├── package.json               스크립트 및 의존성
├── tsconfig.json              TypeScript 설정
└── PROJECT_CONTEXT.md         ← 이 파일
```

### 파일 구조 규칙
- **모든 로직은 `src/index.tsx` 단일 파일에** 집중 관리 (백엔드 API + 프론트엔드 HTML 인라인)
- 별도 컴포넌트 파일 분리 없음 — 새 기능도 `src/index.tsx` 내 섹션 구분(`// ===...===`)으로 추가
- 새 URL 페이지 필요 시 `app.get('/경로', ...)` 라우트 + 전용 HTML 반환 함수 추가 패턴 사용
- **메뉴/라우팅 위치 변경 시 반드시 사전 제안 → 확인 후 진행** (운영 규칙)

---

## 3. DB 설계 규칙

- **PK 타입:** `INTEGER PRIMARY KEY AUTOINCREMENT` (D1/SQLite 방식)
- **공통 컬럼:** `created_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- **결과 테이블 추가:** `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`
- **삭제 방식:** `is_active INTEGER NOT NULL DEFAULT 1` (soft delete, 1=활성/0=비활성)
- **FK 관계:** 모든 외래키에 `FOREIGN KEY ... REFERENCES` 명시
- **고유 제약:** `UNIQUE(year, month)` (기간), `UNIQUE(manager_id, period_id, item_id)` (결과)
- **인덱스:** 주요 FK 컬럼에 `CREATE INDEX IF NOT EXISTS` 필수
- **직책별 항목 분기:** `eval_items.position_id IS NULL` → 전 직책 공통 / `NOT NULL` → 해당 직책 전용

---

## 4. 현재 DB 테이블 목록

| 테이블 | 주요 컬럼 | 설명 |
|--------|-----------|------|
| `positions` | id, name, color, created_at | 직책 (센터장/전산팀장/강사/매니저/상담팀장) |
| `managers` | id, name, position_id, is_active, created_at | 관리자 7명 (인원·보직 유동적) |
| `eval_categories` | id, name, max_score, sort_order, color, created_at | 평가 영역 5개 |
| `eval_items` | id, category_id, position_id(nullable), item_name, criteria, max_score, sort_order, is_active, created_at | 평가 항목 27개 (공통+직책전용) |
| `eval_periods` | id, year, month, label, is_active, **is_confirmed**, created_at | 평가 기간 (현재: 2026년 6월 반영완료, 2026년 7월 임시) |
| `item_history` | id, item_id(nullable), action, item_name, category_name, position_name, max_score, reason, changed_at | 평가 항목 변경이력 (add/edit/delete) |
| `eval_results` | id, manager_id, period_id, item_id, score, note, created_at, updated_at | 평가 결과 (UNIQUE 제약) |

---

## 5. API 라우트 목록

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/positions` | 직책 목록 |
| POST | `/api/positions` | 직책 추가 |
| PUT | `/api/positions/:id` | 직책 수정 (이름·색상) |
| DELETE | `/api/positions/:id` | 직책 삭제 |
| GET | `/api/managers` | 관리자 목록 (position_id 필터 가능) |
| POST | `/api/managers` | 관리자 추가 |
| PUT | `/api/managers/:id` | 관리자 수정 |
| DELETE | `/api/managers/:id` | 관리자 삭제 (is_active=0) |
| GET | `/api/categories` | 평가 영역 목록 |
| POST | `/api/categories` | 평가 영역 추가 |
| PUT | `/api/categories/:id` | 평가 영역 수정 (이름·색상) |
| DELETE | `/api/categories/:id` | 평가 영역 삭제 |
| GET | `/api/items` | 평가 항목 목록 (position_id, category_id 필터 가능) |
| POST | `/api/items` | 평가 항목 추가 |
| PUT | `/api/items/:id` | 평가 항목 수정 |
| DELETE | `/api/items/:id` | 평가 항목 삭제 (is_active=0) |
| GET | `/api/periods` | 평가 기간 목록 (is_confirmed 포함) |
| POST | `/api/periods` | 평가 기간 추가 |
| PUT | `/api/periods/:id/confirm` | 반영완료 토글 (is_confirmed 0↔1) |
| GET | `/api/items/history` | 항목 변경이력 전체 조회 (최신순 200건) |
| GET | `/api/items/score-check` | 직책별 활성 항목 배점 합산 (공통+전용, 100점 초과 감지) |
| GET | `/api/results` | 평가 결과 조회 (manager_id, period_id 필터) |
| POST | `/api/results/batch` | 평가 결과 일괄 저장 (INSERT OR REPLACE) |

| GET | `/api/dashboard` | 대시보드 집계 데이터 — period_id 미지정 시 is_confirmed=1 최신 기간 자동 선택, **periodId** 응답 포함 |

SPA 방식 — URL 변경 없이 `showPage(name)` 함수로 섹션 전환

| 뷰 ID | 사이드바 위치 | 설명 |
|-------|-------------|------|
| `dashboard` | 상단 (기본) | 전체/보직별/관리자별/업무별 탭 + 7종 차트 |
| `evaluation` | 상단 | 평가 입력 (직책별 맞춤 항목, batch 저장) |
| `report` | 상단 | 개인 보고서 (영역별 달성률, 등급 판정, 인쇄) |
| `managers` | 관리 섹션 | 관리자 CRUD 모달 |
| `items` | 관리 섹션 | 평가 항목 CRUD (직책별 필터) |
| `periods` | 관리 섹션 | 평가 기간 관리 |

### 별도 URL 페이지

| URL | 함수 | 설명 |
|-----|------|------|
| `/` | `getMainHtml()` (인라인) | 메인 앱 SPA |
| `/colors` | `getColorsHtml()` | 색상 설정 전용 독립 페이지 (새 탭) |

---

## 7. 차트 구성 (Chart.js 7종)

| 변수명 | 탭 | 종류 | 설명 |
|--------|-----|------|------|
| `state.charts.totalBar` | 전체 현황 | Bar | 관리자별 총점 비교 |
| `state.charts.radarAvg` | 전체 현황 | Radar | 평가 영역별 평균 |
| `state.charts.posBar` | 보직별 | Bar | 보직별 평균 점수 |
| `state.charts.posDoughnut` | 보직별 | Doughnut | 보직별 구성 비율 |
| `state.charts.managerGrouped` | 관리자별 | Bar (grouped) | 관리자별 영역 점수 |
| `state.charts.catHeatmap` | 업무별 | Bar | 항목별 히트맵형 점수 |
| `state.charts.catPolar` | 업무별 | PolarArea | 영역별 점수 분포 |

---

## 8. 색상 시스템

### 색상 저장 방식
- **localStorage key:** `lingo_theme` (JSON 직렬화)
- **적용 방식:** `<style id="dynamic-theme-style">` 태그에 CSS 변수 + `!important` 규칙으로 Tailwind 오버라이드
- **DB 저장 항목:** `positions.color`, `eval_categories.color` (PUT API로 즉시 반영)

### CSS 변수 목록
```css
--accent           /* 강조색 (기본 #6366f1) */
--accent-hover     /* 강조 hover 색 */
--sidebar-from     /* 사이드바 그라디언트 시작 */
--sidebar-to       /* 사이드바 그라디언트 끝 */
--sidebar-border   /* 사이드바 테두리 */
--body-bg          /* 전체 배경 */
--card-bg          /* 카드 배경 */
--grade-S-bg/fg    /* 등급 S 배경/전경 */
--grade-A-bg/fg    /* 등급 A */
--grade-B-bg/fg    /* 등급 B */
--grade-C-bg/fg    /* 등급 C */
--grade-D-bg/fg    /* 등급 D */
```

### UI 테마 프리셋 6종
기본 인디고 / 딥 퍼플 / 오션 블루 / 에메랄드 / 로즈 골드 / 슬레이트 다크

### `/colors` 페이지 섹션 구성
1. **UI 테마** — 프리셋 6종 + 사이드바/강조/배경 색상 피커 + 등급색 S~D
2. **직책 색상** — 퀵팔레트 12색 + color picker → `/api/positions/:id` PUT
3. **평가 영역 색상** — 퀵팔레트 12색 + color picker → `/api/categories/:id` PUT

---

## 9. 등급 판정 기준

| 등급 | 점수 기준 | 레이블 | CSS 클래스 |
|------|-----------|--------|------------|
| S | 90점 이상 | 탁월함 | `grade-S` |
| A | 80점 이상 | 우수함 | `grade-A` |
| B | 70점 이상 | 양호함 | `grade-B` |
| C | 60점 이상 | 보통 | `grade-C` |
| D | 60점 미만 | 개선필요 | `grade-D` |

---

## 10. UI/UX 규칙

- **로딩 상태:** 스피너 표시 (inline spinner HTML)
- **빈 데이터:** 빈 상태 메시지 (각 섹션별 안내 문구)
- **삭제 확인:** `confirm()` 또는 모달 사용 (즉시 삭제 방지)
- **평가 저장:** 일괄 저장 방식 (`/api/results/batch` POST)
- **인쇄:** 개인 보고서에서 `window.print()` 지원
- **모달:** 관리자/항목/기간 CRUD 모두 모달 방식
- **새 기능 추가 시:** **메뉴 위치를 먼저 제안 → 확인 받고 개발 착수** (운영 규칙)

---

## 11. 사이드바 구조

```
┌─────────────────────────┐
│ 🔹 링고 고객센터          │  ← border-white/10, rounded-xl 아이콘
│    관리자 평가 시스템      │  ← text-indigo-200 font-medium
├─────────────────────────┤
│ 대시보드                  │  ← 기본 active
│ 평가 입력                 │
│ 개인 보고서               │
│  ── 관리 ──              │  ← 양쪽 h-px bg-white/10 + text-white/50 tracking-widest
│ 관리자 관리               │
│ 평가 항목 관리            │
│ 평가 기간 관리            │
├─────────────────────────┤
│ 📅 현재 평가 기간          │  ← bg-white/5, font-semibold text-white
│    2026년 6월     🎨     │  ← 🎨 → /colors 새 탭 링크
└─────────────────────────┘
```

---

## 12. 개발 환경 명령어

```bash
# 빌드
cd /home/user/webapp && npm run build

# 서버 시작 (PM2)
pm2 start ecosystem.config.cjs

# 서버 재시작
fuser -k 3000/tcp 2>/dev/null || true
pm2 delete all 2>/dev/null || true
npm run build
pm2 start ecosystem.config.cjs

# DB 초기화 (마이그레이션 + 시드)
npm run db:reset

# 마이그레이션만
npm run db:migrate:local

# 시드만
npm run db:seed

# PM2 로그 확인
pm2 logs webapp --nostream

# 빌드 결과물 위치
dist/_worker.js  (약 150~160 kB)
```

---

## 13. 빌드·운영 현황

| 항목 | 내용 |
|------|------|
---

## 6. 프론트엔드 페이지(뷰) 목록

| 최근 빌드 | 성공 (dist/_worker.js ~170 kB, 빌드 약 633ms) |
| 서버 상태 | PM2 webapp (id:0) online, port 3000 |
| Git 브랜치 | `main` |
| 최근 커밋 | `7ee51ae` — "feat: 항목 변경이력·배점확인·추가시점·사유 입력 기능 추가" |
| 미완료 작업 | 없음 |

1. **새 기능 추가 시 메뉴 위치를 먼저 제안 → 확인 받고 개발 착수**
2. favicon.ico 404는 정상 동작 (무시)
3. Cloudflare Workers 환경이므로 Node.js `fs`, `path` 등 사용 불가
4. 정적 파일은 반드시 `hono/cloudflare-workers`의 `serveStatic` 사용
5. D1 로컬 개발은 `--local` 플래그 필수 (`.wrangler/state/v3/d1`에 SQLite 생성)
6. 테마 색상은 localStorage만 저장, 직책·영역 색상은 DB에도 저장

---

## 14. ⚠️ 인라인 `<script>` 내 TypeScript 문법 절대 금지

### 배경
`src/index.tsx`는 **서버 코드(Hono 라우트)**와 **클라이언트 코드(인라인 HTML 문자열 안의 `<script>`)** 가 공존한다.  
Vite 빌드는 **서버 코드만 TypeScript → JavaScript로 컴파일**하며,  
HTML 문자열 안의 `<script>` 내용은 **그대로 브라우저로 전달**된다.  
따라서 `<script>` 태그 안에 TypeScript 문법이 들어가면 브라우저에서 **SyntaxError → 전체 JS 실행 중단 → 데이터 미표시** 현상이 발생한다.

### 금지 패턴 (브라우저에서 SyntaxError 유발)

```typescript
// ❌ 타입 캐스팅
(document.getElementById('foo') as HTMLInputElement).value
(document.getElementById('bar') as HTMLSelectElement).value

// ❌ 타입 어노테이션
const body: any = { ... }
items.forEach((item: any) => { ... })
state.periods.find((p: any) => p.id === id)
function fmtDate(d: string) { ... }
const byCategory: any = {}
const actionLabel: any = { ... }
```

### 올바른 패턴 (순수 JavaScript)

```javascript
// ✅ 타입 캐스팅 → 그냥 접근
document.getElementById('foo').value
document.getElementById('bar').value

// ✅ 타입 어노테이션 → 제거
const body = { ... }
items.forEach(item => { ... })
state.periods.find(p => p.id === id)
function fmtDate(d) { ... }
const byCategory = {}
const actionLabel = { ... }
```

### 적용 범위

| 위치 | TypeScript 문법 사용 가능 여부 |
|------|-------------------------------|
| Hono 라우트 코드 (`app.get(...)`, `app.post(...)` 등) | ✅ 가능 (Vite가 컴파일) |
| `getIndexHtml()` 함수 자체의 반환 타입 `: string` | ✅ 가능 (함수 선언부) |
| **`getIndexHtml()` 안에서 반환하는 HTML 문자열 내 `<script>` 태그** | ❌ **절대 불가** |
| **`getColorsHtml()` 안에서 반환하는 HTML 문자열 내 `<script>` 태그** | ❌ **절대 불가** |

### 확인 방법
코드 작성 후 아래 명령으로 인라인 script 영역에 TypeScript 문법이 없는지 검증:
```bash
# getIndexHtml 함수 범위(418번 줄 이후) 내 TypeScript 문법 검색
grep -n " as HTML\|: any\b\|: string\b\|: number\b" src/index.tsx | awk -F: '$2 > 418'
# 결과가 없어야 정상 (서버 코드 범위 밖에는 TypeScript 문법 0건이어야 함)
```
