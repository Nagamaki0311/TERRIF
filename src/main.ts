import './style.css';
import { GameAudio } from './audio.ts';
import { createGame, place, move, undo, depart, preview, canPlace, adjacent, cells, stations, eventDefinitions } from './game/index.ts';
import type { Cell, Evaluation, GameState, Passenger, Species, Wave } from './game/types.ts';

// ===== SECTION: Session and presentation state =====
const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = new GameAudio();
const portraits: Record<Species, string> = { 若人: 'young', 働人: 'worker', 老人: 'elder', 客人: 'tourist', 休人: 'rest' };
const speciesColors: Record<Species, string> = { 若人: '#dcae35', 働人: '#4382ae', 老人: '#9384a9', 客人: '#c87555', 休人: '#68a28f' };
const sprite = `${import.meta.env.BASE_URL}tokens.svg`;
let state: GameState = createGame('FIRST-TRAIN');
let selectedId: string | null = state.waiting[0]?.id ?? null;
let hoveredCell: string | null = null;
let forecast: Evaluation | null = null;
let zoom = false;
let modal: 'help' | 'catalog' | 'sound' | 'restart' | 'result' | null = null;
let search = '';
let catalogFilter = 'all';
let animating = false;
let activeWave: Wave | null = null;
let animationToken = 0;
let announcement = '';
let tutorialVisible = readStored('chaos-line.tutorial') !== 'done';
let touchPreviewCell: string | null = null;
let focusRequest: string | null = null;
let discovered = readDiscoveries();
let summary = { events: 0, rare: 0, maxChain: 0 };
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function readStored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Private browsing can disable storage. */ }
}
function readDiscoveries(): Set<string> {
  try { return new Set(JSON.parse(readStored('chaos-line.discovery') ?? '[]')); }
  catch { return new Set(); }
}
function escape(value: string | number): string {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}
function selected(): Passenger | undefined {
  return [...state.waiting, ...state.passengers].find(person => person.id === selectedId);
}
function personIcon(person: Passenger, className = ''): string {
  return `<svg class="portrait ${className}" viewBox="0 0 64 64" aria-hidden="true"><use href="${sprite}#${portraits[person.species]}"></use></svg>`;
}
function notify(message: string): void {
  announcement = message;
  const live = document.querySelector('#live');
  if (live) live.textContent = message;
}
function enableAudio(): void {
  void audio.unlock().catch(() => notify('音源の読み込みに失敗しました。音設定から再試行できます。'));
}
function currentLabel(): string {
  return state.finished ? '運行終了' : `${state.station + 1} / 15`;
}

// ===== SECTION: Main interface =====
function render(): void {
  const active = document.activeElement as HTMLElement | null;
  const activeSelector = active?.dataset.person ? `[data-person="${active.dataset.person}"]` : active?.dataset.cell ? `[data-cell="${active.dataset.cell}"]` : active?.dataset.action ? `[data-action="${active.dataset.action}"]` : null;
  const scroll = document.querySelector('.board-scroll');
  const scrollLeft = scroll?.scrollLeft ?? 0;
  const queueScroll = document.querySelector('.passenger-queue')?.scrollLeft ?? 0;
  const person = selected();
  const isExisting = !!person?.cellId;
  const evaluation = forecast ?? state.lastEvaluation ?? preview(state);
  const onboardCount = state.passengers.length;
  app.innerHTML = `<main class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="満員電車 ホーム"><span class="brand-mark">満</span><span><h1>満員電車</h1><small>CHAOS LINE</small></span></a>
      <nav class="toolbar" aria-label="ゲームメニュー">
        <button data-action="help">遊び方</button><button data-action="catalog">トラブル図鑑 <span class="count">${discovered.size}/60</span></button>
        <button data-action="sound" aria-label="音の設定">${audio.muted ? '音 OFF' : '音 ON'}</button><button data-action="restart">新しい運行</button>
      </nav>
    </header>
    <section class="masthead" aria-label="運行状況">
      <div class="stats"><div class="stat score"><span>カオススコア</span><strong>${state.score.toLocaleString()}</strong></div><div class="stat"><span>混雑率</span><strong>${Math.round(onboardCount / 64 * 100)}<small>%</small></strong></div><div class="stat discovery"><span>乗車中</span><strong>${onboardCount}<small>人</small></strong></div></div>
    </section>
    ${tutorialVisible ? `<div class="tutorial-note"><p>駒を選んで車内へ配置。ストレスの連鎖から、さまざまなトラブルを仕掛けよう。</p><button data-action="dismiss-tutorial" aria-label="案内を閉じる">×</button></div>` : ''}
    <div class="game-layout"><div class="main-panel">
      <section class="station-strip" aria-label="現在駅と次駅"><div><span>ただいま</span><strong>${stations[state.station]}</strong></div><b class="station-arrow" aria-hidden="true">→</b><div class="station-next"><span>つぎは</span><strong>${stations[Math.min(14, state.station + 1)]}</strong></div><b class="station-count">${currentLabel()}</b></section>
      <div class="route" aria-label="15駅の進行">${stations.map((name, index) => `<span class="route-stop ${index < state.station ? 'passed' : ''} ${index === state.station ? 'current' : ''}" title="${index + 1} ${name}"><i></i>${index === state.station ? `<b>${index + 1}</b>` : ''}</span>`).join('')}</div>
      <section class="board-panel" aria-label="車両の配置盤面"><div class="board-top"><h2>1号車 <span>南側4扉から乗降</span></h2><div class="board-tools"><button data-action="zoom" aria-pressed="${zoom}">${zoom ? '全体を見る −' : '拡大して操作 ＋'}</button><span class="board-direction">北 ↑</span></div></div>
        <div class="board-scroll">${renderBoard()}</div>
        <div class="board-bottom"><p>${state.finished ? '運行は終了しました。結果と発見したトラブルを確認できます。' : animating ? '連鎖を再生しています。' : isExisting ? `既存の駒を移動できます。残り${state.movesLeft}回。` : selectedId ? '空いている区画を選んで配置。扉際には3人まで入れます。' : '乗車待ちの駒、または車内の駒を選んでください。'}</p><span>再配置 <b>${state.movesLeft}</b> / 2</span></div>
        <div class="legend"><span><i class="seat-key"></i>座席</span><span><i class="priority-key"></i>優先席</span><span><i class="stand-key"></i>立席</span><span><i class="door-key"></i>扉際 0–3人</span><span><i class="stress-key"></i>80で発火</span></div>
      </section>
      <section class="queue-panel" aria-label="乗車待ち"><div class="section-line"><h2>乗車待ち <span>${state.waiting.length}人</span></h2><p>全員配置して、発車</p></div><div class="passenger-queue">${state.waiting.length ? state.waiting.map(renderPassengerCard).join('') : `<div class="empty-queue">${state.finished ? '今回の運行は終了しました。' : '配置完了。発車して連鎖を確定できます。'}</div>`}</div></section>
    </div><aside class="sidebar" aria-label="選択と予告">
      <section class="selection-panel"><p class="eyebrow">${person ? (isExisting ? '車内の駒' : '選択中の駒') : '駒の詳細'}</p>${person ? renderPersonDetail(person) : '<h2 class="selected-name">駒を選ぶ</h2><p class="muted">種族・年代・降車駅を見て、連鎖の起点を考えよう。</p>'}</section>
      <section class="preview-panel"><div class="section-line"><h2>${forecast ? 'この配置の予告' : state.lastEvaluation ? '直前の連鎖' : '現在の連鎖予告'}</h2>${forecast ? '<span>未確定</span>' : ''}</div><strong class="preview-score">+${(evaluation?.score ?? 0).toLocaleString()}<small>CHAOS</small></strong><p class="preview-caption">${evaluation ? `${evaluation.maxChain}段階 · ${evaluation.events.length}件 · ${new Set(evaluation.events.map(event => event.type)).size}種類` : '空き区画にカーソルを合わせると予告'}</p><ul class="preview-events">${evaluation?.events.length ? evaluation.events.slice(0, 5).map(event => `<li class="${event.rare ? 'rare' : ''}"><span>${escape(event.name)}</span><b>基本 ${event.points}</b></li>`).join('') : '<li class="muted">トラブル成立でスコア獲得</li>'}${(evaluation?.events.length ?? 0) > 5 ? `<li class="muted">ほか${evaluation!.events.length - 5}件</li>` : ''}</ul>${evaluation ? renderWaveBreakdown(evaluation) : ''}</section>
      <div class="sidebar-actions"><button class="depart-button" data-action="depart" ${state.waiting.length || animating || state.finished ? 'disabled' : ''}><span>${state.finished ? '運行終了' : '発車する'}</span><b aria-hidden="true">→</b></button><button class="undo-button" data-action="undo" ${!state.history.length || animating || state.finished ? 'disabled' : ''}>一手戻す</button>${state.finished ? '<button class="result-button" data-action="result">運行結果を見る</button>' : ''}</div>
      <section class="forecast"><h3>次駅の乗車予告</h3><strong>${state.schedule[Math.min(14, state.station + 1)].length}<small>人</small></strong><p>${nextComposition()}</p></section>
    </aside></div>
    <footer class="footer"><span>SEED <b>${escape(state.seed)}</b></span><span>一般席42 / 優先席12 / 通常立席54 / 扉際8</span><span>架空の車両・路線を使ったゲームです</span></footer>
    <div id="live" class="sr-only" aria-live="polite">${escape(announcement)}</div>
    ${animating ? `<div class="wave-overlay" role="status"><div><span>STRESS REACTION</span><strong>${activeWave ? `CHAIN ${activeWave.index}` : '出発進行'}</strong></div><div><b>${activeWave?.events.length ?? 0} EVENTS</b><button data-action="skip">結果へ進む</button></div></div>` : ''}
    ${modal ? renderModal() : ''}
  </main>`;
  document.querySelector('.board-scroll')!.scrollLeft = scrollLeft;
  document.querySelector('.passenger-queue')!.scrollLeft = queueScroll;
  bindEvents();
  const restore = focusRequest ?? activeSelector;
  if (restore) app.querySelector<HTMLElement>(restore)?.focus({ preventScroll: true });
  focusRequest = null;
}
function renderWaveBreakdown(evaluation: Evaluation): string {
  const scoringWaves = evaluation.waves.filter(wave => wave.score > 0);
  if (!scoringWaves.length) return '';
  return `<details class="score-breakdown"><summary>実加点の内訳</summary>${scoringWaves.map(wave => `<div><span>第${wave.index}段階 · ${wave.events.length}件 / ${new Set(wave.events.map(event => event.type)).size}種類</span><b>+${wave.score}</b></div>`).join('')}<p>種別基本点に、同時件数・異種数・深さの倍率を適用。特殊イベントは固定点です。</p></details>`;
}
function nextComposition(): string {
  const people = state.schedule[Math.min(14, state.station + 1)];
  return Object.keys(portraits).map(species => { const count = people.filter(person => person.species === species).length; return count ? `${species} ${count}` : ''; }).filter(Boolean).join(' · ') || '終着駅では全員降車';
}
function renderPassengerCard(person: Passenger): string {
  return `<button class="passenger-card ${person.id === selectedId ? 'selected' : ''}" data-person="${person.id}" aria-pressed="${person.id === selectedId}" style="--species:${speciesColors[person.species]}">${personIcon(person)}<span class="passenger-name">${person.species}<small>${person.age}代</small></span><span class="passenger-trip">${stations[person.destination]}で降車</span><span class="passenger-stress"><i style="width:${person.stress}%"></i></span><span class="card-tags"><span>ST ${person.stress}</span><span>${person.luggage ? '荷物' : ''}${person.sensitivity >= 4 ? ' 着席優先' : ''}</span></span></button>`;
}
const activityLabels: Record<Passenger['activity'], string> = { none: '特になし', screen: '画面を見る', call: '通話', talk: '会話', read: '読書', food: '飲食' };
const postureLabels: Record<Passenger['posture'], string> = { normal: '通常姿勢', wide: '広がった姿勢', lean: '寄り掛かり' };
const attentionLabels: Record<Passenger['attention'], string> = { aware: '周囲を見る', absorbed: '没頭', asleep: '居眠り' };
const bagLabels: Record<Passenger['belongings'], string> = { none: '荷物なし', backpack: 'リュック', hand: '手提げ', wheeled: '車輪付き荷物' };
function renderPersonDetail(person: Passenger): string {
  return `<div class="person-detail-heading">${personIcon(person)}<h2>${person.species}<small>${person.age}代</small></h2></div><div class="stress-detail"><span>ストレス <b>${person.stress}</b> / 100</span><i><b style="width:${person.stress}%"></b></i></div><dl class="person-properties"><div><dt>降車</dt><dd>${stations[person.destination]}</dd></div><div><dt>立席感度</dt><dd>${person.sensitivity}${person.sensitivity >= 4 ? ' · 着席優先' : ''}</dd></div><div><dt>荷物</dt><dd>${bagLabels[person.belongings]}</dd></div><div><dt>行動</dt><dd>${activityLabels[person.activity]}${person.audio === 'leak' ? ' · 音漏れ' : ''}</dd></div><div><dt>状態</dt><dd>${postureLabels[person.posture]} · ${attentionLabels[person.attention]}</dd></div>${person.group ? `<div><dt>同行組</dt><dd>${escape(person.group)}</dd></div>` : ''}</dl>`;
}

// ===== SECTION: Coordinate-based SVG train =====
function renderBoard(): string {
  const people = animating && state.lastEvaluation ? state.lastEvaluation.passengers : state.passengers;
  const boardCells = cells.map(cell => renderCell(cell, people)).join('');
  const links = activeWave ? activeWave.sources.flatMap(id => {
    const source = people.find(person => person.id === id);
    if (!source?.cellId) return [];
    const from = cells.find(cell => cell.id === source.cellId)!;
    return activeWave!.receivers.map(receiverId => {
      const receiver = people.find(person => person.id === receiverId);
      if (!receiver?.cellId) return '';
      const to = cells.find(cell => cell.id === receiver.cellId)!;
      if (!adjacent(from.id, to.id)) return '';
      return `<path class="chain-line" d="M${from.x + from.width / 2},${rowY(from.row) + 280}L${to.x + to.width / 2},${rowY(to.row) + 280}"/>`;
    });
  }).join('') : '';
  return `<svg class="train-board ${zoom ? 'zoomed' : ''}" viewBox="0 0 20000 3900" role="group" aria-label="北座席、北立席、南立席、南座席の4層。扉際は3人まで。"><rect class="train-outline" x="300" y="250" width="19400" height="3300" rx="250"/><path class="center-line" d="M1000 1900H19000"/>
    <text class="row-label" x="820" y="950">座</text><text class="row-label" x="820" y="1600">立</text><text class="row-label" x="820" y="2250">立</text><text class="row-label" x="820" y="2900">座</text>
    ${[2570, 7090, 11610, 16130].map((x, index) => `<path class="closed-door" d="M${x} 340H${x + 1300}M${x + 650} 320V470"/><text class="door-caption" x="${x + 650}" y="215">閉鎖</text><path class="open-door" d="M${x} 3400H${x + 1300}"/><text class="door-caption south" x="${x + 650}" y="3780">↓ 乗降口 ${index + 1}</text>`).join('')}
    ${boardCells}${links}<text class="coupling" x="540" y="2020">連結部</text><text class="coupling" x="19350" y="2020">連結部</text></svg>`;
}
function rowY(row: number): number { return 620 + row * 650; }
function renderCell(cell: Cell, people: Passenger[]): string {
  const occupants = people.filter(person => person.cellId === cell.id);
  const person = selected();
  const available = !animating && !state.finished && !!person && (person.cellId ? state.movesLeft > 0 && cell.id !== person.cellId && occupants.length < cell.capacity : canPlace(state, person.id, cell.id));
  const highlighted = cell.id === hoveredCell;
  const personSelected = occupants.some(person => person.id === selectedId);
  const description = `${cell.row < 2 ? '北' : '南'}側 ${cell.kind === 'seat' ? cell.priority ? '優先席' : '座席' : cell.kind === 'door' ? '扉際' : '立席'} ${occupants.length}/${cell.capacity}人${available ? ' 配置可能' : ''}${occupants.length ? '。' + occupants.map(occupant => `${occupant.species}${occupant.age}代 ストレス${occupant.stress}`).join('、') : ''}`;
  const portraitsSvg = occupants.map((occupant, index) => {
    const tokenWidth = cell.kind === 'door' ? 410 : 400;
    const x = cell.x + (cell.width - occupants.length * tokenWidth) / 2 + index * tokenWidth;
    const stress = activeWave?.stress[occupant.id] ?? occupant.stress;
    const flaring = activeWave?.sources.includes(occupant.id) || activeWave?.triggered.includes(occupant.id);
    return `<g class="person ${flaring ? 'is-flaring' : ''} ${selectedId === occupant.id ? 'is-selected' : ''}" data-person="${occupant.id}" aria-label="${occupant.species} ${occupant.age}代 ストレス${stress} ${stations[occupant.destination]}で降車"><rect class="person-selection" x="${x - 12}" y="${rowY(cell.row) + 8}" width="${tokenWidth + 24}" height="530" rx="45"/><svg x="${x}" y="${rowY(cell.row) + 25}" width="${tokenWidth}" height="400" viewBox="0 0 64 64"><use href="${sprite}#${portraits[occupant.species]}"></use></svg><rect class="stress-track" x="${x + 30}" y="${rowY(cell.row) + 450}" width="340" height="38"/><rect class="stress-fill ${stress >= 80 ? 'hot' : ''}" x="${x + 30}" y="${rowY(cell.row) + 450}" width="${3.4 * stress}" height="38"/>${occupant.luggage ? `<text class="person-badge" x="${x + 345}" y="${rowY(cell.row) + 110}">荷</text>` : ''}${occupant.destination === state.station + 1 ? `<text class="person-next" x="${x + 55}" y="${rowY(cell.row) + 110}">↓</text>` : ''}</g>`;
  }).join('');
  return `<g class="cell ${cell.kind} ${cell.priority ? 'priority' : ''} ${available ? 'available' : ''} ${highlighted ? 'hovered' : ''} ${personSelected ? 'selected-cell' : ''}" data-cell="${cell.id}" role="button" tabindex="${cell.id === (hoveredCell ?? cells[0].id) ? '0' : '-1'}" aria-label="${description}"><title>${description}</title><rect class="cell-shape" x="${cell.x + 15}" y="${rowY(cell.row)}" width="${cell.width - 30}" height="560" rx="${cell.kind === 'seat' ? 55 : 15}"/>${!occupants.length && cell.priority ? `<text class="priority-symbol" x="${cell.x + cell.width / 2}" y="${rowY(cell.row) + 350}">優</text>` : ''}${!occupants.length && cell.kind === 'door' ? `<text class="door-capacity" x="${cell.x + cell.width / 2}" y="${rowY(cell.row) + 340}">0 / 3</text>` : ''}${portraitsSvg}</g>`;
}

// ===== SECTION: Input, preview and deterministic animation =====
function bindEvents(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action!)));
  app.querySelectorAll<HTMLElement>('[data-person]').forEach(element => element.addEventListener('click', event => {
    event.stopPropagation();
    if (animating || state.finished) return;
    selectedId = element.dataset.person!;
    touchPreviewCell = null;
    hoveredCell = null;
    forecast = null;
    enableAudio();
    render();
  }));
  app.querySelectorAll<SVGGElement>('[data-cell]').forEach(element => {
    element.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') setPreview(element.dataset.cell!); });
    element.addEventListener('click', event => chooseCell(element.dataset.cell!, event instanceof PointerEvent && event.pointerType === 'touch'));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseCell(element.dataset.cell!); }
      if (event.key === 'Escape') { selectedId = null; forecast = null; render(); }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); moveFocus(element.dataset.cell!, event.key); }
    });
  });
  const searchInput = app.querySelector<HTMLInputElement>('#catalog-search');
  searchInput?.addEventListener('input', () => { search = searchInput.value; updateCatalogList(); });
  app.querySelector<HTMLSelectElement>('#catalog-filter')?.addEventListener('change', event => { catalogFilter = (event.target as HTMLSelectElement).value; updateCatalogList(); });
  app.querySelector<HTMLInputElement>('#music-toggle')?.addEventListener('change', event => { enableAudio(); audio.setMusicEnabled((event.target as HTMLInputElement).checked); });
  app.querySelector<HTMLInputElement>('#mute-toggle')?.addEventListener('change', event => { enableAudio(); audio.setMuted(!(event.target as HTMLInputElement).checked); });
  app.querySelector<HTMLInputElement>('#volume')?.addEventListener('input', event => { enableAudio(); audio.setVolume(Number((event.target as HTMLInputElement).value)); });
  app.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  app.querySelector<HTMLFormElement>('#restart-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const input = app.querySelector<HTMLInputElement>('#seed-input')!;
    restart(input.value.trim() || 'FIRST-TRAIN');
  });
}
function setPreview(cellId: string): void {
  if (animating || state.finished || !selected()) return;
  hoveredCell = cellId;
  const person = selected()!;
  forecast = canPlace(state, person.id, cellId) ? preview(state, person.id, cellId) : null;
  updatePreviewPanel();
  app.querySelectorAll('[data-cell]').forEach(element => element.classList.toggle('hovered', (element as HTMLElement).dataset.cell === cellId));
}
function updatePreviewPanel(): void {
  const panel = app.querySelector('.preview-panel');
  if (!panel) return;
  panel.innerHTML = `<div class="section-line"><h2>この配置の予告</h2><span>未確定</span></div><strong class="preview-score">+${(forecast?.score ?? 0).toLocaleString()}<small>CHAOS</small></strong><p class="preview-caption">${forecast ? `${forecast.maxChain}段階 · ${forecast.events.length}件 · ${new Set(forecast.events.map(event => event.type)).size}種類` : 'この区画には配置できません'}</p><ul class="preview-events">${forecast?.events.length ? forecast.events.slice(0, 5).map(event => `<li class="${event.rare ? 'rare' : ''}"><span>${escape(event.name)}</span><b>基本 ${event.points}</b></li>`).join('') : '<li class="muted">条件を重ねてトラブルを仕掛けよう</li>'}</ul>${forecast ? renderWaveBreakdown(forecast) : ''}`;
}
function chooseCell(cellId: string, isTouch = false): void {
  if (animating || state.finished) return;
  const person = selected();
  if (!person) {
    const occupant = state.passengers.find(passenger => passenger.cellId === cellId);
    if (occupant) { selectedId = occupant.id; render(); }
    else notify('先に乗客を選んでください。');
    return;
  }
  if (person.cellId === cellId) {
    const occupants = state.passengers.filter(passenger => passenger.cellId === cellId);
    selectedId = occupants[(occupants.findIndex(passenger => passenger.id === selectedId) + 1) % occupants.length].id;
    forecast = null;
    focusRequest = `[data-cell="${cellId}"]`;
    render();
    return;
  }
  if (isTouch && touchPreviewCell !== cellId && canPlace(state, person.id, cellId)) {
    touchPreviewCell = cellId;
    setPreview(cellId);
    const instruction = app.querySelector('.board-bottom p');
    if (instruction) instruction.textContent = '予告を確認して、同じ区画をもう一度タップすると配置します。';
    notify('予告を確認して、同じ区画をもう一度タップすると配置します。');
    return;
  }
  const next = person.cellId ? move(state, person.id, cellId) : place(state, person.id, cellId);
  if (next === state) { notify('この区画には配置できません。空き容量と移動回数を確認してください。'); return; }
  state = next;
  touchPreviewCell = null;
  forecast = null;
  hoveredCell = null;
  selectedId = state.waiting[0]?.id ?? null;
  focusRequest = selectedId ? `[data-person="${selectedId}"]` : `[data-cell="${cellId}"]`;
  enableAudio();
  audio.playPlacement();
  notify('配置しました。');
  render();
  if (state.finished) void animateEvaluation();
}
function moveFocus(cellId: string, key: string): void {
  const current = cells.find(cell => cell.id === cellId)!;
  const dx = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  const dy = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  const candidates = cells.filter(cell => dx ? cell.row === current.row && Math.sign(cell.x - current.x) === dx : cell.row === current.row + dy);
  candidates.sort((a, b) => Math.abs(a.x - current.x) - Math.abs(b.x - current.x));
  const next = candidates[0];
  if (!next) return;
  setPreview(next.id);
  app.querySelectorAll<HTMLElement>('[data-cell]').forEach(element => element.tabIndex = element.dataset.cell === next.id ? 0 : -1);
  app.querySelector<HTMLElement>(`[data-cell="${next.id}"]`)?.focus();
}
async function handleAction(action: string): Promise<void> {
  if (action === 'skip') { animationToken++; finishAnimation(); return; }
  if (action === 'close') { closeModal(); return; }
  if (action === 'dismiss-tutorial') { tutorialVisible = false; writeStored('chaos-line.tutorial', 'done'); render(); return; }
  if (action === 'depart') {
    if (state.waiting.length || animating || state.finished) return;
    enableAudio();
    state = depart(state);
    selectedId = state.waiting[0]?.id ?? null;
    forecast = null;
    hoveredCell = null;
    void animateEvaluation();
    return;
  }
  if (action === 'undo' && !animating) {
    touchPreviewCell = null;
    state = undo(state); selectedId = state.waiting[0]?.id ?? null; forecast = null; render(); return;
  }
  if (action === 'zoom') { zoom = !zoom; render(); return; }
  if (['help', 'catalog', 'sound', 'restart', 'result'].includes(action)) {
    if (animating) {
      animationToken++;
      finishAnimation();
    }
    modal = action as typeof modal;
    render();
    focusModal();
  }
}
async function animateEvaluation(): Promise<void> {
  const evaluation = state.lastEvaluation;
  if (!evaluation) { render(); return; }
  summary.events += evaluation.events.filter(event => !event.rare).length;
  summary.rare += evaluation.events.filter(event => event.rare).length;
  summary.maxChain = Math.max(summary.maxChain, evaluation.maxChain);
  evaluation.events.forEach(event => discovered.add(event.type));
  writeStored('chaos-line.discovery', JSON.stringify([...discovered]));
  animating = true;
  const token = ++animationToken;
  activeWave = null;
  render();
  const waves = evaluation.waves;
  const duration = reducedMotion.matches ? 60 : Math.min(240, 2800 / Math.max(1, waves.length));
  for (const wave of waves) {
    if (token !== animationToken) return;
    activeWave = wave;
    render();
    audio.playWave(wave.index, wave.events.length, wave.events.some(event => event.rare));
    await new Promise(resolve => setTimeout(resolve, duration));
  }
  if (token !== animationToken) return;
  await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : 350));
  if (token === animationToken) finishAnimation();
}
function finishAnimation(): void {
  animating = false;
  activeWave = null;
  audio.playFinish();
  if (state.finished) modal = 'result';
  render();
  if (modal) focusModal();
  notify(`連鎖が確定しました。カオススコア${state.score}。`);
}
function restart(seed: string): void {
  animationToken++;
  state = createGame(seed.slice(0, 80));
  summary = { events: 0, rare: 0, maxChain: 0 };
  selectedId = state.waiting[0]?.id ?? null;
  hoveredCell = null;
  forecast = null;
  animating = false;
  activeWave = null;
  modal = null;
  touchPreviewCell = null;
  enableAudio();
  render();
}

// ===== SECTION: Dialogs and event discovery =====
function renderModal(): string {
  let title = '';
  let body = '';
  if (modal === 'help') {
    title = '連鎖を仕掛ける';
    body = `<div class="help-grid"><section><h3>配置 → 予告 → 発車</h3><p>待機列から駒を選び、空き区画へ配置。カーソルを合わせると次の発車で起こる反応を予告します。全員を配置したら発車できます。</p></section><section><h3>80から、周囲へ伝播</h3><p>立席や過密でストレスが蓄積。80以上の駒は隣接する駒へ25を伝えます。誘爆から条件が揃うとトラブルが発生します。</p></section><section><h3>種類と同時成立が得点に</h3><p>ストレス自体は無得点。荷物、姿勢、行動、降車予定を組み合わせ、異なるトラブルを同時に成立させよう。珍しい特殊イベントもあります。</p></section><section><h3>空間と乗降を読む</h3><p>通常区画は1人、扉際は3人まで。既存の駒は各駅2回まで移動可能。15駅の終着、または混雑率200%で運行終了です。</p></section></div><div class="help-callout">駒の見分け方 ${Object.keys(portraits).map(species => `<span class="help-species">${personIcon({ species } as Passenger)}${species}</span>`).join('')}<p>顔と衣服が種族、年代と特性は選択詳細、下のバーがストレス。荷＝荷物、↓＝次駅で降車。</p></div><p class="dialog-note">キーボードはTabで領域移動、盤面では矢印で移動、Enterで配置、Escで選択解除。選択解除後に車内区画をEnterで選択し、同じ区画でEnterを繰り返すと乗客を切り替えます。図鑑から60種類の条件を確認できます。</p>`;
  } else if (modal === 'catalog') {
    title = 'トラブル図鑑';
    body = `<p class="dialog-note">通常50種・特殊10種。連鎖で新たに80へ達した当事者が、成立の起点になります。</p><div class="catalog-controls"><input id="catalog-search" placeholder="名前・条件で探す" aria-label="トラブルを検索" value="${escape(search)}"><select id="catalog-filter" aria-label="図鑑の絞り込み"><option value="all" ${catalogFilter === 'all' ? 'selected' : ''}>すべて</option><option value="normal" ${catalogFilter === 'normal' ? 'selected' : ''}>通常</option><option value="rare" ${catalogFilter === 'rare' ? 'selected' : ''}>特殊</option><option value="found" ${catalogFilter === 'found' ? 'selected' : ''}>発見済み</option><option value="new" ${catalogFilter === 'new' ? 'selected' : ''}>未発見</option></select></div><div class="catalog-list">${catalogCards()}</div>`;
  } else if (modal === 'sound') {
    title = 'サウンド';
    body = `<p class="dialog-note">オリジナル16bit BGM「Night Express」。サンプル音色と車体の共鳴をイメージした効果音。</p><div class="sound-controls"><label>音を有効にする<input id="mute-toggle" type="checkbox" ${audio.muted ? '' : 'checked'}></label><label>BGM<input id="music-toggle" type="checkbox" ${audio.musicEnabled ? 'checked' : ''}></label><label>音量<input id="volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}"></label><button class="secondary-button" data-action="audio-retry">音源を再読み込み</button></div>`;
  } else if (modal === 'restart') {
    title = '新しい運行';
    body = `<form id="restart-form"><label class="field-label" for="seed-input">同じシードなら、同じ乗客と乗降を再現</label><input class="seed-input" id="seed-input" maxlength="80" value="${escape(state.seed)}"><div class="modal-actions"><button type="button" class="secondary-button" data-action="random-seed">別のシード</button><button class="primary-button" type="submit">このシードで始める</button></div></form>`;
  } else {
    title = state.finished === 'terminal' ? '終着、湊中央。' : state.finished === 'capacity' ? '混雑率200%に到達。' : '運行結果';
    body = `<div class="result-hero"><p class="eyebrow">FINAL CHAOS SCORE</p><strong>${state.score.toLocaleString()}</strong><p>${state.station + 1}駅目 · ${stations[state.station]}</p></div><div class="result-stats"><div><b>${summary.events}</b>通常トラブル</div><div><b>${summary.rare}</b>特殊イベント</div><div><b>${summary.maxChain}</b>最大連鎖</div><div><b>${state.discovered.length}</b>今回の発見</div></div><ul class="event-log">${state.lastEvaluation?.events.map(event => `<li><span>${escape(event.name)} ${event.rare ? '<b class="rare-mark">特殊</b>' : ''}</span><b>基本 ${event.points}</b></li>`).join('') ?? ''}</ul>${state.lastEvaluation ? renderWaveBreakdown(state.lastEvaluation) : ''}<p class="dialog-note">SEED ${escape(state.seed)}</p><div class="modal-actions"><button class="secondary-button" data-action="catalog">図鑑を見る</button><button class="primary-button" data-action="same-seed">同じシードで再挑戦</button></div>`;
  }
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-button" data-action="close" aria-label="閉じる">×</button></header>${body}</section></div>`;
}
function catalogCards(): string {
  const normalized = search.trim().toLocaleLowerCase();
  const filtered = eventDefinitions.filter(event => (!normalized || `${event.name} ${event.description}`.toLocaleLowerCase().includes(normalized)) && (catalogFilter === 'all' || catalogFilter === 'rare' && event.rare || catalogFilter === 'normal' && !event.rare || catalogFilter === 'found' && discovered.has(event.id) || catalogFilter === 'new' && !discovered.has(event.id)));
  return filtered.length ? filtered.map(event => `<article class="catalog-card ${event.rare ? 'rare' : ''} ${discovered.has(event.id) ? 'discovered' : ''}"><div class="catalog-card-top"><h3>${escape(event.name)}</h3><b>${event.points}</b></div><p>${escape(event.description)}</p><footer><span>${event.rare ? '特殊' : event.category}</span><span>${discovered.has(event.id) ? '発見済み' : '未発見'}</span></footer></article>`).join('') : '<p class="empty-catalog">条件に合うトラブルはありません。</p>';
}
function updateCatalogList(): void { const list = app.querySelector('.catalog-list'); if (list) list.innerHTML = catalogCards(); }
function closeModal(): void { modal = null; render(); app.querySelector<HTMLButtonElement>('[data-action="help"]')?.focus(); }
function focusModal(): void { app.querySelector<HTMLElement>('.modal button, .modal input')?.focus(); }
app.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'same-seed') restart(state.seed);
  if (action === 'random-seed') { const input = app.querySelector<HTMLInputElement>('#seed-input'); if (input) input.value = `TRAIN-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`; }
  if (action === 'audio-retry') enableAudio();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && modal) closeModal();
  if (event.key === 'Tab' && modal) {
    const elements = [...app.querySelectorAll<HTMLElement>('.modal button, .modal input, .modal select')];
    const first = elements[0], last = elements[elements.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.stop(); if (animating) { animationToken++; finishAnimation(); } }
});
render();
