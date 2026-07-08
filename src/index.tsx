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

app.post('/api/items', async (c) => {
  const { category_id, position_id, item_name, criteria, max_score, sort_order } = await c.req.json()
  const r = await c.env.DB.prepare(
    'INSERT INTO eval_items (category_id, position_id, item_name, criteria, max_score, sort_order) VALUES (?,?,?,?,?,?)'
  ).bind(category_id, position_id || null, item_name, criteria || '', max_score || 5, sort_order || 99).run()
  return c.json({ id: r.meta.last_row_id })
})

app.put('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  const { category_id, position_id, item_name, criteria, max_score, sort_order, is_active } = await c.req.json()
  await c.env.DB.prepare(
    'UPDATE eval_items SET category_id=?, position_id=?, item_name=?, criteria=?, max_score=?, sort_order=?, is_active=? WHERE id=?'
  ).bind(category_id, position_id || null, item_name, criteria, max_score, sort_order, is_active ?? 1, id).run()
  return c.json({ ok: true })
})

app.delete('/api/items/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.prepare('UPDATE eval_items SET is_active=0 WHERE id=?').bind(id).run()
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
  const periodId = c.req.query('period_id') || '1'

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

  return c.json({ summary, byCategory, byPosition, managerCategory })
})

// ===================== STATIC & HTML =====================
app.get('/', (c) => {
  return c.html(getIndexHtml())
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
</style>
</head>
<body class="bg-slate-50 min-h-screen">

<!-- 사이드바 -->
<div class="fixed left-0 top-0 h-full w-64 bg-gradient-to-b from-indigo-900 to-indigo-800 text-white z-50 flex flex-col">
  <div class="p-5 border-b border-indigo-700">
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 bg-white/20 rounded-lg flex items-center justify-center">
        <i class="fas fa-chart-line text-white"></i>
      </div>
      <div>
        <div class="text-sm font-bold leading-tight">링고 고객센터</div>
        <div class="text-xs text-indigo-300">관리자 평가 시스템</div>
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
    <div class="pt-3 pb-1">
      <div class="text-xs text-indigo-400 uppercase tracking-wider px-3">관리</div>
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
  <div class="p-4 border-t border-indigo-700">
    <div id="period-selector" class="text-xs text-indigo-300"></div>
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
        <button onclick="showItemModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 text-sm transition">
          <i class="fas fa-plus mr-2"></i>항목 추가
        </button>
      </div>
      <div id="items-list"></div>
    </div>

    <!-- 평가 기간 관리 페이지 -->
    <div id="page-periods" class="page-content hidden">
      <div id="periods-list" class="grid grid-cols-3 gap-4"></div>
    </div>
  </div>
</div>

<!-- 관리자 추가/수정 모달 -->
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
    </div>
    <input type="hidden" id="item-edit-id">
    <div class="flex gap-2 mt-5">
      <button onclick="saveItem()" class="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-sm hover:bg-indigo-700 transition">저장</button>
      <button onclick="closeModal('modal-item')" class="flex-1 bg-slate-100 text-slate-600 py-2 rounded-lg text-sm hover:bg-slate-200 transition">취소</button>
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
  charts: {}
}

// ============================================================
// 초기화
// ============================================================
async function init() {
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
    \`<option value="\${p.id}">\${p.label}</option>\`
  ).join('')
  if (state.periods.length > 0) {
    state.currentPeriodId = state.periods[0].id
    sel.value = state.currentPeriodId
  }
  const sideLabel = document.getElementById('period-selector')
  if (sideLabel && state.periods.length > 0) {
    sideLabel.textContent = state.periods[0].label
  }
}

function onPeriodChange() {
  state.currentPeriodId = document.getElementById('global-period').value
  const period = state.periods.find(p => p.id == state.currentPeriodId)
  if (period) {
    const sideLabel = document.getElementById('period-selector')
    if (sideLabel) sideLabel.textContent = period.label
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
    periods: ['평가 기간 관리', '월별 평가 기간을 관리하세요']
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
}

// ============================================================
// 대시보드
// ============================================================
async function loadDashboard() {
  if (!state.currentPeriodId) return
  const data = await api('/dashboard?period_id=' + state.currentPeriodId)
  if (!data) return
  
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
  const posFilter = document.getElementById('items-position-filter').value
  const filterSel = document.getElementById('items-position-filter')
  if (filterSel.options.length === 1) {
    filterSel.innerHTML = '<option value="">전체</option>' +
      state.positions.map(p => \`<option value="\${p.id}">\${p.name}</option>\`).join('')
  }
  
  const url = posFilter ? '/items?position_id=' + posFilter : '/items'
  const items = await api(url)
  if (!items) return
  
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
            <th class="text-center py-2 px-2 w-20">작업</th>
          </tr>
        </thead>
        <tbody>
          \${cat.items.map(item => \`
            <tr class="border-b border-slate-50 hover:bg-slate-50">
              <td class="py-2.5 px-2 font-medium text-slate-700">\${item.item_name}</td>
              <td class="py-2.5 px-2 text-xs text-slate-500">\${item.criteria || ''}</td>
              <td class="py-2.5 px-2 text-center text-slate-600">\${item.max_score}</td>
              <td class="py-2.5 px-2 text-center">
                \${item.position_name
                  ? \`<span class="px-2 py-0.5 rounded-full text-xs" style="background:\${item.category_color}22;color:\${item.category_color}">\${item.position_name}</span>\`
                  : '<span class="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-500">공통</span>'}
              </td>
              <td class="py-2.5 px-2 text-center">
                <div class="flex gap-1 justify-center">
                  <button onclick="showItemModal(\${item.id})" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-indigo-100 hover:text-indigo-600 transition">
                    <i class="fas fa-edit text-xs"></i>
                  </button>
                  <button onclick="deleteItem(\${item.id}, '\${item.item_name}')" class="w-7 h-7 rounded flex items-center justify-center text-slate-400 hover:bg-red-100 hover:text-red-600 transition">
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
  
  if (id) {
    // 해당 항목 데이터 로드 필요 - 현재는 페이지 아이템에서 가져옴
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
    document.getElementById('item-max-score').value = 5
    document.getElementById('item-sort').value = 99
  }
  document.getElementById('modal-item').classList.add('open')
}

async function saveItem() {
  const id = document.getElementById('item-edit-id').value
  const body = {
    category_id: document.getElementById('item-category').value,
    position_id: document.getElementById('item-position').value || null,
    item_name: document.getElementById('item-name').value.trim(),
    criteria: document.getElementById('item-criteria').value,
    max_score: parseInt(document.getElementById('item-max-score').value) || 5,
    sort_order: parseInt(document.getElementById('item-sort').value) || 99,
    is_active: 1
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
  await api('/items/' + id, { method: 'DELETE' })
  showToast('삭제 완료')
  loadItemsPage()
}

// ============================================================
// 평가 기간 관리 페이지
// ============================================================
async function loadPeriodsPage() {
  const container = document.getElementById('periods-list')
  container.innerHTML = state.periods.map(p => \`
    <div class="card p-5">
      <div class="flex items-center justify-between">
        <div>
          <div class="text-base font-bold text-slate-800">\${p.label}</div>
          <div class="text-xs text-slate-500 mt-1">\${p.year}년 \${p.month}월</div>
        </div>
        <div class="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center">
          <i class="fas fa-calendar text-indigo-600"></i>
        </div>
      </div>
    </div>
  \`).join('')
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

// 초기화
init()
</script>
</body>
</html>`
}

export default app
