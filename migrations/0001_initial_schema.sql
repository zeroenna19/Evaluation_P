-- 직책 테이블
CREATE TABLE IF NOT EXISTS positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 관리자 테이블
CREATE TABLE IF NOT EXISTS managers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  position_id INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- 평가 영역 테이블
CREATE TABLE IF NOT EXISTS eval_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  max_score INTEGER NOT NULL DEFAULT 25,
  sort_order INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 평가 항목 테이블
CREATE TABLE IF NOT EXISTS eval_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  position_id INTEGER,          -- 레거시 컬럼 (미사용, NULL 고정)
  item_name TEXT NOT NULL,
  criteria TEXT,
  max_score INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES eval_categories(id)
);

-- 평가 항목 ↔ 직책 중간 테이블 (다대다)
-- 행 없음 = 공통(전 직책), 행 있음 = 해당 직책 전용
CREATE TABLE IF NOT EXISTS eval_item_positions (
  item_id     INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, position_id),
  FOREIGN KEY (item_id)     REFERENCES eval_items(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- 평가 기간 테이블
CREATE TABLE IF NOT EXISTS eval_periods (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  year         INTEGER NOT NULL,
  month        INTEGER NOT NULL,
  label        TEXT NOT NULL,
  is_active    INTEGER NOT NULL DEFAULT 1,
  is_confirmed INTEGER NOT NULL DEFAULT 0,  -- 1=반영완료, 0=임시
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, month)
);

-- 평가 항목 변경이력 테이블
CREATE TABLE IF NOT EXISTS item_history (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id       INTEGER,           -- NULL 허용: 삭제된 항목도 보존
  action        TEXT NOT NULL,     -- 'add' | 'edit' | 'delete'
  item_name     TEXT NOT NULL,
  category_name TEXT,
  position_name TEXT,              -- NULL = 공통
  max_score     INTEGER,
  reason        TEXT,
  changed_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES eval_items(id)
);

-- 평가 결과 테이블
CREATE TABLE IF NOT EXISTS eval_results (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL,
  period_id  INTEGER NOT NULL,
  item_id    INTEGER NOT NULL,
  score      INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES managers(id),
  FOREIGN KEY (period_id)  REFERENCES eval_periods(id),
  FOREIGN KEY (item_id)    REFERENCES eval_items(id),
  UNIQUE(manager_id, period_id, item_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_managers_position      ON managers(position_id);
CREATE INDEX IF NOT EXISTS idx_eval_items_category    ON eval_items(category_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_manager   ON eval_results(manager_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_period    ON eval_results(period_id);
CREATE INDEX IF NOT EXISTS idx_item_positions_item    ON eval_item_positions(item_id);
CREATE INDEX IF NOT EXISTS idx_item_positions_pos     ON eval_item_positions(position_id);
CREATE INDEX IF NOT EXISTS idx_item_history_item      ON item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_item_history_changed   ON item_history(changed_at DESC);
