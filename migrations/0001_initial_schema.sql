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

-- 평가 항목 테이블 (직책별로 다른 항목 지원)
CREATE TABLE IF NOT EXISTS eval_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL,
  position_id INTEGER,
  item_name TEXT NOT NULL,
  criteria TEXT,
  max_score INTEGER NOT NULL DEFAULT 5,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES eval_categories(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- 평가 기간 테이블
CREATE TABLE IF NOT EXISTS eval_periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  label TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(year, month)
);

-- 평가 결과 테이블
CREATE TABLE IF NOT EXISTS eval_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manager_id INTEGER NOT NULL,
  period_id INTEGER NOT NULL,
  item_id INTEGER NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (manager_id) REFERENCES managers(id),
  FOREIGN KEY (period_id) REFERENCES eval_periods(id),
  FOREIGN KEY (item_id) REFERENCES eval_items(id),
  UNIQUE(manager_id, period_id, item_id)
);

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_managers_position ON managers(position_id);
CREATE INDEX IF NOT EXISTS idx_eval_items_category ON eval_items(category_id);
CREATE INDEX IF NOT EXISTS idx_eval_items_position ON eval_items(position_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_manager ON eval_results(manager_id);
CREATE INDEX IF NOT EXISTS idx_eval_results_period ON eval_results(period_id);
