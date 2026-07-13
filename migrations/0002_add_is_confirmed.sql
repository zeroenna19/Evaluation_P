-- eval_periods 테이블에 반영완료 컬럼 추가
ALTER TABLE eval_periods ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 0;

-- 코멘트: is_confirmed = 1 → 반영완료(대시보드 기본 기간으로 우선 표시)
--         is_confirmed = 0 → 임시(작업중)
