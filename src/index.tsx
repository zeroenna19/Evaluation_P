import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.use('/api/*', cors())
app.use('/static/*', serveStatic({ root: './public' }))

// ===================== POSITIONS =====================
app.get('/api/positions', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM positions ORDER BY id'
  ).all()
  return c.json(results)
})

app.post('/api/positions', async (c) => {
  const { name, color } = await c.req.json()
  if (!name) return c.json({ error: '직책명 필수' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO positions (name, color) VALUES (?, ?)'
  ).bind(name, color || '#6366f1').run()
  return c.json({ id: r.meta.last_row_id, name, color })
})

app.put('/api/positions/:id', async (c) => {
  const id = c.req.param('id')
  const { name, color } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE positions SET name=?, color=? WHERE id=?'
  ).bind(name, color, id).run()
  return c.json({ ok: true })
})

app.delete('/api/positions/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM positions WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

// ===================== MANAGERS =====================
app.get('/api/managers', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT m.*, p.name as position_name, p.color as position_color
    FROM managers m
    LEFT JOIN positions p ON m.position_id = p.id
    WHERE m.is_active = 1
    ORDER BY p.id, m.name
  `).all()
  return c.json(results)
})

app.post('/api/managers', async (c) => {
  const { name, position_id } = await c.req.json()
  if (!name || !position_id) return c.json({ error: '이름, 직책 필수' }, 400)
  const r = await c.env.DB.prepare(
    'INSERT INTO managers (name, position_id) VALUES (?, ?)'
  ).bind(name, position_id).run()
  return c.json({ id: r.meta.last_row_id, name, position_id })
})

app.put('/api/managers/:id', async (c) => {
  const id = c.req.param('id')
  const { name, position_id, is_active } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE managers SET name=?, position_id=?, is_active=? WHERE id=?'
  ).bind(name, position_id, is_active ?? 1, id).run()
  return c.json({ ok: true })
})

app.delete('/api/managers/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE managers SET is_active=0 WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

// ===================== EVAL CATEGORIES =====================
app.get('/api/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM eval_categories ORDER BY sort_order'
  ).all()
  return c.json(results)
})

app.post('/api/categories', async (c) => {
  const { name, max_score, sort_order, color } = await c.req.json()
  const r = await c.env.DB.prepare(
    'INSERT INTO eval_categories (name, max_score, sort_order, color) VALUES (?,?,?,?)'
  ).bind(name, max_score || 20, sort_order || 99, color || '#6366f1').run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  const { name, max_score, sort_order, color } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE eval_categories SET name=?, max_score=?, sort_order=?, color=? WHERE id=?'
  ).bind(name, max_score, sort_order, color, id).run()
  return c.json({ ok: true })
})

app.delete('/api/categories/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('DELETE FROM eval_categories WHERE id=?').bind(id).run()
  return c.json({ ok: true })
})

// ===================== EVAL ITEMS =====================
app.get('/api/items', async (c) => {
  const positionId = c.req.query('position_id')
  let query = `
    SELECT ei.*, ec.name as category_name, ec.color as category_color,
           p.name as position_name
    FROM eval_items ei
    LEFT JOIN eval_categories ec ON ei.category_id = ec.id
    LEFT JOIN positions p ON ei.position_id = p.id
    WHERE ei.is_active = 1
  `
  const params: any[] = []
  if (positionId) {
    query += ' AND (ei.position_id IS NULL OR ei.position_id = ?)'
    params.push(positionId)
  }
  query += ' ORDER BY ec.sort_order, ei.sort_order'
  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

// 변경이력 조회
app.get('/api/items/history', async (c) => {
  const { results } = await c.env.DB.prepare(`
    SELECT ih.*
    FROM item_history ih
    ORDER BY ih.changed_at DESC
    LIMIT 200
  `).all()
  return c.json(results)
})

// 직책별 배점 합산 확인
app.get('/api/items/score-check', async (c) => {
  // 1. 직책별 전용 항목 합산
  const { results: byPos } = await c.env.DB.prepare(`
    SELECT p.id as position_id, p.name as position_name, p.color,
           SUM(ei.max_score) as dedicated_score
    FROM positions p
    LEFT JOIN eval_items ei ON ei.position_id = p.id AND ei.is_active = 1
    GROUP BY p.id
    ORDER BY p.id
  `).all()
  // 2. 공통 항목 합산
  const common: any = await c.env.DB.prepare(`
    SELECT SUM(max_score) as common_score FROM eval_items
    WHERE position_id IS NULL AND is_active = 1
  `).first()
  const commonScore = common?.common_score || 0
  // 3. 직책별 총점 = 공통 + 전용
  const rows = (byPos as any[]).map(p => ({
    ...p,
    common_score: commonScore,
    total_score: commonScore + (p.dedicated_score || 0)
  }))
  return c.json({ rows, common_score: commonScore })
})

app.post('/api/items', async (c) => {
  const { category_id, position_id, item_name, criteria, max_score, sort_order, reason } = await c.req.json()
  const r = await c.env.DB.prepare(
    'INSERT INTO eval_items (category_id, position_id, item_name, criteria, max_score, sort_order) VALUES (?,?,?,?,?,?)'
  ).bind(category_id, position_id || null, item_name, criteria || '', max_score || 5, sort_order || 99).run()
  const newId = r.meta.last_row_id

  // 이력 기록 — 영역명·직책명 조회 후 스냅샷 저장
  const snap: any = await c.env.DB.prepare(`
    SELECT ec.name as category_name, p.name as position_name, ei.max_score
    FROM eval_items ei
    LEFT JOIN eval_categories ec ON ei.category_id = ec.id
    LEFT JOIN positions p ON ei.position_id = p.id
    WHERE ei.id = ?
  `).bind(newId).first()
  await c.env.DB.prepare(
    'INSERT INTO item_history (item_id, action, item_name, category_name, position_name, max_score, reason) VALUES (?,?,?,?,?,?,?)'
  ).bind(newId, 'add', item_name, snap?.category_name || '', snap?.position_name || null, snap?.max_score || max_score, reason || null).run()

  return c.json({ id: newId })
})

app.put('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  const { category_id, position_id, item_name, criteria, max_score, sort_order, is_active, reason } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE eval_items SET category_id=?, position_id=?, item_name=?, criteria=?, max_score=?, sort_order=?, is_active=? WHERE id=?'
  ).bind(category_id, position_id || null, item_name, criteria, max_score, sort_order, is_active ?? 1, id).run()

  // 이력 기록
  const snap: any = await c.env.DB.prepare(`
    SELECT ec.name as category_name, p.name as position_name, ei.max_score
    FROM eval_items ei
    LEFT JOIN eval_categories ec ON ei.category_id = ec.id
    LEFT JOIN positions p ON ei.position_id = p.id
    WHERE ei.id = ?
  `).bind(id).first()
  await c.env.DB.prepare(
    'INSERT INTO item_history (item_id, action, item_name, category_name, position_name, max_score, reason) VALUES (?,?,?,?,?,?,?)'
  ).bind(Number(id), 'edit', item_name, snap?.category_name || '', snap?.position_name || null, snap?.max_score || max_score, reason || null).run()

  return c.json({ ok: true })
})

app.delete('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  const { reason } = await c.req.json().catch(() => ({ reason: null }))

  // 삭제 전 스냅샷 저장
  const snap: any = await c.env.DB.prepare(`
    SELECT ei.item_name, ec.name as category_name, p.name as position_name, ei.max_score
    FROM eval_items ei
    LEFT JOIN eval_categories ec ON ei.category_id = ec.id
    LEFT JOIN positions p ON ei.position_id = p.id
    WHERE ei.id = ?
  `).bind(id).first()

  await c.env.DB.prepare('UPDATE eval_items SET is_active=0 WHERE id=?').bind(id).run()

  if (snap) {
    await c.env.DB.prepare(
      'INSERT INTO item_history (item_id, action, item_name, category_name, position_name, max_score, reason) VALUES (?,?,?,?,?,?,?)'
    ).bind(Number(id), 'delete', snap.item_name, snap.category_name || '', snap.position_name || null, snap.max_score, reason || null).run()
  }
  return c.json({ ok: true })
})

// ===================== EVAL PERIODS =====================
app.get('/api/periods', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM eval_periods ORDER BY year DESC, month DESC'
  ).all()
  return c.json(results)
})

app.post('/api/periods', async (c) => {
  const { year, month, label } = await c.req.json()
  const r = await c.env.DB.prepare(
    'INSERT OR IGNORE INTO eval_periods (year, month, label) VALUES (?,?,?)'
  ).bind(year, month, label || `${year}년 ${month}월`).run()
  return c.json({ id: r.meta.last_row_id })
})

// 반영완료 토글 (is_confirmed 0↔1)
app.put('/api/periods/:id/confirm', async (c) => {
  const id = c.req.param('id')
  // 현재 상태 조회
  const row: any = await c.env.DB.prepare(
    'SELECT is_confirmed FROM eval_periods WHERE id = ?'
  ).bind(id).first()
  if (!row) return c.json({ error: 'not found' }, 404)
  const next = row.is_confirmed === 1 ? 0 : 1
  await c.env.DB.prepare(
    'UPDATE eval_periods SET is_confirmed = ? WHERE id = ?'
  ).bind(next, id).run()
  return c.json({ id: Number(id), is_confirmed: next })
})

// ===================== EVAL RESULTS =====================
app.get('/api/results', async (c) => {
  const periodId = c.req.query('period_id')
  const managerId = c.req.query('manager_id')

  let query = `
    SELECT
      er.*,
      m.name as manager_name, m.position_id,
      p.name as position_name, p.color as position_color,
      ei.item_name, ei.max_score as item_max_score, ei.category_id,
      ec.name as category_name, ec.color as category_color, ec.max_score as category_max_score
    FROM eval_results er
    LEFT JOIN managers m ON er.manager_id = m.id
    LEFT JOIN positions p ON m.position_id = p.id
    LEFT JOIN eval_items ei ON er.item_id = ei.id
    LEFT JOIN eval_categories ec ON ei.category_id = ec.id
    WHERE 1=1
  `
  const params: any[] = []
  if (periodId) { query += ' AND er.period_id = ?'; params.push(periodId) }
  if (managerId) { query += ' AND er.manager_id = ?'; params.push(managerId) }
  query += ' ORDER BY m.id, ec.sort_order, ei.sort_order'

  const { results } = await c.env.DB.prepare(query).bind(...params).all()
  return c.json(results)
})

app.post('/api/results/batch', async (c) => {
  const { manager_id, period_id, scores } = await c.req.json()
  // scores: [{ item_id, score, note }]
  const stmts = scores.map((s: any) =>
    c.env.DB.prepare(`
      INSERT INTO eval_results (manager_id, period_id, item_id, score, note, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(manager_id, period_id, item_id)
      DO UPDATE SET score=excluded.score, note=excluded.note, updated_at=CURRENT_TIMESTAMP
    `).bind(manager_id, period_id, s.item_id, s.score, s.note || null)
  )
  await c.env.DB.batch(stmts)
  return c.json({ ok: true })
})

// ===================== DASHBOARD DATA =====================
app.get('/api/dashboard', async (c) => {
  // period_id 미지정 시 → is_confirmed=1 중 가장 최근 기간 자동 선택
  // 반영완료 기간이 없으면 가장 최근 기간 사용
  let periodId = c.req.query('period_id')
  if (!periodId) {
    const confirmed: any = await c.env.DB.prepare(
      'SELECT id FROM eval_periods WHERE is_confirmed = 1 ORDER BY year DESC, month DESC LIMIT 1'
    ).first()
    if (confirmed) {
      periodId = String(confirmed.id)
    } else {
      const latest: any = await c.env.DB.prepare(
        'SELECT id FROM eval_periods ORDER BY year DESC, month DESC LIMIT 1'
      ).first()
      periodId = latest ? String(latest.id) : '1'
    }
  }

  // 1. 전체 요약
  const { results: summary } = await c.env.DB.prepare(`
    SELECT
      m.id as manager_id, m.name as manager_name,
      p.id as position_id, p.name as position_name, p.color as position_color,
      SUM(er.score) as total_score,
      SUM(ei.max_score) as total_max
    FROM managers m
    LEFT JOIN positions p ON m.position_id = p.id
    LEFT JOIN eval_results er ON er.manager_id = m.id AND er.period_id = ?
    LEFT JOIN eval_items ei ON er.item_id = ei.id
    WHERE m.is_active = 1
    GROUP BY m.id
    ORDER BY total_score DESC
  `).bind(periodId).all()

  // 2. 영역별 평균
  const { results: byCategory } = await c.env.DB.prepare(`
    SELECT
      ec.id as category_id, ec.name as category_name, ec.color,
      ec.max_score as category_max,
      ROUND(AVG(sub.cat_score), 1) as avg_score
    FROM eval_categories ec
    LEFT JOIN (
      SELECT ei.category_id, er.manager_id,
             SUM(er.score) as cat_score
      FROM eval_results er
      LEFT JOIN eval_items ei ON er.item_id = ei.id
      WHERE er.period_id = ?
      GROUP BY ei.category_id, er.manager_id
    ) sub ON sub.category_id = ec.id
    GROUP BY ec.id
    ORDER BY ec.sort_order
  `).bind(periodId).all()

  // 3. 보직별 평균
  const { results: byPosition } = await c.env.DB.prepare(`
    SELECT
      p.id as position_id, p.name as position_name, p.color,
      COUNT(DISTINCT m.id) as member_count,
      ROUND(AVG(sub.total_score), 1) as avg_score
    FROM positions p
    LEFT JOIN managers m ON m.position_id = p.id AND m.is_active = 1
    LEFT JOIN (
      SELECT er.manager_id, SUM(er.score) as total_score
      FROM eval_results er
      WHERE er.period_id = ?
      GROUP BY er.manager_id
    ) sub ON sub.manager_id = m.id
    GROUP BY p.id
    ORDER BY avg_score DESC
  `).bind(periodId).all()

  // 4. 관리자별 영역 breakdown
  const { results: managerCategory } = await c.env.DB.prepare(`
    SELECT
      m.id as manager_id, m.name as manager_name,
      p.name as position_name, p.color as position_color,
      ec.id as category_id, ec.name as category_name, ec.color as category_color,
      ec.max_score as category_max,
      COALESCE(SUM(er.score), 0) as cat_score
    FROM managers m
    LEFT JOIN positions p ON m.position_id = p.id
    CROSS JOIN eval_categories ec
    LEFT JOIN eval_items ei ON ei.category_id = ec.id
      AND (ei.position_id IS NULL OR ei.position_id = m.position_id)
      AND ei.is_active = 1
    LEFT JOIN eval_results er ON er.manager_id = m.id
      AND er.item_id = ei.id AND er.period_id = ?
    WHERE m.is_active = 1
    GROUP BY m.id, ec.id
    ORDER BY m.id, ec.sort_order
  `).bind(periodId).all()

  return c.json({ summary, byCategory, byPosition, managerCategory, periodId: Number(periodId) })
})

// ===================== STATIC & HTML =====================
app.get('/', (c) => {
  return c.html(getIndexHtml())
})

// 색상 설정 전용 페이지 (별도 URL)
app.get('/colors', (c) => {
  return c.html(getColorsHtml())
})

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>링고 고객센터 관리자 평가 시스템</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js"></script>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;600;700&display=swap');
  * { font-family: 'Noto Sans KR', sans-serif; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: #f1f5f9; }
  ::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 3px; }
  .nav-item { transition: all 0.2s; }
  .nav-item.active { background: rgba(255,255,255,0.15); }
  .nav-item:hover { background: rgba(255,255,255,0.1); }
  .card { background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04); }
  .grade-S { background: #fef3c7; color: #92400e; }
  .grade-A { background: #dcfce7; color: #166534; }
  .grade-B { background: #dbeafe; color: #1e40af; }
  .grade-C { background: #f3f4f6; color: #374151; }
  .grade-D { background: #fee2e2; color: #991b1b; }
  .chart-container { position: relative; }
  .tab-btn { transition: all 0.2s; border-bottom: 2px solid transparent; }
  .tab-btn.active { border-bottom-color: #6366f1; color: #6366f1; font-weight: 600; }
  .score-input { width: 60px; text-align: center; border: 1px solid #e2e8f0; border-radius: 6px; padding: 4px; }
  .score-input:focus { outline: none; border-color: #6366f1; box-shadow: 0 0 0 2px rgba(99,102,241,0.1); }
  .modal { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
  .modal.open { display: flex; }
  .progress-bar { height: 8px; border-radius: 4px; background: #e2e8f0; overflow: hidden; }
  .progress-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
  .animate-pulse { animation: pulse 2s infinite; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }
  .tooltip { position: relative; }
  .tooltip:hover .tooltip-text { display:block; }
  .tooltip-text { display:none; position:absolute; bottom:100%; left:50%; transform:translateX(-50%); background:#1e293b; color:white; padding:4px 8px; border-radius:4px; font-size:11px; white-space:nowrap; z-index:10; }

  /* 색상 설정 전용 */
  :root {
    --accent: #6366f1;
    --accent-hover: #4f46e5;
    --sidebar-from: #312e81;
    --sidebar-to: #3730a3;
    --sidebar-border: #4338ca;
    --body-bg: #f8fafc;
    --card-bg: #ffffff;
    --grade-S-bg: #fef3c7; --grade-S-fg: #92400e;
    --grade-A-bg: #dcfce7; --grade-A-fg: #166534;
    --grade-B-bg: #dbeafe; --grade-B-fg: #1e40af;
    --grade-C-bg: #f3f4f6; --grade-C-fg: #374151;
    --grade-D-bg: #fee2e2; --grade-D-fg: #991b1b;
  }
  .color-picker-inline {
    width: 36px; height: 28px; padding: 2px; border: 1px solid #e2e8f0;
    border-radius: 6px; cursor: pointer; background: white;
  }
  .color-picker-inline::-webkit-color-swatch-wrapper { padding: 2px; }
  .color-picker-inline::-webkit-color-swatch { border: none; border-radius: 4px; }
  .color-row-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px; border: 1px solid #e2e8f0; border-radius: 10px;
    background: white; transition: box-shadow 0.15s;
  }
  .color-row-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .color-swatch {
    width: 28px; height: 28px; border-radius: 6px; border: 2px solid rgba(0,0,0,0.08);
    cursor: pointer; transition: transform 0.15s;
  }
  .color-swatch:hover { transform: scale(1.1); }
  .theme-preset-btn {
    display: flex; align-items: center; gap-8px; padding: 8px 14px;
    border-radius: 10px; border: 2px solid transparent; cursor: pointer;
    font-size: 12px; font-weight: 500; transition: all 0.15s;
  }
  .theme-preset-btn:hover { border-color: var(--accent); }
  .theme-preset-btn.selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(99,102,241,0.2); }
</style>
</head>
<body class="bg-slate-50 min-h-screen">

<!-- 사이드바 -->
<div class="fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-indigo-900 to-indigo-800 text-white z-50 flex flex-col">
  <div class="px-5 py-4 border-b border-white/10">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
        <i class="fas fa-chart-line text-white text-sm"></i>
      </div>
      <div class="min-w-0">
        <div class="text-sm font-bold text-white leading-tight tracking-wide">링고 고객센터</div>
        <div class="text-xs text-indigo-200 font-medium mt-0.5">관리자 평가 시스템</div>
      </div>
    </div>
  </div>
  <nav class="flex-1 p-4 space-y-1">
    <button onclick="showPage('dashboard')" class="nav-item active w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="dashboard">
      <i class="fas fa-tachometer-alt w-4"></i> 대시보드
    </button>
    <button onclick="showPage('evaluation')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="evaluation">
      <i class="fas fa-clipboard-check w-4"></i> 평가 입력
    </button>
    <button onclick="showPage('report')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="report">
      <i class="fas fa-file-alt w-4"></i> 개인 보고서
    </button>
    <div class="pt-4 pb-1">
      <div class="flex items-center gap-2 px-3">
        <div class="flex-1 h-px bg-white/10"></div>
        <span class="text-xs font-semibold text-white/50 tracking-widest uppercase">관리</span>
        <div class="flex-1 h-px bg-white/10"></div>
      </div>
    </div>
    <button onclick="showPage('managers')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="managers">
      <i class="fas fa-users w-4"></i> 관리자 관리
    </button>
    <button onclick="showPage('items')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="items">
      <i class="fas fa-list-check w-4"></i> 평가 항목 관리
    </button>
    <button onclick="showPage('periods')" class="nav-item w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-left" data-page="periods">
      <i class="fas fa-calendar w-4"></i> 평가 기간 관리
    </button>
  </nav>
  <!-- 하단 현재 기간 표시 -->
  <div class="px-4 py-3 border-t border-white/10 bg-white/5">
    <div class="flex items-center gap-2">
      <div class="w-6 h-6 rounded-md bg-white/15 flex items-center justify-center flex-shrink-0">
        <i class="fas fa-calendar-check text-white/80 text-xs"></i>
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-xs text-white/50 leading-tight">현재 평가 기간</div>
        <div id="period-selector" class="text-xs font-semibold text-white truncate mt-0.5"></div>
      </div>
      <a href="/colors" target="_blank" title="색상 설정"
        class="w-6 h-6 rounded-md bg-white/10 hover:bg-white/25 flex items-center justify-center transition flex-shrink-0">
        <i class="fas fa-palette text-white/60 text-xs"></i>
      </a>
    </div>
  </div>
</div>

<!-- 메인 콘텐츠 -->
<div class="ml-64 min-h-screen">
  <!-- 헤더 -->
  <header class="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-40">
    <div>
      <h1 id="page-title" class="text-lg font-bold text-slate-800">대시보드</h1>
      <p id="page-sub" class="text-xs text-slate-500">전체 평가 현황을 한눈에 확인하세요</p>
    </div>
    <div class="flex items-center gap-3">
      <!-- 반영완료 배지 (반영완료 기간 선택 시 표시) -->
      <span id="confirmed-badge" class="hidden items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
        <i class="fas fa-check-circle text-xs"></i> 반영완료
      </span>
      <!-- 임시 배지 (임시 기간 선택 시 표시) -->
      <span id="draft-badge" class="hidden items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-700">
        <i class="fas fa-clock text-xs"></i> 임시
      </span>
      <select id="global-period" onchange="onPeriodChange()" class="text-sm border border-slate-200 rounded-lg px-3 py-1.5 bg-white focus:outline-none focus:border-indigo-400">
      </select>
      <button onclick="showAddPeriodModal()" class="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-lg hover:bg-indigo-700 transition">
        <i class="fas fa-plus mr-1"></i>기간 추가
      </button>
    </div>
  </header>

  <!-- 페이지들 -->
  <div class="p-6">
    <!-- 대시보드 페이지 -->
    <div id="page-dashboard" class="page-content">
      <!-- 요약 카드 -->
      <div id="summary-cards" class="grid grid-cols-4 gap-4 mb-6"></div>
      
      <!-- 차트 탭 -->
      <div class="card p-5 mb-6">
        <div class="flex items-center gap-4 mb-4 border-b border-slate-100 pb-3">
          <button class="tab-btn active px-3 py-2 text-sm" onclick="switchChartTab('overview')" data-tab="overview">전체 현황</button>
          <button class="tab-btn px-3 py-2 text-sm" onclick="switchChartTab('position')" data-tab="position">보직별</button>
          <button class="tab-btn px-3 py-2 text-sm" onclick="switchChartTab('manager')" data-tab="manager">관리자별</button>
          <button class="tab-btn px-3 py-2 text-sm" onclick="switchChartTab('category')" data-tab="category">업무별</button>
        </div>
        <div id="chart-overview" class="chart-tab">
          <div class="grid grid-cols-2 gap-6">
            <div class="chart-container" style="height:300px">
              <canvas id="chart-total-bar"></canvas>
            </div>
            <div class="chart-container" style="height:300px">
              <canvas id="chart-radar-avg"></canvas>
            </div>
          </div>
        </div>
        <div id="chart-position" class="chart-tab hidden">
          <div class="grid grid-cols-2 gap-6">
            <div class="chart-container" style="height:300px">
              <canvas id="chart-position-bar"></canvas>
            </div>
            <div class="chart-container" style="height:300px">
              <canvas id="chart-position-doughnut"></canvas>
            </div>
          </div>
        </div>
        <div id="chart-manager" class="chart-tab hidden">
          <div class="chart-container" style="height:350px">
            <canvas id="chart-manager-grouped"></canvas>
          </div>
        </div>
        <div id="chart-category" class="chart-tab hidden">
          <div class="grid grid-cols-2 gap-6">
            <div class="chart-container" style="height:320px">
              <canvas id="chart-category-heatmap"></canvas>
            </div>
            <div class="chart-container" style="height:320px">
              <canvas id="chart-category-polar"></canvas>
            </div>
          </div>
        </div>
      </div>

      <!-- 관리자 랭킹 테이블 -->
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
          <i class="fas fa-trophy text-yellow-500"></i> 관리자별 종합 평가
        </h3>
        <div id="ranking-table"></div>
      </div>
    </div>

    <!-- 평가 입력 페이지 -->
    <div id="page-evaluation" class="page-content hidden">
      <div class="flex gap-4 mb-5">
        <div class="card p-4 flex-1">
          <label class="text-xs text-slate-500 mb-1 block">평가 대상자</label>
          <select id="eval-manager" onchange="loadEvalForm()" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"></select>
        </div>
        <div class="card p-4 w-48">
          <label class="text-xs text-slate-500 mb-1 block">평가자</label>
          <input id="eval-evaluator" type="text" placeholder="평가자 이름" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
        </div>
      </div>
      <div id="eval-form-container"></div>
      <div id="eval-submit-area" class="hidden mt-4 flex justify-end">
        <button onclick="submitEvaluation()" class="bg-indigo-600 text-white px-6 py-2.5 rounded-lg hover:bg-indigo-700 font-medium text-sm transition">
          <i class="fas fa-save mr-2"></i>평가 저장
        </button>
      </div>
    </div>

    <!-- 개인 보고서 페이지 -->
    <div id="page-report" class="page-content hidden">
      <div class="flex gap-4 mb-5">
        <div class="card p-4 w-64">
          <label class="text-xs text-slate-500 mb-1 block">관리자 선택</label>
          <select id="report-manager" onchange="loadReport()" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"></select>
        </div>
        <div class="flex items-end">
          <button onclick="printReport()" class="bg-slate-600 text-white px-4 py-2 rounded-lg hover:bg-slate-700 text-sm transition">
            <i class="fas fa-print mr-2"></i>출력
          </button>
        </div>
      </div>
      <div id="report-container"></div>
    </div>

    <!-- 관리자 관리 페이지 -->
    <div id="page-managers" class="page-content hidden">
      <div class="flex justify-between items-center mb-5">
        <h2 class="text-sm font-semibold text-slate-600">총 <span id="manager-count">0</span>명 등록</h2>
        <button onclick="showManagerModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm transition">
          <i class="fas fa-plus mr-2"></i>관리자 추가
        </button>
      </div>
      <div id="manager-list" class="grid grid-cols-3 gap-4"></div>
    </div>

    <!-- 평가 항목 관리 페이지 -->
    <div id="page-items" class="page-content hidden">
      <div class="flex justify-between items-center mb-5">
        <div class="flex gap-3 items-center">
          <span class="text-sm text-slate-600">직책 필터:</span>
          <select id="items-position-filter" onchange="loadItemsPage()" class="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-indigo-400">
            <option value="">전체</option>
          </select>
        </div>
        <div class="flex gap-2">
          <button onclick="showHistoryModal()" class="flex items-center gap-1.5 border border-slate-300 text-slate-600 px-3 py-2 rounded-lg hover:bg-slate-50 text-sm transition">
            <i class="fas fa-history text-slate-400"></i>변경이력
          </button>
          <button onclick="showScoreCheckModal()" class="flex items-center gap-1.5 border border-amber-300 text-amber-700 px-3 py-2 rounded-lg hover:bg-amber-50 text-sm transition">
            <i class="fas fa-calculator text-amber-400"></i>배점확인
          </button>
          <button onclick="showItemModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm transition">
            <i class="fas fa-plus mr-2"></i>항목 추가
          </button>
        </div>
      </div>
      <div id="items-list"></div>
    </div>

    <!-- 평가 기간 관리 페이지 -->
    <div id="page-periods" class="page-content hidden">
      <div class="flex justify-between items-center mb-5">
        <p class="text-sm text-slate-500">반영완료된 기간은 대시보드의 기본 표시 기간으로 우선 선택됩니다.</p>
      </div>
      <div id="periods-list" class="grid grid-cols-3 gap-4"></div>
    </div>

    <!-- 색상 설정 페이지 -->
    <div id="page-colors" class="page-content hidden">

      <!-- UI 테마 섹션 -->
      <div class="card p-6 mb-6">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
            <i class="fas fa-desktop text-indigo-600 text-sm"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800">UI 테마 색상</h3>
            <p class="text-xs text-slate-500">사이드바·강조색·등급색을 변경합니다</p>
          </div>
          <button onclick="resetTheme()" class="ml-auto text-xs text-slate-400 hover:text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 transition">
            <i class="fas fa-undo mr-1"></i>초기화
          </button>
        </div>

        <!-- 테마 프리셋 -->
        <div class="mb-5">
          <p class="text-xs font-medium text-slate-600 mb-3">빠른 프리셋</p>
          <div class="flex gap-3 flex-wrap" id="theme-presets"></div>
        </div>

        <div class="grid grid-cols-2 gap-6">
          <!-- 사이드바 색상 -->
          <div>
            <p class="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
              <i class="fas fa-sidebar text-slate-400"></i> 사이드바
            </p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">상단 색상</span>
                <div class="flex items-center gap-2">
                  <div id="prev-sidebar-from" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-sidebar-from" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">하단 색상</span>
                <div class="flex items-center gap-2">
                  <div id="prev-sidebar-to" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-sidebar-to" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">테두리/서브텍스트</span>
                <div class="flex items-center gap-2">
                  <div id="prev-sidebar-border" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-sidebar-border" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
            </div>
          </div>

          <!-- 강조색 -->
          <div>
            <p class="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
              <i class="fas fa-star text-slate-400"></i> 강조색 (버튼·포커스·탭)
            </p>
            <div class="space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">기본 강조색</span>
                <div class="flex items-center gap-2">
                  <div id="prev-accent" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-accent" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">배경색 (body)</span>
                <div class="flex items-center gap-2">
                  <div id="prev-bg" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-bg" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
              <div class="flex items-center justify-between">
                <span class="text-xs text-slate-500">카드 배경</span>
                <div class="flex items-center gap-2">
                  <div id="prev-card" class="w-5 h-5 rounded border border-slate-200"></div>
                  <input type="color" id="theme-card" class="color-picker-inline" oninput="previewTheme()">
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 등급 색상 -->
        <div class="mt-5 pt-5 border-t border-slate-100">
          <p class="text-xs font-semibold text-slate-600 mb-3 flex items-center gap-1.5">
            <i class="fas fa-award text-slate-400"></i> 등급 색상
          </p>
          <div class="grid grid-cols-5 gap-3" id="grade-color-row"></div>
        </div>

        <div class="mt-5 flex justify-end">
          <button onclick="saveTheme()" class="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-indigo-700 transition font-medium">
            <i class="fas fa-save mr-2"></i>테마 저장 적용
          </button>
        </div>
      </div>

      <!-- 직책 색상 섹션 -->
      <div class="card p-6 mb-6">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
            <i class="fas fa-id-badge text-purple-600 text-sm"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800">직책 색상</h3>
            <p class="text-xs text-slate-500">보직별 구분 색상 — 차트·배지·보고서에 반영됩니다</p>
          </div>
        </div>
        <div id="position-color-list" class="grid grid-cols-2 gap-4"></div>
      </div>

      <!-- 평가 영역 색상 섹션 -->
      <div class="card p-6">
        <div class="flex items-center gap-3 mb-5">
          <div class="w-8 h-8 rounded-lg bg-sky-100 flex items-center justify-center">
            <i class="fas fa-layer-group text-sky-600 text-sm"></i>
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-800">평가 영역 색상</h3>
            <p class="text-xs text-slate-500">업무 영역별 구분 색상 — 차트·프로그레스·레이더에 반영됩니다</p>
          </div>
        </div>
        <div id="category-color-list" class="grid grid-cols-2 gap-4"></div>
    </div>

  </div>
</div>
<div id="modal-manager" class="modal">
  <div class="bg-white rounded-xl w-96 p-6 mx-4">
    <h3 class="text-base font-bold text-slate-800 mb-4" id="modal-manager-title">관리자 추가</h3>
    <div class="space-y-3">
      <div>
        <label class="text-xs text-slate-500 mb-1 block">이름</label>
        <input id="mgr-name" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" placeholder="이름 입력">
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">직책</label>
        <select id="mgr-position" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"></select>
      </div>
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="saveManager()" class="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm hover:bg-indigo-700 transition">저장</button>
      <button onclick="closeModal('modal-manager')" class="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-200 transition">취소</button>
    </div>
  </div>
</div>

<!-- 평가 항목 추가/수정 모달 -->
<div id="modal-item" class="modal">
  <div class="bg-white rounded-xl w-[500px] p-6 mx-4">
    <h3 class="text-base font-bold text-slate-800 mb-4" id="modal-item-title">평가 항목 추가</h3>
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-slate-500 mb-1 block">평가 영역</label>
          <select id="item-category" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"></select>
        </div>
        <div>
          <label class="text-xs text-slate-500 mb-1 block">직책 (비어있으면 공통)</label>
          <select id="item-position" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
            <option value="">공통 (전체 직책)</option>
          </select>
        </div>
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">항목명</label>
        <input id="item-name" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" placeholder="평가 항목명">
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">평가 기준</label>
        <textarea id="item-criteria" rows="2" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 resize-none" placeholder="평가 기준 설명"></textarea>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-slate-500 mb-1 block">배점</label>
          <input id="item-max-score" type="number" min="1" max="50" value="5" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
        </div>
        <div>
          <label class="text-xs text-slate-500 mb-1 block">순서</label>
          <input id="item-sort" type="number" min="1" value="99" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
        </div>
      </div>
      <div>
        <label class="text-xs text-slate-500 mb-1 block">변경 사유 <span class="text-slate-400">(선택)</span></label>
        <input id="item-reason" type="text" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" placeholder="예: 업무 범위 확대로 항목 추가">
      </div>
    </div>
    <input type="hidden" id="item-edit-id">
    <div class="flex gap-2 mt-5">
      <button onclick="saveItem()" class="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm hover:bg-indigo-700 transition">저장</button>
      <button onclick="closeModal('modal-item')" class="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-200 transition">취소</button>
    </div>
  </div>
</div>

<!-- 변경이력 모달 -->
<div id="modal-history" class="modal">
  <div class="bg-white rounded-xl w-[780px] max-h-[85vh] flex flex-col mx-4">
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
      <div>
        <h3 class="text-base font-bold text-slate-800">평가 항목 변경이력</h3>
        <p class="text-xs text-slate-400 mt-0.5">추가·수정·삭제된 항목의 전체 이력</p>
      </div>
      <button onclick="closeModal('modal-history')" class="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="overflow-y-auto flex-1 p-6">
      <div id="history-content">
        <div class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
    </div>
  </div>
</div>

<!-- 배점확인 모달 -->
<div id="modal-score-check" class="modal">
  <div class="bg-white rounded-xl w-[640px] max-h-[85vh] flex flex-col mx-4">
    <div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
      <div>
        <h3 class="text-base font-bold text-slate-800">배점 확인</h3>
        <p class="text-xs text-slate-400 mt-0.5">직책별 현재 활성 항목의 총 배점 현황</p>
      </div>
      <button onclick="closeModal('modal-score-check')" class="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="overflow-y-auto flex-1 p-6">
      <div id="score-check-content">
        <div class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin"></i></div>
      </div>
    </div>
  </div>
</div>

<!-- 기간 추가 모달 -->
<div id="modal-period" class="modal">
  <div class="bg-white rounded-xl w-80 p-6 mx-4">
    <h3 class="text-base font-bold text-slate-800 mb-4">평가 기간 추가</h3>
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="text-xs text-slate-500 mb-1 block">연도</label>
          <input id="period-year" type="number" value="2026" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
        </div>
        <div>
          <label class="text-xs text-slate-500 mb-1 block">월</label>
          <input id="period-month" type="number" min="1" max="12" value="7" class="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400">
        </div>
      </div>
    </div>
    <div class="flex gap-2 mt-5">
      <button onclick="savePeriod()" class="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm hover:bg-indigo-700 transition">추가</button>
      <button onclick="closeModal('modal-period')" class="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-200 transition">취소</button>
    </div>
  </div>
</div>

<!-- Toast -->
<div id="toast" class="fixed bottom-6 right-6 z-50 hidden">
  <div class="bg-slate-800 text-white px-4 py-3 rounded-lg text-sm shadow-lg flex items-center gap-2">
    <i id="toast-icon" class="fas fa-check-circle text-green-400"></i>
    <span id="toast-msg"></span>
  </div>
</div>

<script>
// ============================================================
// 전역 상태
// ============================================================
let state = {
  currentPage: 'dashboard',
  currentPeriodId: null,
  periods: [],
  managers: [],
  positions: [],
  categories: [],
  editingManagerId: null,
  editingItemId: null,
  charts: {},
  theme: null        // 로드된 테마 객체
}

// ============================================================
// 초기화
// ============================================================
async function init() {
  applyStoredTheme()          // ① 저장된 테마 먼저 적용
  await Promise.all([
    loadPeriods(),
    loadManagers(),
    loadPositions(),
    loadCategories()
  ])
  showPage('dashboard')
}

// ============================================================
// API 헬퍼
// ============================================================
async function api(path, opts = {}) {
  try {
    const r = await fetch('/api' + path, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    })
    return await r.json()
  } catch(e) {
    showToast('오류: ' + e.message, true)
    return null
  }
}

// ============================================================
// 데이터 로드
// ============================================================
async function loadPeriods() {
  const data = await api('/periods')
  state.periods = data || []
  renderPeriodSelect()
}
async function loadManagers() {
  const data = await api('/managers')
  state.managers = data || []
}
async function loadPositions() {
  const data = await api('/positions')
  state.positions = data || []
}
async function loadCategories() {
  const data = await api('/categories')
  state.categories = data || []
}

function renderPeriodSelect() {
  const sel = document.getElementById('global-period')
  sel.innerHTML = state.periods.map(p =>
    \`<option value="\${p.id}">\${p.label}\${p.is_confirmed ? ' ✓' : ' (임시)'}</option>\`
  ).join('')
  if (state.periods.length > 0) {
    // 반영완료 기간 중 가장 최근 → 없으면 첫 번째
    const confirmed = state.periods.find(p => p.is_confirmed)
    const defaultPeriod = confirmed || state.periods[0]
    state.currentPeriodId = defaultPeriod.id
    sel.value = state.currentPeriodId
    updatePeriodBadge(defaultPeriod)
  }
  const sideLabel = document.getElementById('period-selector')
  const defaultP = state.periods.find(p => p.id == state.currentPeriodId)
  if (sideLabel && defaultP) sideLabel.textContent = defaultP.label
}

function updatePeriodBadge(period) {
  const confirmedBadge = document.getElementById('confirmed-badge')
  const draftBadge = document.getElementById('draft-badge')
  if (!confirmedBadge || !draftBadge) return
  if (period && period.is_confirmed) {
    confirmedBadge.classList.remove('hidden')
    confirmedBadge.classList.add('flex')
    draftBadge.classList.add('hidden')
    draftBadge.classList.remove('flex')
  } else {
    draftBadge.classList.remove('hidden')
    draftBadge.classList.add('flex')
    confirmedBadge.classList.add('hidden')
    confirmedBadge.classList.remove('flex')
  }
}

function onPeriodChange() {
  state.currentPeriodId = document.getElementById('global-period').value
  const period = state.periods.find(p => p.id == state.currentPeriodId)
  if (period) {
    const sideLabel = document.getElementById('period-selector')
    if (sideLabel) sideLabel.textContent = period.label
    updatePeriodBadge(period)
  }
  if (state.currentPage === 'dashboard') loadDashboard()
  if (state.currentPage === 'evaluation') loadEvalForm()
  if (state.currentPage === 'report') loadReport()
}

// ============================================================
// 페이지 전환
// ============================================================
function showPage(page) {
  document.querySelectorAll('.page-content').forEach(el => el.classList.add('hidden'))
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'))
  
  document.getElementById('page-' + page)?.classList.remove('hidden')
  document.querySelector(\`[data-page="\${page}"]\`)?.classList.add('active')
  state.currentPage = page
  
  const titles = {
    dashboard: ['대시보드', '전체 평가 현황을 한눈에 확인하세요'],
    evaluation: ['평가 입력', '관리자별 평가 점수를 입력하세요'],
    report: ['개인 보고서', '관리자별 상세 평가 결과를 확인하세요'],
    managers: ['관리자 관리', '관리자 추가·수정·삭제'],
    items: ['평가 항목 관리', '직책별 평가 항목을 설정하세요'],
    periods: ['평가 기간 관리', '월별 평가 기간을 관리하세요'],
    colors: ['색상 설정', '직책·평가영역·UI 테마 색상을 자유롭게 바꾸세요']
  }
  const [title, sub] = titles[page] || ['', '']
  document.getElementById('page-title').textContent = title
  document.getElementById('page-sub').textContent = sub

  if (page === 'dashboard') loadDashboard()
  else if (page === 'evaluation') loadEvaluationPage()
  else if (page === 'report') loadReportPage()
  else if (page === 'managers') loadManagersPage()
  else if (page === 'items') loadItemsPage()
  else if (page === 'periods') loadPeriodsPage()
  else if (page === 'colors') loadColorsPage()
}

// ============================================================
// 대시보드
// ============================================================
async function loadDashboard() {
  if (!state.currentPeriodId) return
  const data = await api('/dashboard?period_id=' + state.currentPeriodId)
  if (!data) return

  // API가 반환한 실제 period_id로 셀렉트 동기화 (초기 로드 시 자동 선택된 기간 반영)
  if (data.periodId && data.periodId != state.currentPeriodId) {
    state.currentPeriodId = data.periodId
    const sel = document.getElementById('global-period')
    if (sel) sel.value = data.periodId
    const period = state.periods.find(p => p.id === data.periodId)
    if (period) {
      const sideLabel = document.getElementById('period-selector')
      if (sideLabel) sideLabel.textContent = period.label
      updatePeriodBadge(period)
    }
  }

  renderSummaryCards(data.summary)
  renderAllCharts(data)
  renderRankingTable(data.summary)
}

function getGrade(score) {
  if (score >= 90) return { grade: 'S', label: '탁월함', cls: 'grade-S' }
  if (score >= 80) return { grade: 'A', label: '우수함', cls: 'grade-A' }
  if (score >= 70) return { grade: 'B', label: '양호함', cls: 'grade-B' }
  if (score >= 60) return { grade: 'C', label: '보통', cls: 'grade-C' }
  return { grade: 'D', label: '개선필요', cls: 'grade-D' }
}

function renderSummaryCards(summary) {
  const container = document.getElementById('summary-cards')
  if (!summary || !summary.length) { container.innerHTML = '<div class="col-span-4 text-center text-slate-400 py-8">데이터 없음</div>'; return }
  
  const total = summary.length
  const avgScore = (summary.reduce((s, m) => s + (m.total_score || 0), 0) / total).toFixed(1)
  const topScore = Math.max(...summary.map(m => m.total_score || 0))
  const topManager = summary.find(m => m.total_score === topScore)
  const gradeCount = { S:0, A:0, B:0, C:0, D:0 }
  summary.forEach(m => { const g = getGrade(m.total_score || 0); gradeCount[g.grade]++ })
  
  container.innerHTML = \`
    <div class="card p-5">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center">
          <i class="fas fa-users text-indigo-600"></i>
        </div>
        <div>
          <div class="text-2xl font-bold text-slate-800">\${total}명</div>
          <div class="text-xs text-slate-500">총 평가 인원</div>
        </div>
      </div>
      <div class="flex gap-1">
        \${Object.entries(gradeCount).map(([g,c]) => c > 0 ? \`<span class="text-xs px-1.5 py-0.5 rounded grade-\${g}">\${g}:\${c}</span>\` : '').join('')}
      </div>
    </div>
    <div class="card p-5">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
          <i class="fas fa-chart-bar text-emerald-600"></i>
        </div>
        <div>
          <div class="text-2xl font-bold text-slate-800">\${avgScore}점</div>
          <div class="text-xs text-slate-500">전체 평균 점수</div>
        </div>
      </div>
      <div class="progress-bar">
        <div class="progress-fill bg-emerald-400" style="width:\${avgScore}%"></div>
      </div>
    </div>
    <div class="card p-5">
      <div class="flex items-center gap-3 mb-2">
        <div class="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center">
          <i class="fas fa-trophy text-yellow-600"></i>
        </div>
        <div>
          <div class="text-lg font-bold text-slate-800">\${topManager?.manager_name || '-'}</div>
          <div class="text-xs text-slate-500">최고 득점자</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-2xl font-bold text-yellow-500">\${topScore}점</span>
        <span class="text-xs px-2 py-0.5 rounded \${getGrade(topScore).cls}">\${getGrade(topScore).grade}</span>
      </div>
    </div>
    <div class="card p-5">
      <div class="flex items-center gap-3 mb-3">
        <div class="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
          <i class="fas fa-award text-blue-600"></i>
        </div>
        <div>
          <div class="text-xs text-slate-500 mb-1">등급 분포</div>
        </div>
      </div>
      <div class="flex gap-1.5 flex-wrap">
        \${Object.entries(gradeCount).map(([g,c]) => \`
          <div class="flex flex-col items-center">
            <div class="text-sm font-bold \${c > 0 ? 'text-slate-700' : 'text-slate-300'}">\${c}</div>
            <div class="text-xs px-2 py-0.5 rounded grade-\${g} opacity-\${c > 0 ? '100' : '40'}">\${g}</div>
          </div>
        \`).join('')}
      </div>
    </div>
  \`
}

function renderAllCharts(data) {
  // 기존 차트 제거
  Object.values(state.charts).forEach(c => c && c.destroy && c.destroy())
  state.charts = {}
  
  const { summary, byCategory, byPosition, managerCategory } = data
  if (!summary || !summary.length) return

  // 1. 전체 현황 - 관리자별 총점 바 차트
  const sortedSummary = [...summary].sort((a,b) => (b.total_score||0) - (a.total_score||0))
  const ctx1 = document.getElementById('chart-total-bar').getContext('2d')
  state.charts.totalBar = new Chart(ctx1, {
    type: 'bar',
    data: {
      labels: sortedSummary.map(m => m.manager_name),
      datasets: [{
        label: '총점',
        data: sortedSummary.map(m => m.total_score || 0),
        backgroundColor: sortedSummary.map(m => m.position_color + 'cc'),
        borderColor: sortedSummary.map(m => m.position_color),
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000, easing: 'easeOutBounce' },
      plugins: {
        legend: { display: false },
        title: { display: true, text: '관리자별 총점', font: { size: 13 }, color: '#374151' },
        datalabels: { anchor: 'end', align: 'top', font: { size: 11, weight: 'bold' }, color: '#374151' }
      },
      scales: {
        y: { beginAtZero: true, max: 100, grid: { color: '#f1f5f9' },
             ticks: { callback: v => v + '점' } },
        x: { grid: { display: false } }
      }
    },
    plugins: [ChartDataLabels]
  })

  // 2. 레이더 차트 - 영역별 평균
  const radarLabels = (byCategory || []).map(c => c.category_name)
  const radarData = (byCategory || []).map(c => c.avg_score || 0)
  const radarMax = (byCategory || []).map(c => c.category_max || 25)
  const radarPct = radarData.map((v,i) => radarMax[i] ? ((v/radarMax[i])*100).toFixed(1) : 0)
  
  const ctx2 = document.getElementById('chart-radar-avg').getContext('2d')
  state.charts.radarAvg = new Chart(ctx2, {
    type: 'radar',
    data: {
      labels: radarLabels,
      datasets: [{
        label: '전체 평균 달성률(%)',
        data: radarPct,
        backgroundColor: 'rgba(99,102,241,0.15)',
        borderColor: '#6366f1',
        borderWidth: 2,
        pointBackgroundColor: '#6366f1',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1200 },
      plugins: {
        title: { display: true, text: '영역별 평균 달성률', font: { size: 13 }, color: '#374151' },
        datalabels: { display: false }
      },
      scales: {
        r: { min: 0, max: 100, ticks: { stepSize: 20, callback: v => v + '%' },
             pointLabels: { font: { size: 11 } } }
      }
    },
    plugins: [ChartDataLabels]
  })

  // 3. 보직별 바 차트
  const posData = (byPosition || []).filter(p => p.member_count > 0)
  const ctx3 = document.getElementById('chart-position-bar').getContext('2d')
  state.charts.posBar = new Chart(ctx3, {
    type: 'bar',
    data: {
      labels: posData.map(p => p.position_name),
      datasets: [{
        label: '평균 점수',
        data: posData.map(p => p.avg_score || 0),
        backgroundColor: posData.map(p => p.color + 'cc'),
        borderColor: posData.map(p => p.color),
        borderWidth: 1.5,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000 },
      plugins: {
        legend: { display: false },
        title: { display: true, text: '보직별 평균 점수', font: { size: 13 }, color: '#374151' },
        datalabels: { anchor: 'end', align: 'top', font: { size: 11, weight: 'bold' }, color: '#374151', formatter: v => v + '점' }
      },
      scales: { y: { beginAtZero: true, max: 100 }, x: { grid: { display: false } } }
    },
    plugins: [ChartDataLabels]
  })

  // 4. 보직별 도넛
  const ctx4 = document.getElementById('chart-position-doughnut').getContext('2d')
  state.charts.posDoughnut = new Chart(ctx4, {
    type: 'doughnut',
    data: {
      labels: posData.map(p => p.position_name + ' (' + p.member_count + '명)'),
      datasets: [{
        data: posData.map(p => p.member_count),
        backgroundColor: posData.map(p => p.color + 'cc'),
        borderColor: posData.map(p => p.color),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1200 },
      plugins: {
        title: { display: true, text: '보직별 인원 분포', font: { size: 13 }, color: '#374151' },
        legend: { position: 'bottom', labels: { font: { size: 11 } } },
        datalabels: { color: 'white', font: { weight: 'bold', size: 12 }, formatter: v => v + '명' }
      }
    },
    plugins: [ChartDataLabels]
  })

  // 5. 관리자별 영역 grouped bar
  const categoryColors = (byCategory || []).map(c => c.color)
  const managers = [...new Set((managerCategory || []).map(d => d.manager_name))]
  const categories = [...new Set((managerCategory || []).map(d => d.category_name))]
  
  const ctx5 = document.getElementById('chart-manager-grouped').getContext('2d')
  state.charts.managerGrouped = new Chart(ctx5, {
    type: 'bar',
    data: {
      labels: managers,
      datasets: categories.map((cat, idx) => {
        const catData = managerCategory.filter(d => d.category_name === cat)
        return {
          label: cat,
          data: managers.map(mgr => {
            const d = catData.find(x => x.manager_name === mgr)
            if (!d) return 0
            return d.category_max > 0 ? ((d.cat_score / d.category_max) * 100).toFixed(1) : 0
          }),
          backgroundColor: (categoryColors[idx] || '#6366f1') + 'cc',
          borderColor: categoryColors[idx] || '#6366f1',
          borderWidth: 1,
          borderRadius: 4
        }
      })
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1100 },
      plugins: {
        title: { display: true, text: '관리자별 영역 달성률(%)', font: { size: 13 }, color: '#374151' },
        legend: { position: 'top', labels: { font: { size: 11 }, boxWidth: 12 } },
        datalabels: { display: false }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
      }
    },
    plugins: [ChartDataLabels]
  })

  // 6. 업무별 히트맵 (bar chart 형식)
  const ctx6 = document.getElementById('chart-category-heatmap').getContext('2d')
  const catColors = (byCategory || []).map(c => c.color)
  state.charts.catHeatmap = new Chart(ctx6, {
    type: 'bar',
    data: {
      labels: (byCategory || []).map(c => c.category_name),
      datasets: managers.map((mgr, mi) => {
        return {
          label: mgr,
          data: (byCategory || []).map(cat => {
            const d = (managerCategory || []).find(x => x.manager_name === mgr && x.category_name === cat.category_name)
            if (!d) return 0
            return d.category_max > 0 ? ((d.cat_score / d.category_max) * 100).toFixed(1) : 0
          }),
          backgroundColor: (summary.find(s => s.manager_name === mgr)?.position_color || '#6366f1') + 'aa',
          borderRadius: 3
        }
      })
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 1000 },
      plugins: {
        title: { display: true, text: '업무영역별 관리자 달성률', font: { size: 13 }, color: '#374151' },
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } },
        datalabels: { display: false }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, max: 100, ticks: { callback: v => v + '%' } }
      }
    },
    plugins: [ChartDataLabels]
  })

  // 7. Polar Area - 영역별 평균
  const ctx7 = document.getElementById('chart-category-polar').getContext('2d')
  state.charts.catPolar = new Chart(ctx7, {
    type: 'polarArea',
    data: {
      labels: (byCategory || []).map(c => c.category_name),
      datasets: [{
        data: (byCategory || []).map(c => c.avg_score || 0),
        backgroundColor: (byCategory || []).map(c => c.color + 'aa'),
        borderColor: (byCategory || []).map(c => c.color),
        borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { animateRotate: true, duration: 1300 },
      plugins: {
        title: { display: true, text: '업무 영역별 평균 득점', font: { size: 13 }, color: '#374151' },
        legend: { position: 'bottom', labels: { font: { size: 10 }, boxWidth: 10 } },
        datalabels: { display: false }
      },
      scales: { r: { ticks: { display: false } } }
    },
    plugins: [ChartDataLabels]
  })
}

function switchChartTab(tab) {
  document.querySelectorAll('.chart-tab').forEach(el => el.classList.add('hidden'))
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'))
  document.getElementById('chart-' + tab)?.classList.remove('hidden')
  document.querySelector(\`[data-tab="\${tab}"]\`)?.classList.add('active')
  // 차트 리사이즈
  setTimeout(() => {
    Object.values(state.charts).forEach(c => c && c.resize && c.resize())
  }, 50)
}

function renderRankingTable(summary) {
  if (!summary || !summary.length) return
  const sorted = [...summary].sort((a,b) => (b.total_score||0) - (a.total_score||0))
  const container = document.getElementById('ranking-table')
  container.innerHTML = \`
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-100">
          <th class="text-left py-2 px-3 text-xs font-medium text-slate-500 w-10">순위</th>
          <th class="text-left py-2 px-3 text-xs font-medium text-slate-500">이름</th>
          <th class="text-left py-2 px-3 text-xs font-medium text-slate-500">직책</th>
          <th class="text-right py-2 px-3 text-xs font-medium text-slate-500">총점</th>
          <th class="text-center py-2 px-3 text-xs font-medium text-slate-500 w-16">등급</th>
          <th class="py-2 px-3 text-xs font-medium text-slate-500 w-48">달성률</th>
        </tr>
      </thead>
      <tbody>
        \${sorted.map((m, i) => {
          const g = getGrade(m.total_score || 0)
          const pct = Math.min(100, m.total_score || 0)
          const rankIcon = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1)
          return \`
            <tr class="border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer" onclick="showManagerReport(\${m.manager_id})">
              <td class="py-3 px-3 text-center font-bold text-slate-600">\${rankIcon}</td>
              <td class="py-3 px-3 font-medium text-slate-800">\${m.manager_name}</td>
              <td class="py-3 px-3">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium" style="background:\${m.position_color}22;color:\${m.position_color}">\${m.position_name}</span>
              </td>
              <td class="py-3 px-3 text-right font-bold text-slate-800">\${m.total_score || 0}점</td>
              <td class="py-3 px-3 text-center"><span class="px-2 py-0.5 rounded text-xs font-bold \${g.cls}">\${g.grade}</span></td>
              <td class="py-3 px-3">
                <div class="flex items-center gap-2">
                  <div class="progress-bar flex-1">
                    <div class="progress-fill" style="width:\${pct}%;background:\${m.position_color}"></div>
                  </div>
                  <span class="text-xs text-slate-500 w-8 text-right">\${pct}%</span>
                </div>
              </td>
            </tr>
          \`
        }).join('')}
      </tbody>
    </table>
  \`
}

function showManagerReport(managerId) {
  showPage('report')
  document.getElementById('report-manager').value = managerId
  loadReport()
}

// ============================================================
// 평가 입력 페이지
// ============================================================
async function loadEvaluationPage() {
  const sel = document.getElementById('eval-manager')
  sel.innerHTML = \`<option value="">-- 관리자 선택 --</option>\` +
    state.managers.map(m => \`<option value="\${m.id}">\${m.name} (\${m.position_name})</option>\`).join('')
  document.getElementById('eval-form-container').innerHTML = ''
  document.getElementById('eval-submit-area').classList.add('hidden')
}

async function loadEvalForm() {
  const managerId = document.getElementById('eval-manager').value
  if (!managerId) { document.getElementById('eval-form-container').innerHTML = ''; return }
  
  const manager = state.managers.find(m => m.id == managerId)
  if (!manager) return
  
  const [items, existingResults] = await Promise.all([
    api('/items?position_id=' + manager.position_id),
    api('/results?manager_id=' + managerId + '&period_id=' + state.currentPeriodId)
  ])
  
  if (!items) return
  const resultMap = {}
  ;(existingResults || []).forEach(r => { resultMap[r.item_id] = r })
  
  // 카테고리별 그룹핑
  const byCategory = {}
  items.forEach(item => {
    if (!byCategory[item.category_id]) byCategory[item.category_id] = { name: item.category_name, color: item.category_color, items: [] }
    byCategory[item.category_id].items.push(item)
  })
  
  const html = Object.entries(byCategory).map(([catId, cat]) => {
    const catTotal = cat.items.reduce((s, i) => s + i.max_score, 0)
    return \`
      <div class="card p-5 mb-4">
        <div class="flex items-center gap-2 mb-4">
          <div class="w-3 h-3 rounded-full" style="background:\${cat.color}"></div>
          <h3 class="text-sm font-semibold text-slate-700">\${cat.name}</h3>
          <span class="text-xs text-slate-400">(\${catTotal}점 만점)</span>
        </div>
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-100 text-xs text-slate-500">
              <th class="text-left py-2 px-2">평가 항목</th>
              <th class="text-left py-2 px-2">평가 기준</th>
              <th class="text-center py-2 px-2 w-16">배점</th>
              <th class="text-center py-2 px-2 w-20">득점</th>
              <th class="text-left py-2 px-2 w-32">비고</th>
            </tr>
          </thead>
          <tbody>
            \${cat.items.map(item => {
              const existing = resultMap[item.id]
              return \`
                <tr class="border-b border-slate-50 hover:bg-slate-50">
                  <td class="py-2.5 px-2 font-medium text-slate-700">\${item.item_name}</td>
                  <td class="py-2.5 px-2 text-slate-500 text-xs">\${item.criteria || ''}</td>
                  <td class="py-2.5 px-2 text-center text-slate-600">\${item.max_score}</td>
                  <td class="py-2.5 px-2 text-center">
                    <input type="number" class="score-input" id="score-\${item.id}"
                      min="0" max="\${item.max_score}" value="\${existing ? existing.score : ''}"
                      placeholder="0" oninput="validateScore(this, \${item.max_score})">
                  </td>
                  <td class="py-2.5 px-2">
                    <input type="text" class="w-full text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:border-indigo-400"
                      id="note-\${item.id}" value="\${existing?.note || ''}" placeholder="비고">
                  </td>
                </tr>
              \`
            }).join('')}
          </tbody>
        </table>
      </div>
    \`
  }).join('')
  
  document.getElementById('eval-form-container').innerHTML = html
  document.getElementById('eval-submit-area').classList.remove('hidden')
}

function validateScore(input, max) {
  let v = parseInt(input.value)
  if (isNaN(v)) return
  if (v < 0) input.value = 0
  if (v > max) input.value = max
}

async function submitEvaluation() {
  const managerId = document.getElementById('eval-manager').value
  if (!managerId) { showToast('관리자를 선택하세요', true); return }
  
  const manager = state.managers.find(m => m.id == managerId)
  const items = await api('/items?position_id=' + manager.position_id)
  if (!items) return
  
  const scores = items.map(item => {
    const scoreEl = document.getElementById('score-' + item.id)
    const noteEl = document.getElementById('note-' + item.id)
    return {
      item_id: item.id,
      score: parseInt(scoreEl?.value) || 0,
      note: noteEl?.value || ''
    }
  })
  
  await api('/results/batch', {
    method: 'POST',
    body: JSON.stringify({ manager_id: managerId, period_id: state.currentPeriodId, scores })
  })
  showToast('평가가 저장되었습니다 ✓')
}

// ============================================================
// 개인 보고서 페이지
// ============================================================
async function loadReportPage() {
  const sel = document.getElementById('report-manager')
  sel.innerHTML = \`<option value="">-- 관리자 선택 --</option>\` +
    state.managers.map(m => \`<option value="\${m.id}">\${m.name} (\${m.position_name})</option>\`).join('')
  document.getElementById('report-container').innerHTML = ''
}

async function loadReport() {
  const managerId = document.getElementById('report-manager').value
  if (!managerId) { document.getElementById('report-container').innerHTML = ''; return }
  
  const manager = state.managers.find(m => m.id == managerId)
  const period = state.periods.find(p => p.id == state.currentPeriodId)
  const [items, results] = await Promise.all([
    api('/items?position_id=' + manager.position_id),
    api('/results?manager_id=' + managerId + '&period_id=' + state.currentPeriodId)
  ])
  
  if (!items || !results) return
  const resultMap = {}
  results.forEach(r => { resultMap[r.item_id] = r })
  
  // 카테고리별
  const byCategory = {}
  items.forEach(item => {
    if (!byCategory[item.category_id]) byCategory[item.category_id] = {
      name: item.category_name, color: item.category_color,
      maxScore: 0, score: 0, items: []
    }
    const r = resultMap[item.id]
    byCategory[item.category_id].maxScore += item.max_score
    byCategory[item.category_id].score += r ? r.score : 0
    byCategory[item.category_id].items.push({ ...item, score: r ? r.score : 0, note: r?.note || '' })
  })
  
  const totalScore = Object.values(byCategory).reduce((s, c) => s + c.score, 0)
  const totalMax = Object.values(byCategory).reduce((s, c) => s + c.maxScore, 0)
  const grade = getGrade(totalScore)
  
  const html = \`
    <div id="report-printable">
      <!-- 헤더 -->
      <div class="card p-6 mb-4">
        <div class="flex items-start justify-between mb-4">
          <div>
            <h2 class="text-xl font-bold text-slate-800">링고 서비스 고객센터 관리자 평가표</h2>
            <p class="text-sm text-slate-500 mt-1">\${period?.label || ''}</p>
          </div>
          <div class="text-right">
            <span class="text-4xl font-bold px-4 py-2 rounded-xl \${grade.cls}">\${grade.grade}</span>
          </div>
        </div>
        <div class="grid grid-cols-4 gap-4 pt-4 border-t border-slate-100">
          <div><span class="text-xs text-slate-500">성명</span><div class="font-semibold mt-1">\${manager.name}</div></div>
          <div><span class="text-xs text-slate-500">직책</span>
            <div class="mt-1"><span class="px-2 py-0.5 rounded-full text-xs font-medium" style="background:\${manager.position_color}22;color:\${manager.position_color}">\${manager.position_name}</span></div>
          </div>
          <div><span class="text-xs text-slate-500">총점</span><div class="font-bold text-xl mt-1 text-slate-800">\${totalScore} <span class="text-sm text-slate-400">/ \${totalMax}</span></div></div>
          <div><span class="text-xs text-slate-500">달성률</span><div class="font-bold text-xl mt-1 text-indigo-600">\${totalMax > 0 ? ((totalScore/totalMax)*100).toFixed(1) : 0}%</div></div>
        </div>
      </div>
      
      <!-- 영역별 요약 -->
      <div class="card p-5 mb-4">
        <h3 class="text-sm font-semibold text-slate-700 mb-3">영역별 결과</h3>
        <div class="space-y-3">
          \${Object.entries(byCategory).map(([id, cat]) => {
            const pct = cat.maxScore > 0 ? ((cat.score/cat.maxScore)*100).toFixed(1) : 0
            return \`
              <div>
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-2">
                    <div class="w-2.5 h-2.5 rounded-full" style="background:\${cat.color}"></div>
                    <span class="text-sm font-medium text-slate-700">\${cat.name}</span>
                  </div>
                  <span class="text-sm font-bold text-slate-800">\${cat.score} / \${cat.maxScore}</span>
                </div>
                <div class="progress-bar">
                  <div class="progress-fill" style="width:\${pct}%;background:\${cat.color}"></div>
                </div>
              </div>
            \`
          }).join('')}
        </div>
      </div>
      
      <!-- 세부 평가 -->
      \${Object.entries(byCategory).map(([catId, cat]) => \`
        <div class="card p-5 mb-4">
          <div class="flex items-center gap-2 mb-3">
            <div class="w-3 h-3 rounded-full" style="background:\${cat.color}"></div>
            <h3 class="text-sm font-semibold text-slate-700">\${cat.name}</h3>
            <span class="ml-auto text-sm font-bold text-slate-800">\${cat.score} / \${cat.maxScore}</span>
          </div>
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-slate-100 text-xs text-slate-500">
                <th class="text-left py-2 px-2">항목</th>
                <th class="text-left py-2 px-2">기준</th>
                <th class="text-center py-2 px-2 w-16">배점</th>
                <th class="text-center py-2 px-2 w-16">득점</th>
                <th class="text-center py-2 px-2 w-20">달성률</th>
                <th class="text-left py-2 px-2">비고</th>
              </tr>
            </thead>
            <tbody>
              \${cat.items.map(item => {
                const pct = item.max_score > 0 ? ((item.score/item.max_score)*100).toFixed(0) : 0
                const barColor = item.score >= item.max_score ? '#10b981' : item.score >= item.max_score * 0.7 ? '#6366f1' : item.score >= item.max_score * 0.5 ? '#f59e0b' : '#ef4444'
                return \`
                  <tr class="border-b border-slate-50 hover:bg-slate-50">
                    <td class="py-2.5 px-2 font-medium text-slate-700">\${item.item_name}</td>
                    <td class="py-2.5 px-2 text-xs text-slate-500">\${item.criteria || ''}</td>
                    <td class="py-2.5 px-2 text-center text-slate-600">\${item.max_score}</td>
                    <td class="py-2.5 px-2 text-center font-bold" style="color:\${barColor}">\${item.score}</td>
                    <td class="py-2.5 px-2">
                      <div class="flex items-center gap-1">
                        <div class="progress-bar flex-1"><div class="progress-fill" style="width:\${pct}%;background:\${barColor}"></div></div>
                        <span class="text-xs text-slate-500 w-8 text-right">\${pct}%</span>
                      </div>
                    </td>
                    <td class="py-2.5 px-2 text-xs text-slate-500">\${item.note || ''}</td>
                  </tr>
                \`
              }).join('')}
            </tbody>
          </table>
        </div>
      \`).join('')}
      
      <!-- 등급 판정 -->
      <div class="card p-5">
        <h3 class="text-sm font-semibold text-slate-700 mb-3">등급 판정 기준</h3>
        <div class="grid grid-cols-5 gap-2">
          \${[['S','90점 이상','탁월함','grade-S'],['A','80점 이상','우수함','grade-A'],['B','70점 이상','양호함','grade-B'],['C','60점 이상','보통','grade-C'],['D','60점 미만','개선필요','grade-D']].map(([g,range,label,cls]) => \`
            <div class="text-center p-3 rounded-lg \${cls} \${grade.grade === g ? 'ring-2 ring-offset-1 ring-slate-400' : 'opacity-60'}">
              <div class="text-xl font-bold">\${g}</div>
              <div class="text-xs mt-1">\${range}</div>
              <div class="text-xs font-medium">\${label}</div>
            </div>
          \`).join('')}
        </div>
      </div>
    </div>
  \`
  
  document.getElementById('report-container').innerHTML = html
}

function printReport() {
  window.print()
}

// ============================================================
// 관리자 관리 페이지
// ============================================================
async function loadManagersPage() {
  const container = document.getElementById('manager-list')
  document.getElementById('manager-count').textContent = state.managers.length
  
  // 보직별 그룹핑
  const byPosition = {}
  state.managers.forEach(m => {
    if (!byPosition[m.position_id]) byPosition[m.position_id] = { name: m.position_name, color: m.position_color, members: [] }
    byPosition[m.position_id].members.push(m)
  })
  
  container.innerHTML = Object.entries(byPosition).map(([posId, pos]) => \`
    <div class="card p-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-3 h-3 rounded-full" style="background:\${pos.color}"></div>
        <h3 class="text-sm font-semibold text-slate-700">\${pos.name}</h3>
        <span class="text-xs text-slate-400 ml-auto">\${pos.members.length}명</span>
      </div>
      <div class="space-y-2">
        \${pos.members.map(m => \`
          <div class="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
            <div class="flex items-center gap-2">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold" style="background:\${pos.color}">\${m.name[0]}</div>
              <span class="text-sm font-medium text-slate-700">\${m.name}</span>
            </div>
            <div class="flex gap-1">
              <button onclick="showManagerModal(\${m.id})" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 transition">
                <i class="fas fa-edit text-xs"></i>
              </button>
              <button onclick="deleteManager(\${m.id}, '\${m.name}')" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-red-100 hover:text-red-600 transition">
                <i class="fas fa-trash text-xs"></i>
              </button>
            </div>
          </div>
        \`).join('')}
      </div>
    </div>
  \`).join('')
}

function showManagerModal(id = null) {
  state.editingManagerId = id
  document.getElementById('modal-manager-title').textContent = id ? '관리자 수정' : '관리자 추가'
  
  const posSelect = document.getElementById('mgr-position')
  posSelect.innerHTML = state.positions.map(p =>
    \`<option value="\${p.id}">\${p.name}</option>\`
  ).join('')
  
  if (id) {
    const m = state.managers.find(m => m.id === id)
    document.getElementById('mgr-name').value = m.name
    posSelect.value = m.position_id
  } else {
    document.getElementById('mgr-name').value = ''
  }
  document.getElementById('modal-manager').classList.add('open')
}

async function saveManager() {
  const name = document.getElementById('mgr-name').value.trim()
  const position_id = document.getElementById('mgr-position').value
  if (!name) { showToast('이름을 입력하세요', true); return }
  
  if (state.editingManagerId) {
    const m = state.managers.find(m => m.id === state.editingManagerId)
    await api('/managers/' + state.editingManagerId, {
      method: 'PUT', body: JSON.stringify({ name, position_id, is_active: m.is_active })
    })
    showToast('수정 완료 ✓')
  } else {
    await api('/managers', { method: 'POST', body: JSON.stringify({ name, position_id }) })
    showToast('추가 완료 ✓')
  }
  closeModal('modal-manager')
  await loadManagers()
  loadManagersPage()
  // 평가 셀렉트 갱신
  loadEvaluationPage()
}

async function deleteManager(id, name) {
  if (!confirm(\`"\${name}" 관리자를 삭제하시겠습니까?\`)) return
  await api('/managers/' + id, { method: 'DELETE' })
  showToast(name + ' 삭제 완료')
  await loadManagers()
  loadManagersPage()
}

// ============================================================
// 평가 항목 관리 페이지
// ============================================================
async function loadItemsPage() {
  const filterSel = document.getElementById('items-position-filter')
  const posFilter = filterSel.value
  if (filterSel.options.length === 1) {
    filterSel.innerHTML = '<option value="">전체</option>' +
      state.positions.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('')
  }

  const url = posFilter ? '/items?position_id=' + posFilter : '/items'
  const items = await api(url)
  if (!items) return

  // 현재 선택 기간의 (year, month) — NEW 배지 기준
  const curPeriod = state.periods.find(p => p.id == state.currentPeriodId)
  const periodYM = curPeriod ? curPeriod.year * 100 + curPeriod.month : null

  // 추가시점 포맷 함수: "2026-07-13 ..." → "2026년 7월"
  function fmtAdded(dateStr) {
    if (!dateStr) return '-'
    const m = dateStr.match(/^(\d{4})-(\d{2})/)
    if (!m) return '-'
    return \`\${m[1]}년 \${parseInt(m[2])}월\`
  }

  // NEW 배지 여부: 항목 추가 월 >= 현재 선택 기간 월
  function isNew(dateStr) {
    if (!periodYM || !dateStr) return false
    const m = dateStr.match(/^(\d{4})-(\d{2})/)
    if (!m) return false
    const itemYM = parseInt(m[1]) * 100 + parseInt(m[2])
    return itemYM >= periodYM
  }

  // 카테고리별 그룹핑
  const byCategory = {}
  items.forEach(item => {
    if (!byCategory[item.category_id]) byCategory[item.category_id] = {
      name: item.category_name, color: item.category_color, items: []
    }
    byCategory[item.category_id].items.push(item)
  })

  document.getElementById('items-list').innerHTML = Object.entries(byCategory).map(([catId, cat]) => \`
    <div class="card p-5 mb-4">
      <div class="flex items-center gap-2 mb-3">
        <div class="w-3 h-3 rounded-full" style="background:\${cat.color}"></div>
        <h3 class="text-sm font-semibold text-slate-700">\${cat.name}</h3>
        <span class="text-xs text-slate-400">\${cat.items.length}개 항목</span>
      </div>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-slate-100 text-xs text-slate-500">
            <th class="text-left py-2 px-2">항목명</th>
            <th class="text-left py-2 px-2">평가 기준</th>
            <th class="text-center py-2 px-2 w-16">배점</th>
            <th class="text-center py-2 px-2 w-24">적용 직책</th>
            <th class="text-center py-2 px-2 w-28">추가 시점</th>
            <th class="text-center py-2 px-2 w-20">작업</th>
          </tr>
        </thead>
        <tbody>
          \${cat.items.map(item => \`
            <tr class="border-b border-slate-50 hover:bg-slate-50">
              <td class="py-2.5 px-2 font-medium text-slate-700">
                \${item.item_name}
                \${isNew(item.created_at)
                  ? '<span class="ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">NEW</span>'
                  : ''}
              </td>
              <td class="py-2.5 px-2 text-xs text-slate-500">\${item.criteria || ''}</td>
              <td class="py-2.5 px-2 text-center text-slate-600">\${item.max_score}</td>
              <td class="py-2.5 px-2 text-center">
                \${item.position_name
                  ? \`<span class="px-2 py-0.5 rounded-full text-xs" style="background:\${item.category_color}22;color:\${item.category_color}">\${item.position_name}</span>\`
                  : '<span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">공통</span>'}
              </td>
              <td class="py-2.5 px-2 text-center text-xs text-slate-400">\${fmtAdded(item.created_at)}</td>
              <td class="py-2.5 px-2 text-center">
                <div class="flex gap-1 justify-center">
                  <button onclick="showItemModal(\${item.id})" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 transition">
                    <i class="fas fa-edit text-xs"></i>
                  </button>
                  <button onclick="deleteItem(\${item.id}, '\${item.item_name.replace(/'/g, \"\\\\'\")}', '\${item.item_name.replace(/'/g, \"\\\\'\")}' )" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-red-100 hover:text-red-600 transition">
                    <i class="fas fa-trash text-xs"></i>
                  </button>
                </div>
              </td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    </div>
  \`).join('')
}

function showItemModal(id = null) {
  state.editingItemId = id
  document.getElementById('modal-item-title').textContent = id ? '항목 수정' : '항목 추가'
  document.getElementById('item-edit-id').value = id || ''

  const catSel = document.getElementById('item-category')
  catSel.innerHTML = state.categories.map(c => \`<option value="\${c.id}">\${c.name}</option>\`).join('')

  const posSel = document.getElementById('item-position')
  posSel.innerHTML = '<option value="">공통 (전체 직책)</option>' +
    state.positions.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('')

  // 사유 필드 초기화
  document.getElementById('item-reason').value = ''

  if (id) {
    api('/items').then(items => {
      const item = (items || []).find(i => i.id === id)
      if (item) {
        catSel.value = item.category_id
        posSel.value = item.position_id || ''
        document.getElementById('item-name').value = item.item_name
        document.getElementById('item-criteria').value = item.criteria || ''
        document.getElementById('item-max-score').value = item.max_score
        document.getElementById('item-sort').value = item.sort_order
      }
    })
  } else {
    document.getElementById('item-name').value = ''
    document.getElementById('item-criteria').value = ''
    document.getElementById('item-max-score').value = '5'
    document.getElementById('item-sort').value = '99'
  }
  document.getElementById('modal-item').classList.add('open')
}

async function saveItem() {
  const id = document.getElementById('item-edit-id').value
  const reason = document.getElementById('item-reason').value.trim() || null
  const body = {
    category_id: document.getElementById('item-category').value,
    position_id: document.getElementById('item-position').value || null,
    item_name: document.getElementById('item-name').value.trim(),
    criteria: document.getElementById('item-criteria').value,
    max_score: parseInt(document.getElementById('item-max-score').value) || 5,
    sort_order: parseInt(document.getElementById('item-sort').value) || 99,
    is_active: 1,
    reason
  }
  if (!body.item_name) { showToast('항목명을 입력하세요', true); return }

  if (id) {
    await api('/items/' + id, { method: 'PUT', body: JSON.stringify(body) })
    showToast('항목 수정 완료 ✓')
  } else {
    await api('/items', { method: 'POST', body: JSON.stringify(body) })
    showToast('항목 추가 완료 ✓')
  }
  closeModal('modal-item')
  loadItemsPage()
}

async function deleteItem(id, name) {
  if (!confirm(\`"\${name}" 항목을 삭제하시겠습니까?\`)) return
  const reason = prompt(\`삭제 사유를 입력해 주세요. (선택사항)\n항목: \${name}\`) ?? ''
  await api('/items/' + id, {
    method: 'DELETE',
    body: JSON.stringify({ reason: reason.trim() || null })
  })
  showToast(\`"\${name}" 삭제 완료\`)
  loadItemsPage()
}

// ============================================================
// 변경이력 모달
// ============================================================
async function showHistoryModal() {
  document.getElementById('modal-history').classList.add('open')
  const container = document.getElementById('history-content')
  container.innerHTML = '<div class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>불러오는 중...</div>'

  const data = await api('/items/history')
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="text-center text-slate-400 py-10"><i class="fas fa-inbox text-2xl mb-2 block"></i>변경이력이 없습니다.</div>'
    return
  }

  const actionLabel = { add: '추가', edit: '수정', delete: '삭제' }
  const actionCls = {
    add: 'bg-emerald-100 text-emerald-700',
    edit: 'bg-blue-100 text-blue-700',
    delete: 'bg-red-100 text-red-700'
  }

  function fmtDate(d) {
    if (!d) return '-'
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? \`\${m[1]}년 \${parseInt(m[2])}월 \${parseInt(m[3])}일\` : d.slice(0, 10)
  }

  container.innerHTML = \`
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-slate-200 text-xs text-slate-500">
          <th class="text-center py-2.5 px-3 w-16">구분</th>
          <th class="text-left py-2.5 px-3">항목명</th>
          <th class="text-left py-2.5 px-3 w-32">평가 영역</th>
          <th class="text-center py-2.5 px-3 w-24">직책</th>
          <th class="text-center py-2.5 px-3 w-14">배점</th>
          <th class="text-left py-2.5 px-3">사유</th>
          <th class="text-right py-2.5 px-3 w-28">변경일</th>
        </tr>
      </thead>
      <tbody>
        \${data.map(h => \`
          <tr class="border-b border-slate-50 hover:bg-slate-50">
            <td class="py-2.5 px-3 text-center">
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full \${actionCls[h.action] || 'bg-slate-100 text-slate-600'}">
                \${actionLabel[h.action] || h.action}
              </span>
            </td>
            <td class="py-2.5 px-3 font-medium text-slate-700">\${h.item_name}</td>
            <td class="py-2.5 px-3 text-xs text-slate-500">\${h.category_name || '-'}</td>
            <td class="py-2.5 px-3 text-center text-xs">
              \${h.position_name
                ? \`<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">\${h.position_name}</span>\`
                : '<span class="text-slate-300">공통</span>'}
            </td>
            <td class="py-2.5 px-3 text-center text-slate-600">\${h.max_score ?? '-'}</td>
            <td class="py-2.5 px-3 text-xs text-slate-500">\${h.reason || '<span class="text-slate-300">-</span>'}</td>
            <td class="py-2.5 px-3 text-right text-xs text-slate-400">\${fmtDate(h.changed_at)}</td>
          </tr>
        \`).join('')}
      </tbody>
    </table>
  \`
}

// ============================================================
// 배점확인 모달
// ============================================================
async function showScoreCheckModal() {
  document.getElementById('modal-score-check').classList.add('open')
  const container = document.getElementById('score-check-content')
  container.innerHTML = '<div class="text-center text-slate-400 py-8"><i class="fas fa-spinner fa-spin mr-2"></i>계산 중...</div>'

  const data = await api('/items/score-check')
  if (!data) { container.innerHTML = '<div class="text-center text-slate-400 py-8">데이터 없음</div>'; return }

  const { rows, common_score } = data

  container.innerHTML = \`
    <!-- 공통 항목 합산 -->
    <div class="bg-slate-50 border border-slate-200 rounded-xl p-4 mb-5">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 rounded-full bg-slate-400"></div>
          <span class="text-sm font-medium text-slate-600">공통 항목 합산</span>
          <span class="text-xs text-slate-400">(전 직책 공통 적용)</span>
        </div>
        <span class="text-lg font-bold text-slate-700">\${common_score}점</span>
      </div>
    </div>

    <!-- 직책별 -->
    <div class="space-y-3">
      \${rows.map(r => {
        const total = r.total_score || 0
        const over = total > 100
        const warn = total === 100
        return \`
        <div class="border rounded-xl p-4 \${over ? 'border-red-300 bg-red-50' : warn ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 bg-white'}">
          <div class="flex items-center justify-between mb-2">
            <div class="flex items-center gap-2">
              <div class="w-2.5 h-2.5 rounded-full" style="background:\${r.color}"></div>
              <span class="text-sm font-semibold text-slate-700">\${r.position_name}</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-slate-400">공통 \${common_score}점 + 전용 \${r.dedicated_score || 0}점</span>
              <span class="text-xl font-bold \${over ? 'text-red-600' : warn ? 'text-emerald-600' : 'text-slate-800'}">\${total}점</span>
              \${over ? '<span class="text-xs font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">⚠ 100점 초과</span>' : ''}
              \${warn ? '<span class="text-xs font-bold text-emerald-600 bg-emerald-100 px-2 py-0.5 rounded-full">✓ 정확</span>' : ''}
            </div>
          </div>
          <!-- 진행바 -->
          <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div class="h-2 rounded-full transition-all \${over ? 'bg-red-400' : warn ? 'bg-emerald-400' : 'bg-indigo-400'}"
              style="width:\${Math.min(total, 120) / 120 * 100}%"></div>
          </div>
          \${over ? \`<p class="text-xs text-red-500 mt-1.5">⚠ \${total - 100}점 초과 — 전용 항목 배점을 조정해 주세요.</p>\` : ''}
        </div>
        \`
      }).join('')}
    </div>
    <p class="text-xs text-slate-400 mt-4 text-center">* 전용 항목이 없는 직책은 공통 항목 점수만 합산됩니다.</p>
  \`
}

// ============================================================
// 평가 기간 관리 페이지
// ============================================================
async function loadPeriodsPage() {
  const container = document.getElementById('periods-list')
  container.innerHTML = state.periods.map(p => {
    const isConfirmed = p.is_confirmed === 1
    return \`
    <div class="card p-5 \${isConfirmed ? 'ring-2 ring-emerald-400 ring-offset-1' : ''}">
      <div class="flex items-start justify-between mb-4">
        <div>
          <div class="flex items-center gap-2 mb-1">
            <div class="text-base font-bold text-slate-800">\${p.label}</div>
            \${isConfirmed
              ? \`<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700"><i class="fas fa-check-circle mr-1"></i>반영완료</span>\`
              : \`<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700"><i class="fas fa-clock mr-1"></i>임시</span>\`
            }
          </div>
          <div class="text-xs text-slate-500">\${p.year}년 \${p.month}월</div>
        </div>
        <div class="w-10 h-10 \${isConfirmed ? 'bg-emerald-100' : 'bg-slate-100'} rounded-xl flex items-center justify-center flex-shrink-0">
          <i class="fas fa-calendar \${isConfirmed ? 'text-emerald-600' : 'text-slate-400'}"></i>
        </div>
      </div>
      <button
        onclick="toggleConfirm(\${p.id})"
        class="w-full text-xs font-semibold py-2 px-3 rounded-lg transition \${
          isConfirmed
            ? 'bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600'
            : 'bg-emerald-600 text-white hover:bg-emerald-700'
        }">
        <i class="fas \${isConfirmed ? 'fa-times-circle' : 'fa-check-circle'} mr-1.5"></i>
        \${isConfirmed ? '반영완료 취소' : '반영완료로 설정'}
      </button>
    </div>
  \`}).join('')
}

function showAddPeriodModal() {
  const now = new Date()
  document.getElementById('period-year').value = now.getFullYear()
  document.getElementById('period-month').value = now.getMonth() + 2
  document.getElementById('modal-period').classList.add('open')
}

async function savePeriod() {
  const year = parseInt(document.getElementById('period-year').value)
  const month = parseInt(document.getElementById('period-month').value)
  if (!year || !month) { showToast('연도/월을 입력하세요', true); return }
  
  await api('/periods', {
    method: 'POST',
    body: JSON.stringify({ year, month, label: \`\${year}년 \${month}월\` })
  })
  closeModal('modal-period')
  showToast('기간 추가 완료 ✓')
  await loadPeriods()
  if (state.currentPage === 'periods') loadPeriodsPage()
}

async function toggleConfirm(periodId) {
  const period = state.periods.find(p => p.id === periodId)
  if (!period) return
  const action = period.is_confirmed ? '반영완료를 취소' : '반영완료로 설정'
  if (!confirm(\`"\${period.label}"을 \${action}하시겠습니까?\`)) return

  const result = await api(\`/periods/\${periodId}/confirm\`, { method: 'PUT' })
  if (!result) return

  // 로컬 state 즉시 업데이트
  period.is_confirmed = result.is_confirmed
  renderPeriodSelect()
  loadPeriodsPage()
  showToast(result.is_confirmed ? \`\${period.label} 반영완료 설정 ✓\` : \`\${period.label} 임시로 변경 ✓\`)
}

// ============================================================
// 유틸
// ============================================================
function closeModal(id) {
  document.getElementById(id).classList.remove('open')
}

let toastTimer = null
function showToast(msg, isError = false) {
  const el = document.getElementById('toast')
  const icon = document.getElementById('toast-icon')
  document.getElementById('toast-msg').textContent = msg
  icon.className = 'fas ' + (isError ? 'fa-exclamation-circle text-red-400' : 'fa-check-circle text-green-400')
  el.classList.remove('hidden')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000)
}

// 모달 바깥 클릭 시 닫기
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.remove('open')
  })
})

// ============================================================
// ★ 색상 설정 시스템
// ============================================================

// ── 테마 기본값 ──────────────────────────────────────────────
const DEFAULT_THEME = {
  sidebarFrom:   '#312e81',
  sidebarTo:     '#3730a3',
  sidebarBorder: '#4338ca',
  accent:        '#6366f1',
  accentHover:   '#4f46e5',
  bodyBg:        '#f8fafc',
  cardBg:        '#ffffff',
  gradeSBg: '#fef3c7', gradeSFg: '#92400e',
  gradeABg: '#dcfce7', gradeAFg: '#166534',
  gradeBBg: '#dbeafe', gradeBFg: '#1e40af',
  gradeCBg: '#f3f4f6', gradeCFg: '#374151',
  gradeDBg: '#fee2e2', gradeDFg: '#991b1b',
}

// ── 테마 프리셋 ──────────────────────────────────────────────
const THEME_PRESETS = [
  { label: '기본 인디고', icon: '💜', sidebarFrom:'#312e81', sidebarTo:'#3730a3', sidebarBorder:'#4338ca', accent:'#6366f1', accentHover:'#4f46e5', bodyBg:'#f8fafc', cardBg:'#ffffff' },
  { label: '네이비 블루', icon: '🔵', sidebarFrom:'#1e3a5f', sidebarTo:'#1e40af', sidebarBorder:'#1d4ed8', accent:'#2563eb', accentHover:'#1d4ed8', bodyBg:'#f0f4ff', cardBg:'#ffffff' },
  { label: '에메랄드',    icon: '💚', sidebarFrom:'#064e3b', sidebarTo:'#065f46', sidebarBorder:'#047857', accent:'#059669', accentHover:'#047857', bodyBg:'#f0fdf4', cardBg:'#ffffff' },
  { label: '로즈',       icon: '🌸', sidebarFrom:'#881337', sidebarTo:'#9f1239', sidebarBorder:'#be123c', accent:'#e11d48', accentHover:'#be123c', bodyBg:'#fff1f2', cardBg:'#ffffff' },
  { label: '앰버',       icon: '🟡', sidebarFrom:'#78350f', sidebarTo:'#92400e', sidebarBorder:'#b45309', accent:'#d97706', accentHover:'#b45309', bodyBg:'#fffbeb', cardBg:'#ffffff' },
  { label: '다크',       icon: '🌙', sidebarFrom:'#0f172a', sidebarTo:'#1e293b', sidebarBorder:'#334155', accent:'#818cf8', accentHover:'#6366f1', bodyBg:'#0f172a', cardBg:'#1e293b' },
]

// ── CSS 변수 적용 ────────────────────────────────────────────
function applyCssVars(t) {
  const r = document.documentElement.style
  r.setProperty('--accent',         t.accent        || DEFAULT_THEME.accent)
  r.setProperty('--accent-hover',   t.accentHover   || DEFAULT_THEME.accentHover)
  r.setProperty('--sidebar-from',   t.sidebarFrom   || DEFAULT_THEME.sidebarFrom)
  r.setProperty('--sidebar-to',     t.sidebarTo     || DEFAULT_THEME.sidebarTo)
  r.setProperty('--sidebar-border', t.sidebarBorder || DEFAULT_THEME.sidebarBorder)
  r.setProperty('--body-bg',        t.bodyBg        || DEFAULT_THEME.bodyBg)
  r.setProperty('--card-bg',        t.cardBg        || DEFAULT_THEME.cardBg)
  // 등급
  const grades = ['S','A','B','C','D']
  grades.forEach(g => {
    r.setProperty(\`--grade-\${g}-bg\`, t[\`grade\${g}Bg\`] || DEFAULT_THEME[\`grade\${g}Bg\`])
    r.setProperty(\`--grade-\${g}-fg\`, t[\`grade\${g}Fg\`] || DEFAULT_THEME[\`grade\${g}Fg\`])
  })
  // DOM에 직접 반영 (tailwind override)
  applyThemeToDom(t)
}

function applyThemeToDom(t) {
  // 사이드바
  const sidebar = document.querySelector('.fixed.left-0.top-0.h-full')
  if (sidebar) {
    sidebar.style.background = \`linear-gradient(to bottom, \${t.sidebarFrom||DEFAULT_THEME.sidebarFrom}, \${t.sidebarTo||DEFAULT_THEME.sidebarTo})\`
  }
  // body 배경
  document.body.style.backgroundColor = t.bodyBg || DEFAULT_THEME.bodyBg

  // 카드 배경
  const cards = document.querySelectorAll('.card')
  cards.forEach(c => { c.style.backgroundColor = t.cardBg || DEFAULT_THEME.cardBg })

  // 강조 버튼들
  const accentBtns = document.querySelectorAll('.bg-indigo-600')
  accentBtns.forEach(b => {
    b.style.backgroundColor = t.accent || DEFAULT_THEME.accent
  })

  // 등급 색상
  const gradeMap = {
    'grade-S': [t.gradeSBg||DEFAULT_THEME.gradeSBg, t.gradeSFg||DEFAULT_THEME.gradeSFg],
    'grade-A': [t.gradeABg||DEFAULT_THEME.gradeABg, t.gradeAFg||DEFAULT_THEME.gradeAFg],
    'grade-B': [t.gradeBBg||DEFAULT_THEME.gradeBBg, t.gradeBFg||DEFAULT_THEME.gradeBFg],
    'grade-C': [t.gradeCBg||DEFAULT_THEME.gradeCBg, t.gradeCFg||DEFAULT_THEME.gradeCFg],
    'grade-D': [t.gradeDBg||DEFAULT_THEME.gradeDBg, t.gradeDFg||DEFAULT_THEME.gradeDFg],
  }
  Object.entries(gradeMap).forEach(([cls, [bg, fg]]) => {
    document.querySelectorAll('.' + cls).forEach(el => {
      el.style.backgroundColor = bg; el.style.color = fg
    })
  })

  // 탭 active border
  const style = document.getElementById('dynamic-theme-style') || (() => {
    const s = document.createElement('style'); s.id = 'dynamic-theme-style'; document.head.appendChild(s); return s
  })()
  style.textContent = \`
    .tab-btn.active { border-bottom-color: \${t.accent||DEFAULT_THEME.accent} !important; color: \${t.accent||DEFAULT_THEME.accent} !important; }
    .score-input:focus { border-color: \${t.accent||DEFAULT_THEME.accent}; box-shadow: 0 0 0 2px \${(t.accent||DEFAULT_THEME.accent)}33; }
    select:focus, input:focus, textarea:focus { border-color: \${t.accent||DEFAULT_THEME.accent} !important; }
    .nav-item.active { background: rgba(255,255,255,0.15); }
    .grade-S { background: \${t.gradeSBg||DEFAULT_THEME.gradeSBg} !important; color: \${t.gradeSFg||DEFAULT_THEME.gradeSFg} !important; }
    .grade-A { background: \${t.gradeABg||DEFAULT_THEME.gradeABg} !important; color: \${t.gradeAFg||DEFAULT_THEME.gradeAFg} !important; }
    .grade-B { background: \${t.gradeBBg||DEFAULT_THEME.gradeBBg} !important; color: \${t.gradeBFg||DEFAULT_THEME.gradeBFg} !important; }
    .grade-C { background: \${t.gradeCBg||DEFAULT_THEME.gradeCBg} !important; color: \${t.gradeCFg||DEFAULT_THEME.gradeCFg} !important; }
    .grade-D { background: \${t.gradeDBg||DEFAULT_THEME.gradeDBg} !important; color: \${t.gradeDFg||DEFAULT_THEME.gradeDFg} !important; }
    .bg-indigo-600 { background-color: \${t.accent||DEFAULT_THEME.accent} !important; }
    .bg-indigo-700, .hover\\:bg-indigo-700:hover { background-color: \${t.accentHover||DEFAULT_THEME.accentHover} !important; }
    .border-indigo-700 { border-color: \${t.sidebarBorder||DEFAULT_THEME.sidebarBorder} !important; }
    .text-indigo-300 { color: \${hexToRgba(t.accent||DEFAULT_THEME.accent, 0.6)} !important; }
    .text-indigo-400 { color: \${hexToRgba(t.accent||DEFAULT_THEME.accent, 0.7)} !important; }
    .text-indigo-600 { color: \${t.accent||DEFAULT_THEME.accent} !important; }
    .focus\\:border-indigo-400:focus { border-color: \${t.accent||DEFAULT_THEME.accent} !important; }
    .card { background-color: \${t.cardBg||DEFAULT_THEME.cardBg} !important; }
    body { background-color: \${t.bodyBg||DEFAULT_THEME.bodyBg} !important; }
  \`
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16)
  return \`rgba(\${r},\${g},\${b},\${alpha})\`
}

function applyStoredTheme() {
  try {
    const saved = localStorage.getItem('lingo_theme')
    if (saved) { state.theme = JSON.parse(saved); applyCssVars(state.theme) }
    else { state.theme = { ...DEFAULT_THEME }; applyCssVars(state.theme) }
  } catch(e) { state.theme = { ...DEFAULT_THEME }; applyCssVars(state.theme) }
}

// ── 색상 설정 페이지 렌더 ─────────────────────────────────────
function loadColorsPage() {
  renderThemePresets()
  renderThemePickers()
  renderPositionColors()
  renderCategoryColors()
}

function renderThemePresets() {
  const t = state.theme || DEFAULT_THEME
  const container = document.getElementById('theme-presets')
  container.innerHTML = THEME_PRESETS.map((p, i) => {
    const isActive = p.accent === t.accent && p.sidebarFrom === t.sidebarFrom
    return \`
      <button onclick="applyPreset(\${i})" class="theme-preset-btn \${isActive ? 'selected' : ''}"
        style="background:\${p.sidebarFrom}18; border-color:\${isActive ? p.accent : '#e2e8f0'}">
        <div class="flex items-center gap-2">
          <div class="flex gap-0.5">
            <div class="w-3 h-5 rounded-l" style="background:\${p.sidebarFrom}"></div>
            <div class="w-3 h-5 rounded-r" style="background:\${p.accent}"></div>
          </div>
          <span style="color:\${p.sidebarFrom}; font-size:12px">\${p.icon} \${p.label}</span>
        </div>
      </button>
    \`
  }).join('')
}

function applyPreset(idx) {
  const preset = THEME_PRESETS[idx]
  const t = state.theme || { ...DEFAULT_THEME }
  // 프리셋은 테마 관련 키만 덮어씀 (등급 색상은 유지)
  Object.assign(t, {
    sidebarFrom: preset.sidebarFrom, sidebarTo: preset.sidebarTo,
    sidebarBorder: preset.sidebarBorder, accent: preset.accent,
    accentHover: preset.accentHover, bodyBg: preset.bodyBg, cardBg: preset.cardBg
  })
  state.theme = t
  applyCssVars(t)
  renderThemePickers()   // 피커 값 갱신
  renderThemePresets()   // 선택 상태 갱신
  showToast('\`' + preset.label + '\` 테마 미리보기 적용 (저장 버튼으로 확정)')
}

function renderThemePickers() {
  const t = state.theme || DEFAULT_THEME
  const setVal = (id, val) => {
    const el = document.getElementById(id); if (el) el.value = val
  }
  const setPrev = (id, val) => {
    const el = document.getElementById(id); if (el) el.style.backgroundColor = val
  }
  setVal('theme-sidebar-from',   t.sidebarFrom   || DEFAULT_THEME.sidebarFrom)
  setVal('theme-sidebar-to',     t.sidebarTo     || DEFAULT_THEME.sidebarTo)
  setVal('theme-sidebar-border', t.sidebarBorder || DEFAULT_THEME.sidebarBorder)
  setVal('theme-accent',         t.accent        || DEFAULT_THEME.accent)
  setVal('theme-bg',             t.bodyBg        || DEFAULT_THEME.bodyBg)
  setVal('theme-card',           t.cardBg        || DEFAULT_THEME.cardBg)
  setPrev('prev-sidebar-from',   t.sidebarFrom   || DEFAULT_THEME.sidebarFrom)
  setPrev('prev-sidebar-to',     t.sidebarTo     || DEFAULT_THEME.sidebarTo)
  setPrev('prev-sidebar-border', t.sidebarBorder || DEFAULT_THEME.sidebarBorder)
  setPrev('prev-accent',         t.accent        || DEFAULT_THEME.accent)
  setPrev('prev-bg',             t.bodyBg        || DEFAULT_THEME.bodyBg)
  setPrev('prev-card',           t.cardBg        || DEFAULT_THEME.cardBg)

  // 등급 색상 피커
  const grades = [
    { key:'S', label:'S 탁월함' },
    { key:'A', label:'A 우수함' },
    { key:'B', label:'B 양호함' },
    { key:'C', label:'C 보통' },
    { key:'D', label:'D 개선필요' },
  ]
  const gradeRow = document.getElementById('grade-color-row')
  if (gradeRow) {
    gradeRow.innerHTML = grades.map(g => \`
      <div class="text-center">
        <div class="text-xs text-slate-500 mb-2">\${g.label}</div>
        <div class="flex flex-col items-center gap-1.5">
          <div>
            <div class="text-xs text-slate-400 mb-1">배경</div>
            <div class="relative">
              <div class="w-8 h-8 rounded-lg border border-slate-200 mx-auto mb-0.5" id="prev-grade-\${g.key}-bg"
                style="background:\${t['grade'+g.key+'Bg']||DEFAULT_THEME['grade'+g.key+'Bg']}"></div>
              <input type="color" class="color-picker-inline" id="grade-\${g.key}-bg"
                value="\${t['grade'+g.key+'Bg']||DEFAULT_THEME['grade'+g.key+'Bg']}"
                oninput="previewGradeColor('\${g.key}','bg',this.value)">
            </div>
          </div>
          <div>
            <div class="text-xs text-slate-400 mb-1">글자</div>
            <div>
              <div class="w-8 h-8 rounded-lg border border-slate-200 mx-auto mb-0.5 flex items-center justify-center font-bold text-sm" id="prev-grade-\${g.key}-fg"
                style="background:\${t['grade'+g.key+'Bg']||DEFAULT_THEME['grade'+g.key+'Bg']}; color:\${t['grade'+g.key+'Fg']||DEFAULT_THEME['grade'+g.key+'Fg']}">\${g.key}</div>
              <input type="color" class="color-picker-inline" id="grade-\${g.key}-fg"
                value="\${t['grade'+g.key+'Fg']||DEFAULT_THEME['grade'+g.key+'Fg']}"
                oninput="previewGradeColor('\${g.key}','fg',this.value)">
            </div>
          </div>
        </div>
      </div>
    \`).join('')
  }
}

function previewGradeColor(grade, type, val) {
  const t = state.theme || DEFAULT_THEME
  t['grade' + grade + (type === 'bg' ? 'Bg' : 'Fg')] = val
  state.theme = t
  // 미리보기 스와치 갱신
  const prevBg = document.getElementById(\`prev-grade-\${grade}-bg\`)
  const prevFg = document.getElementById(\`prev-grade-\${grade}-fg\`)
  if (prevBg) prevBg.style.backgroundColor = t['grade'+grade+'Bg']||DEFAULT_THEME['grade'+grade+'Bg']
  if (prevFg) {
    prevFg.style.backgroundColor = t['grade'+grade+'Bg']||DEFAULT_THEME['grade'+grade+'Bg']
    prevFg.style.color = t['grade'+grade+'Fg']||DEFAULT_THEME['grade'+grade+'Fg']
  }
  applyCssVars(t)
}

function previewTheme() {
  const t = state.theme || { ...DEFAULT_THEME }
  t.sidebarFrom   = document.getElementById('theme-sidebar-from')?.value   || t.sidebarFrom
  t.sidebarTo     = document.getElementById('theme-sidebar-to')?.value     || t.sidebarTo
  t.sidebarBorder = document.getElementById('theme-sidebar-border')?.value || t.sidebarBorder
  t.accent        = document.getElementById('theme-accent')?.value         || t.accent
  t.accentHover   = t.accent
  t.bodyBg        = document.getElementById('theme-bg')?.value             || t.bodyBg
  t.cardBg        = document.getElementById('theme-card')?.value           || t.cardBg
  state.theme = t
  // 미리보기 스와치 갱신
  const setP = (id, v) => { const el = document.getElementById(id); if(el) el.style.backgroundColor = v }
  setP('prev-sidebar-from',   t.sidebarFrom)
  setP('prev-sidebar-to',     t.sidebarTo)
  setP('prev-sidebar-border', t.sidebarBorder)
  setP('prev-accent',         t.accent)
  setP('prev-bg',             t.bodyBg)
  setP('prev-card',           t.cardBg)
  applyCssVars(t)
  renderThemePresets()
}

function saveTheme() {
  previewTheme()
  localStorage.setItem('lingo_theme', JSON.stringify(state.theme))
  showToast('테마 색상이 저장되었습니다 ✓')
  renderThemePresets()
}

function resetTheme() {
  if (!confirm('테마를 기본값으로 초기화하시겠습니까?')) return
  state.theme = { ...DEFAULT_THEME }
  localStorage.removeItem('lingo_theme')
  applyCssVars(state.theme)
  renderThemePickers()
  renderThemePresets()
  showToast('테마가 초기화되었습니다')
}

// ── 직책 색상 ─────────────────────────────────────────────────
function renderPositionColors() {
  const container = document.getElementById('position-color-list')
  if (!container) return
  container.innerHTML = state.positions.map(pos => \`
    <div class="color-row-item">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center text-white text-sm font-bold"
          id="pos-swatch-\${pos.id}" style="background:\${pos.color}">\${pos.name[0]}</div>
        <div>
          <div class="text-sm font-semibold text-slate-800">\${pos.name}</div>
          <div class="text-xs text-slate-400" id="pos-hex-\${pos.id}">\${pos.color}</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex gap-1.5">
          \${['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2','#db2777','#65a30d'].map(c => \`
            <button onclick="quickColorPos(\${pos.id},'\${c}')"
              class="w-5 h-5 rounded-full border-2 transition hover:scale-110"
              style="background:\${c}; border-color:\${pos.color===c?'#1e293b':'transparent'}"
              title="\${c}"></button>
          \`).join('')}
        </div>
        <input type="color" class="color-picker-inline" value="\${pos.color}"
          id="pos-color-input-\${pos.id}"
          oninput="onPositionColorInput(\${pos.id}, this.value)"
          onchange="savePositionColor(\${pos.id}, this.value)">
      </div>
    </div>
  \`).join('')
}

function onPositionColorInput(id, val) {
  const swatch = document.getElementById(\`pos-swatch-\${id}\`)
  const hex = document.getElementById(\`pos-hex-\${id}\`)
  if (swatch) swatch.style.backgroundColor = val
  if (hex) hex.textContent = val
  // 빠른 선택 버튼 border 갱신
  renderPositionColors()
  // state 반영 (임시)
  const pos = state.positions.find(p => p.id === id)
  if (pos) pos.color = val
  // 피커 값 복원
  const input = document.getElementById(\`pos-color-input-\${id}\`)
  if (input) input.value = val
}

async function quickColorPos(id, color) {
  const pos = state.positions.find(p => p.id === id)
  if (!pos) return
  pos.color = color
  await api('/positions/' + id, { method: 'PUT', body: JSON.stringify({ name: pos.name, color }) })
  showToast(pos.name + ' 색상 변경 완료 ✓')
  await loadPositions()
  renderPositionColors()
}

async function savePositionColor(id, color) {
  const pos = state.positions.find(p => p.id === id)
  if (!pos) return
  await api('/positions/' + id, { method: 'PUT', body: JSON.stringify({ name: pos.name, color }) })
  showToast(pos.name + ' 색상 저장 ✓')
  await loadPositions()
  renderPositionColors()
}

// ── 평가 영역 색상 ────────────────────────────────────────────
function renderCategoryColors() {
  const container = document.getElementById('category-color-list')
  if (!container) return
  container.innerHTML = state.categories.map(cat => \`
    <div class="color-row-item">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-lg flex items-center justify-center"
          id="cat-swatch-\${cat.id}" style="background:\${cat.color}22; border: 2px solid \${cat.color}">
          <i class="fas fa-layer-group text-xs" style="color:\${cat.color}"></i>
        </div>
        <div>
          <div class="text-sm font-semibold text-slate-800">\${cat.name}</div>
          <div class="text-xs text-slate-400" id="cat-hex-\${cat.id}">\${cat.color} · \${cat.max_score}점</div>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex gap-1.5">
          \${['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'].map(c => \`
            <button onclick="quickColorCat(\${cat.id},'\${c}')"
              class="w-5 h-5 rounded-full border-2 transition hover:scale-110"
              style="background:\${c}; border-color:\${cat.color===c?'#1e293b':'transparent'}"
              title="\${c}"></button>
          \`).join('')}
        </div>
        <input type="color" class="color-picker-inline" value="\${cat.color}"
          id="cat-color-input-\${cat.id}"
          oninput="onCategoryColorInput(\${cat.id}, this.value)"
          onchange="saveCategoryColor(\${cat.id}, this.value)">
      </div>
    </div>
  \`).join('')
}

function onCategoryColorInput(id, val) {
  const cat = state.categories.find(c => c.id === id)
  if (cat) cat.color = val
  const swatch = document.getElementById(\`cat-swatch-\${id}\`)
  const hex = document.getElementById(\`cat-hex-\${id}\`)
  if (swatch) {
    swatch.style.background = val + '22'
    swatch.style.borderColor = val
    swatch.querySelector('i').style.color = val
  }
  if (hex) hex.textContent = val + ' · ' + (cat?.max_score||0) + '점'
  renderCategoryColors()
  const input = document.getElementById(\`cat-color-input-\${id}\`)
  if (input) input.value = val
}

async function quickColorCat(id, color) {
  const cat = state.categories.find(c => c.id === id)
  if (!cat) return
  await api('/categories/' + id, { method: 'PUT', body: JSON.stringify({
    name: cat.name, max_score: cat.max_score, sort_order: cat.sort_order, color
  })})
  showToast(cat.name + ' 색상 변경 완료 ✓')
  await loadCategories()
  renderCategoryColors()
}

async function saveCategoryColor(id, color) {
  const cat = state.categories.find(c => c.id === id)
  if (!cat) return
  await api('/categories/' + id, { method: 'PUT', body: JSON.stringify({
    name: cat.name, max_score: cat.max_score, sort_order: cat.sort_order, color
  })})
  showToast(cat.name + ' 색상 저장 ✓')
  await loadCategories()
  renderCategoryColors()
}

// 초기화
init()
</script>
</body>
</html>`
}

// ===================== 색상 설정 전용 페이지 HTML =====================
function getColorsHtml(): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>색상 설정 — 링고 고객센터 평가 시스템</title>
<script src="https://cdn.tailwindcss.com"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap');
  * { font-family: 'Noto Sans KR', sans-serif; }
  ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
  body { background: #f8fafc; }
  .card { background: white; border-radius: 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
  .color-picker-inline { width: 38px; height: 30px; padding: 2px; border: 1.5px solid #e2e8f0; border-radius: 7px; cursor: pointer; background: white; }
  .color-picker-inline::-webkit-color-swatch-wrapper { padding: 2px; }
  .color-picker-inline::-webkit-color-swatch { border: none; border-radius: 4px; }
  .color-row-item { display: flex; align-items: center; justify-content: space-between; padding: 13px 16px; border: 1.5px solid #f1f5f9; border-radius: 11px; background: #fafbfc; transition: all 0.15s; }
  .color-row-item:hover { border-color: #c7d2fe; box-shadow: 0 2px 10px rgba(99,102,241,0.08); background: white; }
  .quick-dot { width: 20px; height: 20px; border-radius: 50%; border: 2.5px solid transparent; cursor: pointer; transition: transform 0.12s; flex-shrink:0; }
  .quick-dot:hover { transform: scale(1.18); }
  .preset-card { border: 2px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; cursor: pointer; transition: all 0.15s; background: white; }
  .preset-card:hover { border-color: #a5b4fc; box-shadow: 0 4px 14px rgba(99,102,241,0.1); }
  .preset-card.active { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
  .section-badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  input[type=color]::-webkit-color-swatch-wrapper { padding: 0; }
  .back-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 9px; font-size: 13px; font-weight: 500; color: #64748b; background: white; border: 1.5px solid #e2e8f0; cursor: pointer; transition: all 0.15s; }
  .back-btn:hover { background: #f1f5f9; color: #334155; }
  .save-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 20px; border-radius: 9px; font-size: 13px; font-weight: 600; color: white; background: #6366f1; border: none; cursor: pointer; transition: background 0.15s; }
  .save-btn:hover { background: #4f46e5; }
  .reset-btn { display: inline-flex; align-items: center; gap: 6px; padding: 9px 16px; border-radius: 9px; font-size: 13px; font-weight: 500; color: #64748b; background: white; border: 1.5px solid #e2e8f0; cursor: pointer; transition: all 0.15s; }
  .reset-btn:hover { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  #toast { transition: opacity 0.3s; }
</style>
</head>
<body>

<!-- 상단 헤더 -->
<header class="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
  <div class="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <button class="back-btn" onclick="location.href='/'">
        <i class="fas fa-arrow-left text-xs"></i> 메인으로
      </button>
      <div>
        <h1 class="text-base font-bold text-slate-800 flex items-center gap-2">
          <i class="fas fa-palette text-indigo-500"></i> 색상 설정
        </h1>
        <p class="text-xs text-slate-400">직책·평가영역·UI 테마 색상을 자유롭게 변경합니다</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button class="reset-btn" onclick="resetTheme()"><i class="fas fa-undo text-xs"></i> 초기화</button>
      <button class="save-btn" onclick="saveTheme()"><i class="fas fa-save text-xs"></i> 테마 저장</button>
    </div>
  </div>
</header>

<div class="max-w-5xl mx-auto px-6 py-8 space-y-8">

  <!-- ① UI 테마 -->
  <section class="card p-7">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
        <i class="fas fa-desktop text-indigo-500"></i>
      </div>
      <div>
        <h2 class="text-sm font-bold text-slate-800">UI 테마 색상</h2>
        <p class="text-xs text-slate-500 mt-0.5">사이드바·버튼·강조색·배경을 변경합니다. 변경 내용은 메인 화면에 즉시 반영됩니다.</p>
      </div>
    </div>

    <!-- 프리셋 -->
    <div class="mb-6">
      <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">빠른 프리셋</p>
      <div id="theme-presets" class="grid grid-cols-3 gap-3 sm:grid-cols-6"></div>
    </div>

    <!-- 색상 피커 그리드 -->
    <div class="grid grid-cols-2 gap-6 mb-6">
      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">사이드바</p>
        <div class="space-y-2.5">
          <div class="color-row-item">
            <span class="text-sm text-slate-600">상단 색상</span>
            <div class="flex items-center gap-2">
              <div id="prev-sidebar-from" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-sidebar-from" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
          <div class="color-row-item">
            <span class="text-sm text-slate-600">하단 색상</span>
            <div class="flex items-center gap-2">
              <div id="prev-sidebar-to" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-sidebar-to" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
          <div class="color-row-item">
            <span class="text-sm text-slate-600">구분선 색상</span>
            <div class="flex items-center gap-2">
              <div id="prev-sidebar-border" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-sidebar-border" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
        </div>
      </div>
      <div>
        <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">강조색 / 배경</p>
        <div class="space-y-2.5">
          <div class="color-row-item">
            <span class="text-sm text-slate-600">버튼·탭 강조색</span>
            <div class="flex items-center gap-2">
              <div id="prev-accent" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-accent" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
          <div class="color-row-item">
            <span class="text-sm text-slate-600">페이지 배경</span>
            <div class="flex items-center gap-2">
              <div id="prev-bg" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-bg" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
          <div class="color-row-item">
            <span class="text-sm text-slate-600">카드 배경</span>
            <div class="flex items-center gap-2">
              <div id="prev-card" class="w-6 h-6 rounded-lg border border-slate-200"></div>
              <input type="color" id="theme-card" class="color-picker-inline" oninput="previewTheme()">
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 등급 색상 -->
    <div>
      <p class="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">등급 색상 (S · A · B · C · D)</p>
      <div id="grade-color-row" class="grid grid-cols-5 gap-3"></div>
    </div>
  </section>

  <!-- ② 직책 색상 -->
  <section class="card p-7">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-9 h-9 rounded-xl bg-purple-50 flex items-center justify-center">
        <i class="fas fa-id-badge text-purple-500"></i>
      </div>
      <div>
        <h2 class="text-sm font-bold text-slate-800">직책 색상</h2>
        <p class="text-xs text-slate-500 mt-0.5">보직별 구분 색상 · 차트·배지·보고서에 즉시 반영됩니다</p>
      </div>
    </div>
    <div id="position-color-list" class="grid grid-cols-2 gap-3"></div>
  </section>

  <!-- ③ 평가 영역 색상 -->
  <section class="card p-7">
    <div class="flex items-center gap-3 mb-6">
      <div class="w-9 h-9 rounded-xl bg-sky-50 flex items-center justify-center">
        <i class="fas fa-layer-group text-sky-500"></i>
      </div>
      <div>
        <h2 class="text-sm font-bold text-slate-800">평가 영역 색상</h2>
        <p class="text-xs text-slate-500 mt-0.5">업무 영역별 색상 · 차트·프로그레스바·레이더에 즉시 반영됩니다</p>
      </div>
    </div>
    <div id="category-color-list" class="grid grid-cols-2 gap-3"></div>
  </section>

</div>

<!-- Toast -->
<div id="toast" class="fixed bottom-6 right-6 z-50 hidden opacity-0">
  <div class="bg-slate-800 text-white px-4 py-3 rounded-xl text-sm shadow-xl flex items-center gap-2">
    <i id="toast-icon" class="fas fa-check-circle text-emerald-400"></i>
    <span id="toast-msg"></span>
  </div>
</div>

<script>
// ============================================================
// 색상 설정 전용 페이지 스크립트
// ============================================================

const DEFAULT_THEME = {
  sidebarFrom:'#312e81', sidebarTo:'#3730a3', sidebarBorder:'#4338ca',
  accent:'#6366f1', accentHover:'#4f46e5', bodyBg:'#f8fafc', cardBg:'#ffffff',
  gradeSBg:'#fef3c7', gradeSFg:'#92400e',
  gradeABg:'#dcfce7', gradeAFg:'#166534',
  gradeBBg:'#dbeafe', gradeBFg:'#1e40af',
  gradeCBg:'#f3f4f6', gradeCFg:'#374151',
  gradeDBg:'#fee2e2', gradeDFg:'#991b1b',
}

const THEME_PRESETS = [
  { label:'인디고',   icon:'💜', sidebarFrom:'#312e81', sidebarTo:'#3730a3', sidebarBorder:'#4338ca', accent:'#6366f1', accentHover:'#4f46e5', bodyBg:'#f8fafc', cardBg:'#ffffff' },
  { label:'네이비',   icon:'🔵', sidebarFrom:'#1e3a5f', sidebarTo:'#1e40af', sidebarBorder:'#1d4ed8', accent:'#2563eb', accentHover:'#1d4ed8', bodyBg:'#f0f4ff', cardBg:'#ffffff' },
  { label:'에메랄드', icon:'💚', sidebarFrom:'#064e3b', sidebarTo:'#065f46', sidebarBorder:'#047857', accent:'#059669', accentHover:'#047857', bodyBg:'#f0fdf4', cardBg:'#ffffff' },
  { label:'로즈',     icon:'🌸', sidebarFrom:'#881337', sidebarTo:'#9f1239', sidebarBorder:'#be123c', accent:'#e11d48', accentHover:'#be123c', bodyBg:'#fff1f2', cardBg:'#ffffff' },
  { label:'앰버',     icon:'🟡', sidebarFrom:'#78350f', sidebarTo:'#92400e', sidebarBorder:'#b45309', accent:'#d97706', accentHover:'#b45309', bodyBg:'#fffbeb', cardBg:'#ffffff' },
  { label:'다크',     icon:'🌙', sidebarFrom:'#0f172a', sidebarTo:'#1e293b', sidebarBorder:'#334155', accent:'#818cf8', accentHover:'#6366f1', bodyBg:'#0f172a', cardBg:'#1e293b' },
]

const QUICK_COLORS = ['#6366f1','#2563eb','#059669','#d97706','#dc2626','#0891b2','#db2777','#65a30d','#7c3aed','#f97316','#64748b','#0f172a']

let theme = {}
let positions = []
let categories = []

async function init() {
  loadTheme()
  await Promise.all([loadPositions(), loadCategories()])
  renderPresets()
  renderPickers()
  renderGradeColors()
  renderPositionColors()
  renderCategoryColors()
}

function loadTheme() {
  try { theme = JSON.parse(localStorage.getItem('lingo_theme') || 'null') || { ...DEFAULT_THEME } }
  catch { theme = { ...DEFAULT_THEME } }
}

async function loadPositions() {
  const r = await fetch('/api/positions'); positions = await r.json()
}
async function loadCategories() {
  const r = await fetch('/api/categories'); categories = await r.json()
}

// ── 프리셋 ──
function renderPresets() {
  const c = document.getElementById('theme-presets')
  c.innerHTML = THEME_PRESETS.map((p, i) => {
    const active = p.accent === theme.accent && p.sidebarFrom === theme.sidebarFrom
    return \`<div class="preset-card \${active?'active':''}" onclick="applyPreset(\${i})">
      <div class="flex items-center gap-2 mb-2">
        <div class="flex gap-0.5 rounded overflow-hidden" style="width:28px;height:16px">
          <div style="flex:1;background:\${p.sidebarFrom}"></div>
          <div style="flex:1;background:\${p.accent}"></div>
        </div>
        <span style="color:\${p.sidebarFrom};font-size:11px;font-weight:600">\${p.icon}</span>
      </div>
      <div class="text-xs font-semibold text-slate-700">\${p.label}</div>
    </div>\`
  }).join('')
}

function applyPreset(i) {
  const p = THEME_PRESETS[i]
  Object.assign(theme, { sidebarFrom:p.sidebarFrom, sidebarTo:p.sidebarTo, sidebarBorder:p.sidebarBorder,
    accent:p.accent, accentHover:p.accentHover, bodyBg:p.bodyBg, cardBg:p.cardBg })
  renderPresets(); renderPickers()
  applyPreviewStyle()
  showToast('\`'+p.label+'\` 프리셋 적용 — 저장 버튼으로 확정하세요')
}

// ── 피커 ──
function renderPickers() {
  const set = (id, v) => { const el=document.getElementById(id); if(el){el.value=v||'#ffffff'} }
  const prev = (id, v) => { const el=document.getElementById(id); if(el){el.style.background=v||'#fff'} }
  set('theme-sidebar-from',   theme.sidebarFrom);   prev('prev-sidebar-from',   theme.sidebarFrom)
  set('theme-sidebar-to',     theme.sidebarTo);     prev('prev-sidebar-to',     theme.sidebarTo)
  set('theme-sidebar-border', theme.sidebarBorder); prev('prev-sidebar-border', theme.sidebarBorder)
  set('theme-accent',         theme.accent);        prev('prev-accent',         theme.accent)
  set('theme-bg',             theme.bodyBg);        prev('prev-bg',             theme.bodyBg)
  set('theme-card',           theme.cardBg);        prev('prev-card',           theme.cardBg)
}

function previewTheme() {
  theme.sidebarFrom   = document.getElementById('theme-sidebar-from')?.value   || theme.sidebarFrom
  theme.sidebarTo     = document.getElementById('theme-sidebar-to')?.value     || theme.sidebarTo
  theme.sidebarBorder = document.getElementById('theme-sidebar-border')?.value || theme.sidebarBorder
  theme.accent        = document.getElementById('theme-accent')?.value         || theme.accent
  theme.accentHover   = theme.accent
  theme.bodyBg        = document.getElementById('theme-bg')?.value             || theme.bodyBg
  theme.cardBg        = document.getElementById('theme-card')?.value           || theme.cardBg
  const setP = (id, v) => { const el=document.getElementById(id); if(el) el.style.background=v }
  setP('prev-sidebar-from', theme.sidebarFrom); setP('prev-sidebar-to', theme.sidebarTo)
  setP('prev-sidebar-border', theme.sidebarBorder); setP('prev-accent', theme.accent)
  setP('prev-bg', theme.bodyBg); setP('prev-card', theme.cardBg)
  applyPreviewStyle(); renderPresets()
}

function applyPreviewStyle() {
  // 이 페이지의 저장 버튼 색상 미리보기
  document.querySelectorAll('.save-btn').forEach(b => b.style.background = theme.accent)
}

// ── 등급 색상 ──
function renderGradeColors() {
  const grades = [{k:'S',l:'S 탁월함'},{k:'A',l:'A 우수함'},{k:'B',l:'B 양호함'},{k:'C',l:'C 보통'},{k:'D',l:'D 개선필요'}]
  document.getElementById('grade-color-row').innerHTML = grades.map(g => \`
    <div class="border border-slate-100 rounded-xl p-4 text-center bg-slate-50">
      <div class="text-xs font-semibold text-slate-500 mb-3">\${g.l}</div>
      <div class="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center font-bold text-base border border-slate-200"
        id="grade-preview-\${g.k}"
        style="background:\${theme['grade'+g.k+'Bg']||DEFAULT_THEME['grade'+g.k+'Bg']};color:\${theme['grade'+g.k+'Fg']||DEFAULT_THEME['grade'+g.k+'Fg']}">\${g.k}</div>
      <div class="flex justify-center gap-2 mb-1">
        <div>
          <div class="text-xs text-slate-400 mb-1">배경</div>
          <input type="color" class="color-picker-inline" id="grade-\${g.k}-bg"
            value="\${theme['grade'+g.k+'Bg']||DEFAULT_THEME['grade'+g.k+'Bg']}"
            oninput="onGradeColor('\${g.k}','bg',this.value)">
        </div>
        <div>
          <div class="text-xs text-slate-400 mb-1">글자</div>
          <input type="color" class="color-picker-inline" id="grade-\${g.k}-fg"
            value="\${theme['grade'+g.k+'Fg']||DEFAULT_THEME['grade'+g.k+'Fg']}"
            oninput="onGradeColor('\${g.k}','fg',this.value)">
        </div>
      </div>
    </div>
  \`).join('')
}

function onGradeColor(g, type, val) {
  theme['grade'+g+(type==='bg'?'Bg':'Fg')] = val
  const prev = document.getElementById('grade-preview-'+g)
  if (prev) {
    prev.style.background = theme['grade'+g+'Bg']||DEFAULT_THEME['grade'+g+'Bg']
    prev.style.color      = theme['grade'+g+'Fg']||DEFAULT_THEME['grade'+g+'Fg']
  }
}

// ── 직책 색상 ──
function renderPositionColors() {
  const c = document.getElementById('position-color-list')
  c.innerHTML = positions.map(pos => \`
    <div class="color-row-item" id="pos-row-\${pos.id}">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
          id="pos-swatch-\${pos.id}" style="background:\${pos.color}">\${pos.name[0]}</div>
        <div>
          <div class="text-sm font-semibold text-slate-800">\${pos.name}</div>
          <div class="text-xs font-mono text-slate-400 mt-0.5" id="pos-hex-\${pos.id}">\${pos.color}</div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex gap-1.5 flex-wrap max-w-[160px]">
          \${QUICK_COLORS.slice(0,8).map(c => \`
            <button class="quick-dot" style="background:\${c};border-color:\${pos.color===c?'#1e293b':'transparent'}"
              onclick="quickPos(\${pos.id},'\${c}')" title="\${c}"></button>
          \`).join('')}
        </div>
        <input type="color" class="color-picker-inline" value="\${pos.color}"
          id="pos-input-\${pos.id}" onchange="savePos(\${pos.id},this.value)"
          oninput="livePos(\${pos.id},this.value)">
      </div>
    </div>
  \`).join('')
}

function livePos(id, val) {
  const sw = document.getElementById('pos-swatch-'+id); if(sw) sw.style.background = val
  const hx = document.getElementById('pos-hex-'+id);   if(hx) hx.textContent = val
  const pos = positions.find(p=>p.id===id); if(pos) pos.color = val
}

async function quickPos(id, color) {
  const pos = positions.find(p=>p.id===id); if(!pos) return
  await fetch('/api/positions/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:pos.name,color})})
  pos.color = color; showToast(pos.name+' 색상 저장 ✓'); await loadPositions(); renderPositionColors()
}

async function savePos(id, color) {
  const pos = positions.find(p=>p.id===id); if(!pos) return
  await fetch('/api/positions/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:pos.name,color})})
  showToast(pos.name+' 색상 저장 ✓'); await loadPositions(); renderPositionColors()
}

// ── 평가 영역 색상 ──
function renderCategoryColors() {
  const c = document.getElementById('category-color-list')
  c.innerHTML = categories.map(cat => \`
    <div class="color-row-item">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          id="cat-swatch-\${cat.id}" style="background:\${cat.color}18;border:2px solid \${cat.color}">
          <i class="fas fa-layer-group text-xs" style="color:\${cat.color}"></i>
        </div>
        <div>
          <div class="text-sm font-semibold text-slate-800">\${cat.name}</div>
          <div class="text-xs text-slate-400 mt-0.5"><span class="font-mono" id="cat-hex-\${cat.id}">\${cat.color}</span> · \${cat.max_score}점</div>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <div class="flex gap-1.5 flex-wrap max-w-[160px]">
          \${QUICK_COLORS.slice(0,8).map(c => \`
            <button class="quick-dot" style="background:\${c};border-color:\${cat.color===c?'#1e293b':'transparent'}"
              onclick="quickCat(\${cat.id},'\${c}')" title="\${c}"></button>
          \`).join('')}
        </div>
        <input type="color" class="color-picker-inline" value="\${cat.color}"
          id="cat-input-\${cat.id}" onchange="saveCat(\${cat.id},this.value)"
          oninput="liveCat(\${cat.id},this.value)">
      </div>
    </div>
  \`).join('')
}

function liveCat(id, val) {
  const sw = document.getElementById('cat-swatch-'+id)
  if (sw) { sw.style.background=val+'18'; sw.style.borderColor=val; sw.querySelector('i').style.color=val }
  const hx = document.getElementById('cat-hex-'+id); if(hx) hx.textContent = val
  const cat = categories.find(c=>c.id===id); if(cat) cat.color = val
}

async function quickCat(id, color) {
  const cat = categories.find(c=>c.id===id); if(!cat) return
  await fetch('/api/categories/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:cat.name,max_score:cat.max_score,sort_order:cat.sort_order,color})})
  cat.color = color; showToast(cat.name+' 색상 저장 ✓'); await loadCategories(); renderCategoryColors()
}

async function saveCat(id, color) {
  const cat = categories.find(c=>c.id===id); if(!cat) return
  await fetch('/api/categories/'+id, {method:'PUT',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({name:cat.name,max_score:cat.max_score,sort_order:cat.sort_order,color})})
  showToast(cat.name+' 색상 저장 ✓'); await loadCategories(); renderCategoryColors()
}

// ── 저장 / 초기화 ──
function saveTheme() {
  previewTheme()
  localStorage.setItem('lingo_theme', JSON.stringify(theme))
  showToast('테마 색상이 저장되었습니다 ✓')
  renderPresets()
}

function resetTheme() {
  if (!confirm('테마를 기본값으로 초기화하시겠습니까?')) return
  theme = { ...DEFAULT_THEME }
  localStorage.removeItem('lingo_theme')
  renderPresets(); renderPickers(); renderGradeColors()
  applyPreviewStyle()
  showToast('테마가 기본값으로 초기화되었습니다')
}

// ── Toast ──
let _tt = null
function showToast(msg, err=false) {
  const el=document.getElementById('toast'), ic=document.getElementById('toast-icon'), tx=document.getElementById('toast-msg')
  tx.textContent=msg; ic.className='fas '+(err?'fa-exclamation-circle text-red-400':'fa-check-circle text-emerald-400')
  el.classList.remove('hidden'); el.style.opacity='1'
  if(_tt) clearTimeout(_tt); _tt=setTimeout(()=>{ el.style.opacity='0'; setTimeout(()=>el.classList.add('hidden'),300) },2800)
}

init()
</script>
</body>
</html>`
}

export default app
