-- 직책 초기 데이터
INSERT OR IGNORE INTO positions (id, name, color) VALUES
  (1, '센터장', '#7c3aed'),
  (2, '전산팀장', '#2563eb'),
  (3, '강사', '#059669'),
  (4, '매니저', '#d97706'),
  (5, '상담팀장', '#dc2626');

-- 관리자 초기 데이터 (엑셀 기준)
INSERT OR IGNORE INTO managers (id, name, position_id) VALUES
  (1, '최정은', 1),
  (2, '박유준', 2),
  (3, '경혜림', 3),
  (4, '신유현', 4),
  (5, '김남현', 5),
  (6, '강혜미', 5),
  (7, '장찬환', 5);

-- 평가 영역 초기 데이터
INSERT OR IGNORE INTO eval_categories (id, name, max_score, sort_order, color) VALUES
  (1, '센터 운영 관리', 25, 1, '#6366f1'),
  (2, '링고 서비스 전문성', 25, 2, '#0ea5e9'),
  (3, '팀 리더십 및 육성', 15, 3, '#10b981'),
  (4, '고객 응대 품질 관리', 15, 4, '#f59e0b'),
  (5, '영업 지원 및 성과', 20, 5, '#ef4444');

-- 평가 항목 공통 (position_id = NULL이면 모든 직책 공통)
-- 1. 센터 운영 관리
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (1,  1, NULL, '보고 체계',     '주간 성과 보고의 정확성·신속성',                        10, 1),
  (2,  1, NULL, '근태 관리',     '팀원 출근·근태 관리 정확성',                             5,  2),
  (3,  1, NULL, '업무 분배',     '주간 목표 및 스케줄 관리 능력',                          5,  3),
  (4,  1, NULL, '일일 운영 보고','일일 상담현황, 이슈사항 정확한 보고 및 대응',              5,  4);

-- 2. 링고 서비스 전문성
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (5,  2, NULL, '업무 숙지 이해도',    '통화연결음 서비스 기능 및 신청/변경 프로세스 숙지',          10, 1),
  (6,  2, NULL, '협업 업무 능력',      'KT, KT알파, 기고센터, 스튜디오 등 타 업체와의 원활한 협업', 10, 2),
  (7,  2, NULL, 'KT 서비스 연동 지식', 'KT 통신 인프라 및 관련 서비스 연계 이해도',               5,  3);

-- 3. 팀 리더십 및 육성
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (8,  3, NULL, '팀원 관리',    '교육·코칭·동기부여 활동',                        5, 1),
  (9,  3, NULL, '팀 동기부여',  '긍정적 조직문화 조성 및 상담원 동기 관리',       5, 2),
  (10, 3, NULL, '커뮤니케이션', '타 부서와 협업 및 보고 능력',                    5, 3);

-- 4. 고객 응대 품질 관리 (상담팀장/센터장/강사/매니저 공통)
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (11, 4, NULL, '상담 품질 모니터링', '정기적인 콜 모니터링 및 피드백 관리',              5, 1),
  (12, 4, NULL, 'VOC 관리',          '고객 불만 및 건의사항 신속한 처리 및 분석',        5, 2),
  (13, 4, NULL, '센터 목표 달성률',  '월간/분기별 센터 KPI 목표 달성도',                5, 3);

-- 4. 전산팀장 전용 - 고객센터 시스템 관리 (category_id=4 에 position_id=2 추가)
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (21, 4, 2, '시스템 관리 모니터링', '일별 전산시스템 모니터링 및 점검일지 관리',                               5, 1),
  (22, 4, 2, '장애 관리',           '네트워크, CTI, ARS 등 오류 발생 시 신속한 분석/대응 및 결과 보고',        5, 2),
  (23, 4, 2, 'SLA 달성률',          'SLA(Service Level Agreement, 서비스 수준 계약) 달성률',                   5, 3);

-- 5. 영업 지원 및 성과 (공통)
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (14, 5, NULL, '신규 및 업셀링 가입 유도', '링고 서비스 가입 유도 컨택 및 업그레이드 상품으로 전환 제안 실적', 5, 1),
  (15, 5, NULL, '해지방어 활동',            '상품유지 시 장점, 고객맞춤 링고활용법 제안 등의 해지 방어 활동',  5, 2),
  (16, 5, NULL, '혁신 활동',               '새로운 아이디어 제안 및 실행',                                    5, 3),
  (17, 5, NULL, '자기 개발',               '직무 관련 학습·역량 강화 노력',                                  5, 4);

-- 5. 전산팀장 전용 영업 지원
INSERT OR IGNORE INTO eval_items (id, category_id, position_id, item_name, criteria, max_score, sort_order) VALUES
  (24, 5, 2, 'DB 관리 및 관련 시스템 지원', '영업DB 추출, 관리, 툴체크, 별도 신규DB 확보 등', 5, 1),
  (25, 5, 2, '보안관리',                   '전산실 및 고객센터 내 보안관리',                  5, 2),
  (26, 5, 2, '혁신 활동',                  '새로운 아이디어 제안 및 실행',                    5, 3),
  (27, 5, 2, '자기 개발',                  '직무 관련 학습·역량 강화 노력',                  5, 4);

-- 평가 기간
INSERT OR IGNORE INTO eval_periods (id, year, month, label, is_confirmed) VALUES
  (1, 2026, 6, '2026년 6월', 1),   -- 반영완료
  (2, 2026, 7, '2026년 7월', 0);   -- 임시(작업중)

-- 평가 결과 데이터 (엑셀 기준)
-- 최정은(센터장, id=1)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (1,1,1,9),(1,1,2,5),(1,1,3,5),(1,1,4,3),
  (1,1,5,6),(1,1,6,7),(1,1,7,2),
  (1,1,8,5),(1,1,9,5),(1,1,10,4),
  (1,1,11,5),(1,1,12,3),(1,1,13,5),
  (1,1,14,3),(1,1,15,3),(1,1,16,0),(1,1,17,0);

-- 박유준(전산팀장, id=2)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (2,1,1,10),(2,1,2,5),(2,1,3,5),(2,1,4,5),
  (2,1,5,10),(2,1,6,10),(2,1,7,5),
  (2,1,8,5),(2,1,9,5),(2,1,10,5),
  (2,1,21,5),(2,1,22,5),(2,1,23,5),
  (2,1,24,5),(2,1,25,5),(2,1,26,3),(2,1,27,5);

-- 경혜림(강사, id=3)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (3,1,1,9),(3,1,2,5),(3,1,3,5),(3,1,4,4),
  (3,1,5,8),(3,1,6,7),(3,1,7,3),
  (3,1,8,5),(3,1,9,5),(3,1,10,3),
  (3,1,11,5),(3,1,12,4),(3,1,13,5),
  (3,1,14,0),(3,1,15,2),(3,1,16,3),(3,1,17,3);

-- 신유현(매니저, id=4)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (4,1,1,9),(4,1,2,5),(4,1,3,5),(4,1,4,4),
  (4,1,5,8),(4,1,6,8),(4,1,7,3),
  (4,1,8,5),(4,1,9,5),(4,1,10,5),
  (4,1,11,5),(4,1,12,5),(4,1,13,5),
  (4,1,14,0),(4,1,15,0),(4,1,16,3),(4,1,17,4);

-- 김남현(상담팀장, id=5)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score, note) VALUES
  (5,1,1,9,NULL),(5,1,2,5,NULL),(5,1,3,5,NULL),(5,1,4,5,NULL),
  (5,1,5,9,NULL),(5,1,6,10,NULL),(5,1,7,5,NULL),
  (5,1,8,5,NULL),(5,1,9,5,NULL),(5,1,10,5,NULL),
  (5,1,11,5,NULL),(5,1,12,5,'VOC 담당 팀장'),(5,1,13,5,NULL),
  (5,1,14,0,NULL),(5,1,15,1,NULL),(5,1,16,3,NULL),(5,1,17,3,NULL);

-- 강혜미(상담팀장, id=6)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (6,1,1,9),(6,1,2,5),(6,1,3,5),(6,1,4,5),
  (6,1,5,10),(6,1,6,10),(6,1,7,5),
  (6,1,8,5),(6,1,9,5),(6,1,10,5),
  (6,1,11,5),(6,1,12,4),(6,1,13,5),
  (6,1,14,0),(6,1,15,1),(6,1,16,3),(6,1,17,3);

-- 장찬환(상담팀장, id=7)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (7,1,1,10),(7,1,2,5),(7,1,3,5),(7,1,4,5),
  (7,1,5,9),(7,1,6,9),(7,1,7,4),
  (7,1,8,5),(7,1,9,5),(7,1,10,5),
  (7,1,11,5),(7,1,12,4),(7,1,13,5),
  (7,1,14,0),(7,1,15,3),(7,1,16,3),(7,1,17,3);

-- ===================== 2026년 7월 임시 평가 결과 (period_id=2) =====================
-- 최정은(센터장, id=1)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (1,2,1,8),(1,2,2,5),(1,2,3,4),(1,2,4,4),
  (1,2,5,7),(1,2,6,8),(1,2,7,3),
  (1,2,8,5),(1,2,9,4),(1,2,10,4),
  (1,2,11,4),(1,2,12,3),(1,2,13,4),
  (1,2,14,2),(1,2,15,3),(1,2,16,1),(1,2,17,1);

-- 박유준(전산팀장, id=2)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (2,2,1,9),(2,2,2,5),(2,2,3,5),(2,2,4,4),
  (2,2,5,9),(2,2,6,9),(2,2,7,4),
  (2,2,8,4),(2,2,9,4),(2,2,10,5),
  (2,2,21,5),(2,2,22,4),(2,2,23,4),
  (2,2,24,4),(2,2,25,5),(2,2,26,3),(2,2,27,4);

-- 경혜림(강사, id=3)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (3,2,1,8),(3,2,2,5),(3,2,3,4),(3,2,4,4),
  (3,2,5,7),(3,2,6,7),(3,2,7,3),
  (3,2,8,4),(3,2,9,4),(3,2,10,3),
  (3,2,11,4),(3,2,12,3),(3,2,13,4),
  (3,2,14,1),(3,2,15,2),(3,2,16,2),(3,2,17,3);

-- 신유현(매니저, id=4)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (4,2,1,9),(4,2,2,5),(4,2,3,5),(4,2,4,4),
  (4,2,5,8),(4,2,6,7),(4,2,7,3),
  (4,2,8,5),(4,2,9,4),(4,2,10,4),
  (4,2,11,4),(4,2,12,4),(4,2,13,4),
  (4,2,14,1),(4,2,15,1),(4,2,16,2),(4,2,17,3);

-- 김남현(상담팀장, id=5)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (5,2,1,8),(5,2,2,5),(5,2,3,4),(5,2,4,4),
  (5,2,5,8),(5,2,6,9),(5,2,7,4),
  (5,2,8,4),(5,2,9,4),(5,2,10,4),
  (5,2,11,4),(5,2,12,4),(5,2,13,4),
  (5,2,14,1),(5,2,15,1),(5,2,16,2),(5,2,17,3);

-- 강혜미(상담팀장, id=6)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (6,2,1,8),(6,2,2,5),(6,2,3,5),(6,2,4,4),
  (6,2,5,9),(6,2,6,9),(6,2,7,4),
  (6,2,8,4),(6,2,9,4),(6,2,10,4),
  (6,2,11,4),(6,2,12,3),(6,2,13,4),
  (6,2,14,1),(6,2,15,1),(6,2,16,2),(6,2,17,3);

-- 장찬환(상담팀장, id=7)
INSERT OR IGNORE INTO eval_results (manager_id, period_id, item_id, score) VALUES
  (7,2,1,9),(7,2,2,5),(7,2,3,5),(7,2,4,4),
  (7,2,5,8),(7,2,6,8),(7,2,7,4),
  (7,2,8,4),(7,2,9,4),(7,2,10,4),
  (7,2,11,4),(7,2,12,3),(7,2,13,4),
  (7,2,14,1),(7,2,15,2),(7,2,16,2),(7,2,17,3);
