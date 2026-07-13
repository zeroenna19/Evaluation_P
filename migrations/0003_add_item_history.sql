-- 평가 항목 변경이력 테이블
CREATE TABLE IF NOT EXISTS item_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id   INTEGER,                        -- NULL 허용: 삭제된 항목도 보존
  action    TEXT NOT NULL,                  -- 'add' | 'edit' | 'delete'
  item_name TEXT NOT NULL,                  -- 변경 당시 항목명 스냅샷
  category_name TEXT,                       -- 변경 당시 영역명 스냅샷
  position_name TEXT,                       -- 변경 당시 직책명 (NULL=공통)
  max_score INTEGER,                        -- 변경 당시 배점 스냅샷
  reason    TEXT,                           -- 변경 사유
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (item_id) REFERENCES eval_items(id)
);

CREATE INDEX IF NOT EXISTS idx_item_history_item ON item_history(item_id);
CREATE INDEX IF NOT EXISTS idx_item_history_changed ON item_history(changed_at DESC);
