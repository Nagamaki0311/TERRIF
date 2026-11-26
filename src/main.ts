import './style.css';
import { GameAudio } from './audio.ts';
import { createGame, place, move, undo, depart, choosePerk, perkChoices, sectorAt, exitPath, canPlace, adjacent, cells, stations, eventDefinitions, getCellUsage, getSpaceCapacity, capacity } from './game/index.ts';
import type { Cell, Evaluation, GameState, Passenger, Species, Wave } from './game/types.ts';

// ===== SECTION: Session and presentation state =====
const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = new GameAudio();
const portraits: Record<Species, string> = { 若人: 'young', 働人: 'worker', 老人: 'elder', 客人: 'tourist', 休人: 'rest' };
const speciesColors: Record<Species, string> = { 若人: '#dcae35', 働人: '#4382ae', 老人: '#9384a9', 客人: '#c87555', 休人: '#68a28f' };
const sprite = `${import.meta.env.BASE_URL}tokens.svg`;
const motionEpoch = performance.now();
function freshSeed(): string { return `TRAIN-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`; }
let state: GameState = createGame(freshSeed());
let selectedId: string | null = state.waiting[0]?.id ?? null;
let hoveredCell: string | null = null;
const boarding = new Map<string, { path: string; started: number; duration: number }>();
let zoom = false;
let modal: 'help' | 'catalog' | 'sound' | 'restart' | 'result' | null = null;
let search = '';
let catalogFilter = 'all';
let animating = false;
let activeWave: Wave | null = null;
let animationToken = 0;
let announcement = '';
let tutorialVisible = readStored('chaos-line.tutorial') !== 'done';

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
  return state.finished ? '運行終了' : `${state.station + 1} / ${stations.length}`;
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
  const onboardCount = state.passengers.length;
  app.innerHTML = `<main class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="満員電車 ホーム"><span class="brand-mark">満</span><span><h1>満員電車</h1></span></a>
      <nav class="toolbar" aria-label="ゲームメニュー">
        <button data-action="help" aria-label="遊び方"><span class="menu-long">遊び方</span><span class="menu-short">？</span></button><button data-action="catalog"><span class="menu-long">トラブル図鑑</span><span class="menu-short">図鑑</span> <span class="count">${discovered.size}/${eventDefinitions.length}</span></button>
        <button data-action="sound" aria-label="音の設定">${audio.muted ? '消音' : '音あり'}</button><button data-action="restart" aria-label="新しい運行"><span class="menu-long">新しい運行</span><span class="menu-short">再開</span></button>
      </nav>
    </header>
    <section class="masthead" aria-label="運行状況">
      <div class="stats"><div class="stat score"><span>カオススコア</span><strong>${state.score.toLocaleString()}</strong></div><div class="stat"><span>混雑率</span><strong>${Math.round(onboardCount / capacity * 100)}<small>%</small></strong></div><div class="stat discovery"><span>乗車中</span><strong>${onboardCount}<small>人</small></strong></div></div>
    </section>
    ${tutorialVisible ? `<div class="tutorial-note"><p>乗客を選び、空き区画へ配置してください。全員を配置すると発車できます。</p><button data-action="dismiss-tutorial" aria-label="案内を閉じる">×</button></div>` : ''}
    <div class="game-layout"><div class="main-panel">
      <section class="station-strip" aria-label="現在駅と次駅"><div><span>現在駅</span><strong>${stations[state.station]}</strong></div><b class="station-arrow" aria-hidden="true">→</b><div class="station-next"><span>次駅</span><strong>${stations[Math.min(stations.length - 1, state.station + 1)]}</strong></div><b class="station-count">${currentLabel()}</b></section>
      <div class="route" aria-label="${stations.length}駅の進行">${stations.map((name, index) => `<span class="route-stop ${index < state.station ? 'passed' : ''} ${index === state.station ? 'current' : ''}" title="${index + 1} ${name}"><i></i>${index === state.station ? `<b>${index + 1}</b>` : ''}</span>`).join('')}</div>
      <section class="board-panel" aria-label="車両の配置盤面"><div class="board-top"><h2>車内配置</h2><div class="board-tools"><div class="door-jumps" aria-label="扉付近へ移動">${[0, 1, 2, 3].map(door => `<button data-action="jump-${door}" aria-label="乗降口${door + 1}付近へ移動">扉${door + 1}</button>`).join('')}</div><button data-action="zoom" aria-pressed="${zoom}">${zoom ? '縮小 −' : '拡大 ＋'}</button><span class="board-direction">北 ↑</span></div></div>
        <div class="board-scroll">${renderBoard()}</div>
        <div class="board-bottom"><p>${state.finished ? '運行終了。結果を確認できます。' : animating ? '連鎖を再生中' : isExisting ? `移動先を選択してください。` : selectedId ? '空き区画を選択。扉際は2人推奨・3人まで。荷物は通路を0.5マス使います。' : '乗車待ち、または車内の乗客を選択してください。'}</p><span>再配置あと <b>${state.movesLeft}</b>回</span></div>
        <div class="legend"><span><i class="seat-key"></i>座席</span><span><i class="priority-key"></i>優先席</span><span><i class="stand-key"></i>立席</span><span><i class="door-key"></i>扉際 2.5マス・3人まで</span><span><i class="luggage-key"></i>荷物 0.5マス</span><span class="thermal-key"><i></i>ストレス　低～高</span></div>
      </section>
      <section class="queue-panel" aria-label="乗車待ち"><div class="section-line"><h2>乗車待ち <span>${state.waiting.length}人</span></h2></div><div class="passenger-queue">${state.waiting.length ? state.waiting.map(renderPassengerCard).join('') : `<div class="empty-queue">${state.finished ? '運行終了' : '配置完了。発車できます。'}</div>`}</div></section>
    </div><aside class="sidebar" aria-label="選択中の乗客と区間目標">
      <section class="selection-panel" aria-label="選択中の乗客">${person ? renderPersonDetail(person) : '<h2 class="selected-name">乗客を選択</h2><p class="muted">選択した乗客の属性を表示します。</p>'}</section>
      <section class="preview-panel objective-panel">${state.finished ? '' : '<h2>停車駅のバフ</h2>'}${renderObjective()}</section>
      <div class="sidebar-actions"><button class="depart-button" data-action="depart" ${state.waiting.length || animating || state.finished ? 'disabled' : ''}><span>${state.finished ? '運行終了' : '発車する'}</span><b aria-hidden="true">→</b></button><button class="undo-button" data-action="undo" ${!state.history.length || animating || state.finished ? 'disabled' : ''}>一手戻す</button>${state.finished ? '<button class="result-button" data-action="result">運行結果を見る</button>' : ''}</div>
      <section class="forecast"><h3>次駅の乗車</h3><strong>${state.schedule[Math.min(stations.length - 1, state.station + 1)].length}<small>人</small></strong><p>${nextComposition()}</p></section>
    </aside></div>
    <footer class="footer"><span>シード <b>${escape(state.seed)}</b></span></footer>
    <div id="live" class="sr-only" aria-live="polite">${escape(announcement)}</div>
    ${animating ? `<div class="wave-overlay" role="status"><div><strong>${activeWave?.index ? `${activeWave.index}連鎖` : '発火'}</strong></div><div>${activeWave?.events.length ? `<b class="wave-event">${escape((activeWave.events.find(event => event.rare) ?? activeWave.events[0]).name)}${activeWave.events.length > 1 ? ` ＋${activeWave.events.length - 1}件` : ''}</b>` : ''}${activeWave?.score ? `<strong class="wave-points">+${activeWave.score.toLocaleString()}点</strong>` : ''}<button data-action="skip">結果へ進む</button></div></div>` : ''}
    ${modal ? renderModal() : ''}
  </main>`;
  document.querySelector('.board-scroll')!.scrollLeft = scrollLeft;
  document.querySelector('.passenger-queue')!.scrollLeft = queueScroll;
  bindEvents();
  const restore = focusRequest ?? activeSelector;
  if (restore) app.querySelector<HTMLElement>(restore)?.focus({ preventScroll: true });
  focusRequest = null;
}
function renderObjective(): string {
  const previous = state.lastEvaluation;
  const result = previous ? `<details class="ride-result">
    <summary>前区間 ＋${previous.score.toLocaleString()}点</summary>
    <p>目標 ＋${previous.objectiveBonus ?? 0}点 · 分散 ＋${previous.routeBonus ?? 0}点</p>
    ${previous.events.length ? `<ul>${previous.events.map(event => `<li>${escape(event.name)}</li>`).join('')}</ul>` : ''}
  </details>` : '';
  if (state.finished) return result;
  const choice = state.perk
    ? `<p><strong>${state.perk.name} · 扉${state.perk.sector + 1}付近</strong></p><p>${state.perk.description}</p>`
    : `<div class="perk-choices">${perkChoices(state.seed, state.station).map(perk => `<button data-action="perk-${perk.id}"><strong>${perk.name}</strong><span>扉${perk.sector + 1}付近 · ${perk.description.replaceAll('指定エリアで', '').replaceAll('指定エリアの', '')}</span></button>`).join('')}</div>`;
  return `${choice}<p>目標エリアでトラブル成立 ＋400点 · 次駅の再配置＋1</p>${result}`;
}

function renderWaveBreakdown(evaluation: Evaluation): string {
  const scoringWaves = evaluation.waves.filter(wave => wave.score > 0);
  if (!scoringWaves.length) return '';
  return `<details class="score-breakdown"><summary>得点内訳</summary>${scoringWaves.map(wave => `<div><span>第${wave.index}段階 · ${wave.events.length}件 / ${new Set(wave.events.map(event => event.type)).size}種類</span><b>+${wave.score}</b></div>`).join('')}<p>通常イベントは件数・種類・連鎖数で加点。特殊イベントは固定点です。</p></details>`;
}
function nextComposition(): string {
  const people = state.schedule[Math.min(stations.length - 1, state.station + 1)];
  return Object.keys(portraits).map(species => { const count = people.filter(person => person.species === species).length; return count ? `${species} ${count}` : ''; }).filter(Boolean).join(' · ') || '終着駅では全員降車';
}
function renderPassengerCard(person: Passenger): string {
  return `<button class="passenger-card ${person.id === selectedId ? 'selected' : ''}" data-person="${person.id}" aria-pressed="${person.id === selectedId}" style="--species:${speciesColors[person.species]}">${personIcon(person)}<span class="passenger-name">${person.species}<small>${person.age}代</small></span><span class="passenger-trip">${stations[person.destination]}で降車</span><span class="passenger-stress"><i style="width:${person.stress}%"></i></span><span class="card-tags"><span>ストレス ${person.stress}</span><span>${person.luggage ? '荷物' : ''}${person.sensitivity >= 4 ? ' 着席優先' : ''}</span></span></button>`;
}
const activityLabels: Record<Passenger['activity'], string> = { none: '特になし', screen: '画面を見る', call: '通話', talk: '会話', read: '読書', food: '飲食' };
const postureLabels: Record<Passenger['posture'], string> = { normal: '通常姿勢', wide: '広がった姿勢', lean: '寄り掛かり' };
const attentionLabels: Record<Passenger['attention'], string> = { aware: '周囲を見る', absorbed: '没頭', asleep: '居眠り' };
const bagLabels: Record<Passenger['belongings'], string> = { none: '荷物なし', backpack: 'リュック', hand: '手提げ', wheeled: '車輪付き荷物' };
function renderPersonDetail(person: Passenger): string {
  return `<div class="person-detail-heading">${personIcon(person)}<h2>${person.species}<small>${person.age}代</small></h2></div><p class="selected-trip">${stations[person.destination]}で降車${person.luggage ? ' · 荷物0.5マス' : ''}${person.bodySpace === 0.5 ? ' · 窮屈' : ''}</p><div class="stress-detail"><span>ストレス <b>${person.stress}</b> / 100</span><i><b style="width:${person.stress}%"></b></i></div><details class="passenger-more" ${window.matchMedia('(min-width: 761px)').matches ? 'open' : ''}><summary>乗客の詳細</summary><dl class="person-properties"><div><dt>降車</dt><dd>${stations[person.destination]}</dd></div><div><dt>立席感度</dt><dd>${person.sensitivity}${person.sensitivity >= 4 ? ' · 着席優先' : ''}</dd></div><div><dt>荷物</dt><dd>${bagLabels[person.belongings]}${person.luggage ? '・通路0.5マス' : ''}</dd></div><div><dt>占有</dt><dd>${person.bodySpace === 0.5 ? '0.5マス・窮屈' : '1マス'}</dd></div><div><dt>行動</dt><dd>${activityLabels[person.activity]}${person.audio === 'leak' ? ' · 音漏れ' : ''}</dd></div><div><dt>状態</dt><dd>${postureLabels[person.posture]} · ${attentionLabels[person.attention]}</dd></div>${person.group ? `<div><dt>同行組</dt><dd>${escape(person.group)}</dd></div>` : ''}</dl></details>`;
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
      return `<path class="chain-line" pathLength="1" d="M${from.x + from.width / 2},${rowY(from.row) + 280}L${to.x + to.width / 2},${rowY(to.row) + 280}"/>`;
    });
  }).join('') : '';
  return `<svg class="train-board ${zoom ? 'zoomed' : ''}" viewBox="0 0 20000 3900" role="group" aria-label="北座席、北通路、南通路、南座席の4層。外側の扉際は2.5マス、3人まで。"><defs><pattern id="luggage-hatch" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="90" height="90" fill="#d9e2ed"/><path d="M0 0V90" stroke="#7890a9" stroke-width="24"/></pattern></defs><rect class="train-outline" x="300" y="250" width="19400" height="3300" rx="250"/><path class="center-line" d="M1000 1900H19000"/>
    <text class="row-label" x="820" y="950">座</text><text class="row-label" x="820" y="1600">立</text><text class="row-label" x="820" y="2250">立</text><text class="row-label" x="820" y="2900">座</text>
    ${[2570, 7090, 11610, 16130].map((x, index) => `<path class="closed-door" d="M${x} 340H${x + 1300}M${x + 650} 320V470"/><text class="door-caption" x="${x + 650}" y="215">閉鎖</text><path class="open-door" d="M${x} 3400H${x + 1300}"/><text class="door-caption south" x="${x + 650}" y="3780">↓ 乗降口 ${index + 1}</text>`).join('')}
    ${boardCells}${links}${renderEventMarkers(people)}${renderBoarding(people)}</svg>`;
}
function startBoarding(person: Passenger, cellId: string): void {
  if (reducedMotion.matches) return;
  const route = exitPath(cellId).reverse().map(id => cells.find(cell => cell.id === id)!);
  if (!route.length) return;
  const points = [[route[0].x + route[0].width / 2, 3650], ...route.map(cell => [
    cell.x + cell.width / 2, rowY(cell.row) + 225,
  ])];
  const path = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const duration = Math.min(950, 380 + route.length * 65);
  const walk = { path, started: performance.now(), duration };
  boarding.set(person.id, walk);
  window.setTimeout(() => {
    if (boarding.get(person.id) !== walk) return;
    boarding.delete(person.id);
    app.querySelector(`[data-walking="${person.id}"]`)?.remove();
    app.querySelector(`.person[data-person="${person.id}"]`)?.removeAttribute('visibility');
  }, duration);
}

function renderBoarding(people: Passenger[]): string {
  if (animating || state.finished || reducedMotion.matches) return '';
  return people.map(person => {
    const walk = boarding.get(person.id);
    if (!walk) return '';
    const elapsed = Math.min(walk.duration, performance.now() - walk.started);
    return `<g class="boarding-passenger" data-walking="${person.id}" aria-hidden="true"><animateMotion path="${walk.path}" dur="${walk.duration}ms" begin="-${elapsed}ms" fill="freeze"/><svg class="boarding-step" x="-200" y="-200" width="400" height="400" viewBox="0 0 64 64"><use href="${sprite}#${portraits[person.species]}"/></svg></g>`;
  }).join('');
}

function renderEventMarkers(people: Passenger[]): string {
  return (activeWave?.events ?? []).map(event => {
    const positions = event.participants.map(id => people.find(person => person.id === id)).filter((person): person is Passenger => !!person?.cellId).map(person => cells.find(cell => cell.id === person.cellId)!);
    if (!positions.length) return '';
    const x = positions.reduce((sum, cell) => sum + cell.x + cell.width / 2, 0) / positions.length;
    const y = positions.reduce((sum, cell) => sum + rowY(cell.row) + 260, 0) / positions.length;
    const emblem = event.rare
      ? '<path d="M0 -210 210 0 0 210 -210 0Z"/>'
      : '<path d="M-120 -120H120V120H-120Z" transform="rotate(45)"/>';
    return `<g class="event-impact ${event.rare ? 'rare' : ''}" transform="translate(${x} ${y})" aria-hidden="true"><g class="impact-rings"><circle r="240"/><circle r="310"/></g><g class="impact-rays"><path d="M0-260V-350 M0 260V350 M-260 0H-350 M260 0H350 M-185-185L-245-245 M185 185L245 245 M185-185L245-245 M-185 185L-245 245"/></g><g class="event-marker ${event.rare ? 'rare' : ''}">${emblem}</g></g>`;
  }).join('');
}
function rowY(row: number): number { return 620 + row * 650; }
function motionStyle(person: Passenger): string {
  let hash = 0;
  for (const character of person.id) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  const duration = (person.stress >= 80 ? 2.1 : 4.2) + (hash % 29) / 10;
  const delay = -((performance.now() - motionEpoch) / 1000 + hash % 73 / 10);
  return `--idle-duration:${duration}s;--idle-delay:${delay}s;--idle-direction:${hash % 2 ? 1 : -1}`;
}
function renderCell(cell: Cell, people: Passenger[]): string {
  const occupants = people.filter(person => person.cellId === cell.id);
  const reservations = people.filter(person => person.luggage && person.luggageCellId === cell.id);
  const luggageSpace = reservations.length * 0.5;
  const person = selected();
  const available = !animating && !state.finished && !!person && person.cellId !== cell.id && canPlace(state, person.id, cell.id);
  const highlighted = cell.id === hoveredCell;
  const personSelected = occupants.some(person => person.id === selectedId);
  const usage = getCellUsage(people, cell.id);
  const thermal = people.reduce((heat, other) => {
    if (!other.cellId || !adjacent(cell.id, other.cellId)) return heat;
    const stress = activeWave?.stress[other.id] ?? other.stress;
    return heat + (stress / 100) ** 2 * (other.cellId === cell.id ? 0.65 : 0.15);
  }, 0);
  const heat = Math.min(4, Math.floor(thermal * 5));
  const objective = sectorAt(cell.x + cell.width / 2) === state.objective;
  const heatLayer = heat || objective
    ? `<rect class="thermal-cell heat-${heat} ${objective ? 'objective-cell' : ''}" x="${cell.x + 27}" y="${rowY(cell.row) + 12}" width="${cell.width - 54}" height="536" rx="35"/>` : '';
  const kindName = cell.kind === 'seat' ? cell.priority ? '優先席' : '座席' : cell.kind === 'door' ? '扉際2.5マス' : '通路';
  const description = `${cell.row < 2 ? '北' : '南'}側 ${kindName} 使用${usage}/${getSpaceCapacity(cell.id)}マス${available ? ' 配置可能' : ''}${luggageSpace ? ` 荷物${luggageSpace}マス` : ''}${occupants.length ? '。' + occupants.map(occupant => `${occupant.species}${occupant.age}代 ストレス${occupant.stress}${occupant.bodySpace === 0.5 ? ' 半マスで窮屈' : ''}`).join('、') : ''}`;
  const reservationSvg = reservations.map((owner, index) => `<rect class="luggage-space" x="${cell.x + cell.width * (0.5 - index * 0.5) + 16}" y="${rowY(cell.row) + 12}" width="${cell.width * 0.5 - 25}" height="535"><title>${owner.species}の荷物0.5マス</title></rect>`).join('');
  const portraitsSvg = occupants.map((occupant, index) => {
    const compressed = occupant.bodySpace === 0.5;
    const tokenWidth = cell.kind === 'door' ? 480 : compressed ? 235 : 400;
    const spacing = occupants.length === 3 ? 350 : 490;
    const totalWidth = tokenWidth + (occupants.length - 1) * spacing;
    const x = compressed && cell.kind === 'standing' ? cell.x + cell.width / 4 - tokenWidth / 2 : cell.kind === 'door' ? cell.x + (cell.width - totalWidth) / 2 + index * spacing : cell.x + (cell.width - tokenWidth) / 2;
    const stress = activeWave?.stress[occupant.id] ?? occupant.stress;
    const flaring = activeWave?.sources.includes(occupant.id) || activeWave?.triggered.includes(occupant.id);
    const motion = portraits[occupant.species];
    const receiving = activeWave?.receivers.includes(occupant.id) === true;
    return `<g class="person ${compressed ? 'compressed' : ''} ${occupants.length === 3 ? 'crowded' : ''} ${flaring ? 'is-flaring' : ''} ${receiving ? 'is-receiving' : ''} ${selectedId === occupant.id ? 'is-selected' : ''}" ${!animating && !state.finished && !reducedMotion.matches && boarding.has(occupant.id) ? 'visibility="hidden"' : ''} data-person="${occupant.id}" data-body-space="${occupant.bodySpace ?? 1}" aria-label="${occupant.species} ${occupant.age}代 ストレス${stress} ${stations[occupant.destination]}で降車${compressed ? ' 半マスで窮屈' : ''}"><rect class="person-selection" x="${x - 12}" y="${rowY(cell.row) + 8}" width="${tokenWidth + 24}" height="530" rx="45"/>${receiving ? `<ellipse class="receiver-ring" cx="${x + tokenWidth / 2}" cy="${rowY(cell.row) + 270}" rx="${tokenWidth / 2 + 35}" ry="245"/>` : ''}<g class="token-reaction"><svg x="${x}" y="${rowY(cell.row) + 25}" width="${tokenWidth}" height="400" viewBox="0 0 64 64" ${compressed && cell.kind === 'standing' ? 'preserveAspectRatio="none"' : ''}><use class="token-body motion-${motion} ${stress >= 80 ? 'agitated' : ''}" style="${motionStyle(occupant)}" href="${sprite}#${motion}"></use></svg></g><rect class="stress-track" x="${x + 20}" y="${rowY(cell.row) + 450}" width="${tokenWidth - 40}" height="38"/><rect class="stress-fill ${stress >= 80 ? 'hot' : ''}" x="${x + 20}" y="${rowY(cell.row) + 450}" width="${(tokenWidth - 40) * stress / 100}" height="38"/>${occupant.luggage ? `<text class="person-badge" x="${x + tokenWidth - 90}" y="${rowY(cell.row) + 400}">荷</text>` : ''}${occupant.destination === state.station + 1 ? `<text class="person-next" x="${x + 90}" y="${rowY(cell.row) + 180}">↓</text>` : ''}</g>`;
  }).join('');
  const capacityHint = !occupants.length && cell.kind === 'door' ? `<text class="door-capacity" x="${cell.x + cell.width / 2}" y="${rowY(cell.row) + 340}">2.5</text>` : '';
  return `<g class="cell ${cell.kind} ${cell.priority ? 'priority' : ''} ${available ? 'available' : ''} ${highlighted ? 'hovered' : ''} ${personSelected ? 'selected-cell' : ''} ${occupants.length === 3 && cell.kind === 'door' ? 'overcrowded' : ''} ${luggageSpace ? 'has-luggage' : ''}" data-cell="${cell.id}" data-usage="${usage}" role="button" tabindex="${cell.id === (hoveredCell ?? cells[0].id) ? '0' : '-1'}" aria-label="${description}"><title>${description}</title><rect class="cell-shape" x="${cell.x + 15}" y="${rowY(cell.row)}" width="${cell.width - 30}" height="560" rx="${cell.kind === 'seat' ? 55 : 15}"/>${heatLayer}${reservationSvg}${!occupants.length && cell.priority ? `<text class="priority-symbol" x="${cell.x + cell.width / 2}" y="${rowY(cell.row) + 350}">優</text>` : ''}${capacityHint}${portraitsSvg}</g>`;
}

// ===== SECTION: Input, preview and deterministic animation =====
function bindEvents(): void {
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action!)));
  app.querySelectorAll<HTMLElement>('[data-person]').forEach(element => element.addEventListener('click', event => {
    event.stopPropagation();
    if (animating || state.finished) return;
    selectedId = element.dataset.person!;
    hoveredCell = null;
    enableAudio();
    render();
  }));
  app.querySelectorAll<SVGGElement>('[data-cell]').forEach(element => {
    element.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') highlightCell(element.dataset.cell!); });
    element.addEventListener('click', () => chooseCell(element.dataset.cell!));
    element.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseCell(element.dataset.cell!); }
      if (event.key === 'Escape') { selectedId = null; render(); }
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
    restart(input.value.trim() || freshSeed());
  });
}
function highlightCell(cellId: string): void {
  if (animating || state.finished || !selected()) return;
  hoveredCell = cellId;
  app.querySelectorAll('[data-cell]').forEach(element => element.classList.toggle('hovered', (element as HTMLElement).dataset.cell === cellId));
}
function chooseCell(cellId: string): void {
  if (animating || state.finished) return;
  const person = selected();
  if (!person) {
    const occupant = state.passengers.find(passenger => passenger.cellId === cellId);
    if (occupant) { selectedId = occupant.id; render(); }
    else notify('乗客を選択してください。');
    return;
  }
  if (person.cellId === cellId) {
    const occupants = state.passengers.filter(passenger => passenger.cellId === cellId);
    selectedId = occupants[(occupants.findIndex(passenger => passenger.id === selectedId) + 1) % occupants.length].id;
    focusRequest = `[data-cell="${cellId}"]`;
    render();
    return;
  }
  const next = person.cellId ? move(state, person.id, cellId) : place(state, person.id, cellId);
  if (next === state) { notify('配置できません。空き面積・荷物の置き場所・移動回数を確認してください。'); return; }
  state = next;
  if (!person.cellId && !state.finished) startBoarding(person, cellId);
  hoveredCell = null;
  selectedId = state.waiting[0]?.id ?? null;
  focusRequest = selectedId ? `[data-person="${selectedId}"]` : `[data-cell="${cellId}"]`;
  enableAudio();
  audio.playPlacement();
  notify('配置しました。');
  render();
  if (zoom) { const target = cells.find(cell => cell.id === cellId)!; centerBoardAt(target.x + target.width / 2); }
  if (state.finished) void animateEvaluation();
}
function centerBoardAt(x: number): void {
  const scroll = app.querySelector<HTMLElement>('.board-scroll');
  const board = app.querySelector<SVGElement>('.train-board');
  if (!scroll || !board) return;
  scroll.scrollTo({ left: x / 20000 * board.getBoundingClientRect().width - scroll.clientWidth / 2, behavior: reducedMotion.matches ? 'instant' : 'smooth' });
}
function moveFocus(cellId: string, key: string): void {
  const current = cells.find(cell => cell.id === cellId)!;
  const dx = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
  const dy = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
  const candidates = cells.filter(cell => dx ? cell.row === current.row && Math.sign(cell.x - current.x) === dx : cell.row === current.row + dy);
  candidates.sort((a, b) => Math.abs(a.x - current.x) - Math.abs(b.x - current.x));
  const next = candidates[0];
  if (!next) return;
  highlightCell(next.id);
  app.querySelectorAll<HTMLElement>('[data-cell]').forEach(element => element.tabIndex = element.dataset.cell === next.id ? 0 : -1);
  app.querySelector<HTMLElement>(`[data-cell="${next.id}"]`)?.focus();
}
async function handleAction(action: string): Promise<void> {
  if (action.startsWith('perk-')) {
    if (animating) return;
    state = choosePerk(state, action.slice('perk-'.length));
    render();
    return;
  }
  if (action.startsWith('jump-')) {
    const door = Number(action.slice(5));
    zoom = true;
    render();
    centerBoardAt([3220, 7740, 12260, 16780][door]);
    return;
  }
  if (action === 'skip') { animationToken++; finishAnimation(); return; }
  if (action === 'close') { closeModal(); return; }
  if (action === 'dismiss-tutorial') { tutorialVisible = false; writeStored('chaos-line.tutorial', 'done'); render(); return; }
  if (action === 'depart') {
    if (state.waiting.length || animating || state.finished) return;
    enableAudio();
    boarding.clear();
    state = depart(state);
    selectedId = state.waiting[0]?.id ?? null;
    hoveredCell = null;
    void animateEvaluation();
    return;
  }
  if (action === 'undo' && !animating) {
    const previous = state;
    state = undo(state);
    if (state !== previous) for (const id of boarding.keys()) {
      if (!state.passengers.some(person => person.id === id)) boarding.delete(id);
    } selectedId = state.waiting[0]?.id ?? null; render(); return;
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
  if (!reducedMotion.matches) await new Promise(resolve => setTimeout(resolve, 110));
  const waves = evaluation.waves;
  const weights = waves.map(wave => wave.events.some(event => event.rare) ? 1.65 : wave.events.length ? 1.25 : 0.75);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const beat = Math.min(300, 2800 / Math.max(1, totalWeight));
  for (const [i, wave] of waves.entries()) {
    if (token !== animationToken) return;
    activeWave = wave;
    render();
    audio.playWave(wave.index, wave.events.length, wave.events.some(event => event.rare));
    await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 60 : beat * weights[i]));
  }
  if (token !== animationToken) return;
  await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : 350));
  if (token === animationToken) finishAnimation();
}
function finishAnimation(): void {
  animating = false;
  activeWave = null;
  audio.playFinish();
  if (state.finished) {
    const best = Number(readStored('chaos-line.best-score')) || 0;
    writeStored('chaos-line.best-score', String(Math.max(best, state.score)));
    modal = 'result';
  }
  render();
  if (modal) focusModal();
  notify(`連鎖が確定しました。カオススコア${state.score}。`);
}
function restart(seed: string): void {
  animationToken++;
  boarding.clear();
  state = createGame(seed.slice(0, 80));
  summary = { events: 0, rare: 0, maxChain: 0 };
  selectedId = state.waiting[0]?.id ?? null;
  hoveredCell = null;
  animating = false;
  activeWave = null;
  modal = null;
  enableAudio();
  render();
}

// ===== SECTION: Dialogs and event discovery =====
function renderModal(): string {
  let title = '';
  let body = '';
  if (modal === 'help') {
    title = '遊び方';
    body = `<ol class="help-steps"><li>乗車待ちの乗客を選び、空き区画へ配置します。扉際の2.5マス区画は2人推奨、3人では過密になります。盤面の色は現在のストレスの分布を示します。</li><li>全員を配置して「発車する」を押します。各停車駅で3つのバフから1つ選べます。指定エリアでトラブルを起こすと報酬を獲得します。複数エリアで起こすと加点され、同じエリアの通常トラブルは3件目から基本点が40%になります。</li><li>ストレス80以上の乗客から隣接する乗客へ25ずつ伝播します。伝播で条件が揃うとトラブルが成立します。</li></ol><p class="dialog-note">得点はトラブルの件数・種類・連鎖数で決まります。全7駅・6区間。終着到着時、または混雑率200%・配置先がなくなると終了します。荷物付きの乗客は本体1マスと通路0.5マスを使います。着席時は前の通路、立席時は隣の通路を確保します。</p><div class="help-callout"><div class="help-portraits">${Object.keys(portraits).map(species => `<span class="help-species">${personIcon({ species } as Passenger)}${species}</span>`).join('')}</div><p>顔と衣服で種族を識別できます。バーはストレス、「荷」は荷物、「↓」は次駅での降車です。斜線は荷物が使う通路です。</p></div><details class="keyboard-help"><summary>キーボード操作</summary><p>Tabで領域移動、矢印で区画移動、Enterで配置、Escで選択解除。選択解除後、車内区画でEnterを押すと乗客を選択できます。同じ区画でEnterを押すと乗客を切り替えます。</p></details>`;
  } else if (modal === 'catalog') {
    title = 'トラブル図鑑';
    body = `<p class="dialog-note">通常${eventDefinitions.filter(event => !event.rare).length}種・特殊${eventDefinitions.filter(event => event.rare).length}種。連鎖でストレスが80以上になった乗客を含むと成立します。</p><div class="catalog-controls"><input id="catalog-search" placeholder="名前・条件で探す" aria-label="トラブルを検索" value="${escape(search)}"><select id="catalog-filter" aria-label="図鑑の絞り込み"><option value="all" ${catalogFilter === 'all' ? 'selected' : ''}>すべて</option><option value="normal" ${catalogFilter === 'normal' ? 'selected' : ''}>通常</option><option value="rare" ${catalogFilter === 'rare' ? 'selected' : ''}>特殊</option><option value="found" ${catalogFilter === 'found' ? 'selected' : ''}>発見済み</option><option value="new" ${catalogFilter === 'new' ? 'selected' : ''}>未発見</option></select></div><div class="catalog-list">${catalogCards()}</div>`;
  } else if (modal === 'sound') {
    title = 'サウンド';
    body = `<div class="sound-controls"><label>音を有効にする<input id="mute-toggle" type="checkbox" ${audio.muted ? '' : 'checked'}></label><label>BGM<input id="music-toggle" type="checkbox" ${audio.musicEnabled ? 'checked' : ''}></label><label>音量<input id="volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}"></label><button class="secondary-button" data-action="audio-retry">音源を再読み込み</button></div>`;
  } else if (modal === 'restart') {
    title = '新しい運行';
    body = `<form id="restart-form"><label class="field-label" for="seed-input">シード（同じ値で乗客と乗降を再現）</label><input class="seed-input" id="seed-input" maxlength="80" value="${escape(state.seed)}"><div class="modal-actions"><button type="button" class="secondary-button" data-action="random-seed">別のシード</button><button class="primary-button" type="submit">このシードで始める</button></div></form>`;
  } else {
    title = state.finished === 'terminal' ? '終着駅に到着' : state.finished === 'capacity' ? '混雑率200%で終了' : '運行結果';
    body = `<div class="result-hero"><p class="eyebrow">カオススコア</p><strong>${state.score.toLocaleString()}</strong><p>${state.station + 1}駅目 · ${stations[state.station]}</p></div><div class="result-stats"><div><b>${summary.events}</b>通常トラブル</div><div><b>${summary.rare}</b>特殊イベント</div><div><b>${summary.maxChain}</b>最大連鎖</div><div><b>${state.discovered.length}</b>今回の発見</div></div><ul class="event-log">${state.lastEvaluation?.events.map(event => `<li><span>${escape(event.name)} ${event.rare ? '<b class="rare-mark">特殊</b>' : ''}</span><b>基本 ${event.points}</b></li>`).join('') ?? ''}</ul>${state.lastEvaluation ? renderWaveBreakdown(state.lastEvaluation) : ''}<p class="dialog-note">最高記録 ${Math.max(state.score, Number(readStored('chaos-line.best-score')) || 0).toLocaleString()}点 · シード ${escape(state.seed)}</p><div class="modal-actions"><button class="secondary-button" data-action="catalog">図鑑を見る</button><button class="primary-button" data-action="same-seed">同じシードで再挑戦</button></div>`;
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
  if (action === 'random-seed') { const input = app.querySelector<HTMLInputElement>('#seed-input'); if (input) input.value = freshSeed(); }
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
  document.documentElement.classList.toggle('page-hidden', document.hidden);
  if (document.hidden) { audio.stop(); if (animating) { animationToken++; finishAnimation(); } }
});
render();
