-- eval_items.position_id(단일) → eval_item_positions 중간 테이블(다대다) 전환

-- 1. 중간 테이블 생성
CREATE TABLE IF NOT EXISTS eval_item_positions (
  item_id    INTEGER NOT NULL,
  position_id INTEGER NOT NULL,
  PRIMARY KEY (item_id, position_id),
  FOREIGN KEY (item_id)     REFERENCES eval_items(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

-- 2. 기존 position_id 데이터를 중간 테이블로 이전 (NULL 은 공통이므로 행 없음)
INSERT OR IGNORE INTO eval_item_positions (item_id, position_id)
SELECT id, position_id FROM eval_items WHERE position_id IS NOT NULL;

-- 3. eval_items 의 position_id 컬럼은 레거시용으로 남겨두되 더 이상 사용하지 않음
--    (SQLite 는 DROP COLUMN 을 제한적으로 지원하므로 NULL 로만 통일)
UPDATE eval_items SET position_id = NULL WHERE position_id IS NOT NULL;

-- 4. 인덱스
CREATE INDEX IF NOT EXISTS idx_item_positions_item ON eval_item_positions(item_id);
CREATE INDEX IF NOT EXISTS idx_item_positions_pos  ON eval_item_positions(position_id);
