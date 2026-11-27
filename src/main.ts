import './style.css';
import { GameAudio } from './audio.ts';
import { createGame, place, move, undo, depart, choosePerk, perkChoices, sectorAt, exitPath, canPlace, adjacent, cells, stations, eventDefinitions, getCellUsage, getSpaceCapacity, capacity, summarizeChaos, stationProfile } from './game/index.ts';
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
let zoom = window.matchMedia('(max-width: 760px)').matches;
let modal: 'help' | 'catalog' | 'sound' | 'restart' | 'result' | 'upgrade' | null = 'upgrade';
let search = '';
let catalogFilter = 'all';
let animating = false;
let activeWave: Wave | null = null;
let activeEvaluation: Evaluation | null = null;
const evaluationQueue: Evaluation[] = [];
const presented = new WeakSet<Evaluation>();
let cameraCell: string | null = null;
let cameraPanToken = 0;
let cameraFocusToken = 0;
let cameraHeldUntil = 0;
const fullCamera = { x: 0, y: 0, width: 20000, height: 3900 };
let cameraView = { ...fullCamera };
let activeEventOffset = 0;
let renderedWave: Wave | null = null;
const cutinHost = document.createElement('div');
cutinHost.id = 'cutin-host';
document.body.append(cutinHost);
let cutinMarkup = '';
let pointerActive = false;
let lastBoardInput = 0;
let animationToken = 0;
let announcement = '';

let focusRequest: string | null = null;
let discovered = readDiscoveries();
let presentationMode: 'full' | 'tempo' = readStored('chaos-line.presentation') === 'tempo' ? 'tempo' : 'full';
const firstSeenTypes = new WeakMap<Evaluation, Set<string>>();
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
function portraitHref(person: Passenger): string {
  return person.special
    ? `${import.meta.env.BASE_URL}special-tokens.svg#${person.special.skill}`
    : `${sprite}#${portraits[person.species]}`;
}
function personName(person: Passenger): string {
  return person.special?.name ?? person.species;
}
function personIcon(person: Passenger, className = ''): string {
  return `<svg class="portrait ${className}" viewBox="0 0 64 64" aria-hidden="true"><use href="${portraitHref(person)}"></use></svg>`;
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
  const scrollTop = scroll?.scrollTop ?? 0;
  const animationTimes = renderedWave === activeWave ? effectAnimationTimes() : new Map<string, number>();
  const queueScroll = document.querySelector('.passenger-queue')?.scrollLeft ?? 0;
  const person = selected();
  const isExisting = !!person?.cellId;
  const averageStress = state.passengers.length
    ? Math.round(state.passengers.reduce((sum, rider) => sum + rider.stress, 0) / state.passengers.length)
    : 0;
  const onboardCount = state.passengers.length;
  const chaos = summarizeChaos(state);
  const nextProfile = state.station + 1 < stations.length - 1 ? stationProfile(state.seed, state.station + 1).name : '終点';
  app.innerHTML = `<main class="app-shell">
    <header class="topbar">
      <a class="brand" href="./" aria-label="満員電車 ホーム"><span class="brand-mark">満</span><span><h1>満員電車</h1></span></a>
      <nav class="toolbar" aria-label="ゲームメニュー">
        <button data-action="help" aria-label="遊び方"><span class="menu-long">遊び方</span><span class="menu-short">？</span></button><button data-action="catalog"><span class="menu-long">トラブル図鑑</span><span class="menu-short">図鑑</span> <span class="count">${discovered.size}/${eventDefinitions.length}</span></button>
        <button data-action="sound" aria-label="設定">設定</button><button data-action="restart" aria-label="新しい運行"><span class="menu-long">新しい運行</span><span class="menu-short">再開</span></button>
      </nav>
    </header>
    <section class="masthead" aria-label="運行状況">
      <div class="stats"><div class="stat score"><span>車内ストレス</span><strong>${averageStress}<small>%</small></strong></div><div class="stat"><span>混雑率</span><strong>${Math.round(onboardCount / capacity * 100)}<small>%</small></strong></div><div class="stat discovery"><span>乗車中</span><strong>${onboardCount}<small>人</small></strong></div></div>
    </section>

    <div class="game-layout"><div class="main-panel">
      <section class="station-strip" aria-label="現在駅と次駅"><div><span>現在駅</span><strong>${stations[state.station]}</strong></div><b class="station-arrow" aria-hidden="true">→</b><div class="station-next"><span class="station-profile" aria-label="次駅の乗客の傾向">${escape(nextProfile)}</span><strong>${stations[Math.min(stations.length - 1, state.station + 1)]}</strong></div><b class="station-count">${currentLabel()}</b></section>
      <div class="route" aria-label="${stations.length}駅の進行">${stations.map((name, index) => `<span class="route-stop ${index < state.station ? 'passed' : ''} ${index === state.station ? 'current' : ''}" title="${index + 1} ${name}"><i></i>${index === state.station ? `<b>${index + 1}</b>` : ''}</span>`).join('')}</div>
      <section class="board-panel" aria-label="車両の配置盤面"><div class="board-top"><h2>車内配置</h2><div class="board-tools"><div class="door-jumps" aria-label="扉付近へ移動">${[0, 1, 2, 3].map(door => `<button data-action="jump-${door}" aria-label="乗降口${door + 1}付近へ移動">扉${door + 1}</button>`).join('')}</div><button data-action="zoom" aria-pressed="${zoom}">${zoom ? '縮小 −' : '拡大 ＋'}</button><span class="board-direction">北 ↑</span></div></div>
        <div class="board-scroll">${renderBoard()}</div>
        <div class="board-bottom"><p>${state.finished ? '運行終了。結果を確認できます。' : animating ? '連鎖中も配置できます' : isExisting ? `移動先を選択してください。` : selectedId ? '空き区画を選択。扉際は2人推奨・3人まで。荷物は通路を0.5マス使います。' : '乗車待ち、または車内の乗客を選択してください。'}</p><span>移動あと <b>${state.movesLeft}</b>回</span></div>
        <div class="legend"><span><i class="seat-key"></i>座席</span><span><i class="priority-key"></i>優先席</span><span><i class="stand-key"></i>立席</span><span><i class="door-key"></i>扉際</span><span><i class="luggage-key"></i>荷物 0.5マス</span><span class="thermal-key"><i></i>ストレス　低～高</span></div>
      </section>
      <section class="queue-panel" aria-label="乗車待ち"><div class="section-line"><h2>乗車待ち <span>${state.waiting.length}人</span></h2></div><div class="passenger-queue">${state.waiting.length ? state.waiting.map(renderPassengerCard).join('') : `<div class="empty-queue">${state.finished ? '運行終了' : '配置完了。発車できます。'}</div>`}</div></section>
    </div><aside class="sidebar" aria-label="選択中の乗客と区間目標">
      <section class="selection-panel" aria-label="選択中の乗客">${person ? renderPersonDetail(person) : '<h2 class="selected-name">乗客を選択</h2><p class="muted">選択した乗客の属性を表示します。</p>'}</section>
      <section class="run-status"><button class="chaos-overview" data-action="result" aria-label="${escape(chaos.label)}、${chaos.total}件、${chaos.types}種類、4区画中${chaos.sectors}区画。トラブル履歴を開く"><span class="chaos-level">${escape(chaos.label)}</span><strong>${chaos.total}<small>件</small> <i>/</i> ${chaos.types}<small>種</small> <i>/</i> ${chaos.sectors}<small>/4区画</small></strong></button>${state.perk ? `<button data-action="upgrade" class="acquired-perk">強化一覧</button>` : ''}</section>
      <div class="sidebar-actions"><button class="depart-button" data-action="depart" ${state.waiting.length || animating || evaluationQueue.length || state.finished || !state.perk ? 'disabled' : ''}><span>${state.finished ? '運行終了' : '発車する'}</span><b aria-hidden="true">→</b></button>${state.finished ? '<button class="result-button" data-action="result">運行結果を見る</button>' : ''}</div>
      <section class="forecast"><h3>次駅の乗車</h3><strong>${state.schedule[Math.min(stations.length - 1, state.station + 1)].length}<small>人</small></strong><p>${nextComposition()}</p></section>
    </aside></div>
    <footer class="footer"><span>シード <b>${escape(state.seed)}</b></span><span>配置時に反応が確定します</span></footer>
    <div id="live" class="sr-only" aria-live="polite">${escape(announcement)}</div>
    ${animating ? `<div class="wave-overlay" role="status"><strong>${activeWave?.index ? `${activeWave.index}連鎖` : '発火'}</strong><button data-action="skip">演出を省略</button></div>` : ''}
    ${modal ? renderModal() : ''}
  </main>`;
  document.querySelector('.board-scroll')!.scrollLeft = scrollLeft;
  document.querySelector('.board-scroll')!.scrollTop = scrollTop;
  if (cameraCell) document.querySelector<SVGElement>('.train-board')!.dataset.cameraCell = cameraCell;
  restoreEffectAnimationTimes(animationTimes);
  renderedWave = activeWave;
  // Keep cut-ins outside the replaced board DOM so selecting the next piece cannot restart them.
  const nextCutin = renderCutin();
  if (nextCutin !== cutinMarkup) { cutinHost.innerHTML = nextCutin; cutinMarkup = nextCutin; }
  cutinHost.hidden = !!modal;
  document.querySelector('.passenger-queue')!.scrollLeft = queueScroll;
  bindEvents();
  const restore = focusRequest ?? activeSelector;
  if (restore) app.querySelector<HTMLElement>(restore)?.focus({ preventScroll: true });
  focusRequest = null;
}
function nextComposition(): string {
  const people = state.schedule[Math.min(stations.length - 1, state.station + 1)];
  return Object.keys(portraits).map(species => { const count = people.filter(person => person.species === species).length; return count ? `${species} ${count}` : ''; }).filter(Boolean).join(' · ') || '終着駅では全員降車';
}
function renderPassengerCard(person: Passenger): string {
  return `<button class="passenger-card ${person.special ? 'special-passenger rarity-' + person.special.rarity : ''} ${person.id === selectedId ? 'selected' : ''}" data-person="${person.id}" aria-pressed="${person.id === selectedId}" style="--species:${speciesColors[person.species]}">${personIcon(person)}<span class="passenger-name">${escape(personName(person))}<small>${person.special?.rarity ?? `${person.age}代`}</small></span><span class="passenger-trip">${stations[person.destination]}で降車</span><span class="passenger-stress"><i style="width:${person.stress}%"></i></span><span class="card-tags"><span>ストレス ${person.stress}</span><span>${person.luggage ? '荷物' : ''}${person.sensitivity >= 4 ? ' 着席優先' : ''}</span></span></button>`;
}
const activityLabels: Record<Passenger['activity'], string> = { none: '特になし', screen: '画面を見る', call: '通話', talk: '会話', read: '読書', food: '飲食' };
const postureLabels: Record<Passenger['posture'], string> = { normal: '通常姿勢', wide: '広がった姿勢', lean: '寄り掛かり' };
const attentionLabels: Record<Passenger['attention'], string> = { aware: '周囲を見る', absorbed: '没頭', asleep: '居眠り' };
const bagLabels: Record<Passenger['belongings'], string> = { none: '荷物なし', backpack: 'リュック', hand: '手提げ', wheeled: '車輪付き荷物' };
function renderPersonDetail(person: Passenger): string {
  return `<div class="person-detail-heading">${personIcon(person)}<h2>${escape(personName(person))}<small>${person.special?.rarity ?? `${person.age}代`}</small></h2></div><p class="selected-trip">${person.special ? `${escape(person.special.name)} · ${person.special.rarity} · ` : ''}${stations[person.destination]}で降車${person.luggage ? ' · 荷物0.5マス' : ''}${person.bodySpace === 0.5 ? ' · 窮屈' : ''}</p><div class="stress-detail"><span>ストレス <b>${person.stress}</b> / 100</span><i><b style="width:${person.stress}%"></b></i></div><details class="passenger-more" ${window.matchMedia('(min-width: 761px)').matches ? 'open' : ''}><summary><span class="detail-label">乗客の詳細</span>${person.lastReaction ? `<span class="reaction-detail">${escape(person.lastReaction)}</span>` : ''}</summary><dl class="person-properties">${person.lastReaction ? `<div class="reaction-property"><dt>変化</dt><dd>${escape(person.lastReaction)}</dd></div>` : ''}<div><dt>降車</dt><dd>${stations[person.destination]}</dd></div><div><dt>立席感度</dt><dd>${person.sensitivity}${person.sensitivity >= 4 ? ' · 着席優先' : ''}</dd></div><div><dt>荷物</dt><dd>${bagLabels[person.belongings]}${person.luggage ? '・通路0.5マス' : ''}</dd></div><div><dt>占有</dt><dd>${person.bodySpace === 0.5 ? '0.5マス・窮屈' : '1マス'}</dd></div><div><dt>行動</dt><dd>${activityLabels[person.activity]}${person.audio === 'leak' ? ' · 音漏れ' : ''}</dd></div><div><dt>状態</dt><dd>${postureLabels[person.posture]} · ${attentionLabels[person.attention]}</dd></div>${person.group ? `<div><dt>同行組</dt><dd>${escape(person.group)}</dd></div>` : ''}</dl></details>`;
}

// ===== SECTION: Coordinate-based SVG train =====
function renderBoard(): string {
  const people = state.passengers.map(person => ({
    ...person,
    stress: activeWave?.stress[person.id] ?? person.stress,
  }));
  const boardCells = cells.map(cell => renderCell(cell, people)).join('');
  const effectPeople = activeEvaluation?.passengers ?? people;
  const links = activeWave ? activeWave.sources.flatMap(id => {
    const source = effectPeople.find(person => person.id === id);
    if (!source?.cellId) return [];
    const from = cells.find(cell => cell.id === source.cellId)!;
    return activeWave!.receivers.map(receiverId => {
      const receiver = effectPeople.find(person => person.id === receiverId);
      if (!receiver?.cellId) return '';
      const to = cells.find(cell => cell.id === receiver.cellId)!;
      const relay = source.special?.skill === 'relay' && cells.some(middle =>
        middle.id !== from.id && middle.id !== to.id &&
        adjacent(from.id, middle.id) && adjacent(middle.id, to.id) &&
        !effectPeople.some(person => person.cellId === middle.id));
      if (!adjacent(from.id, to.id) && !relay) return '';
      return `<path data-effect="link-${id}-${receiverId}" class="chain-line ${relay && !adjacent(from.id, to.id) ? 'relay-line' : ''}" pathLength="1" d="M${from.x + from.width / 2},${rowY(from.row) + 280}L${to.x + to.width / 2},${rowY(to.row) + 280}"/>`;
    });
  }).join('') : '';
  return `<svg class="train-board ${zoom ? 'zoomed' : ''}" viewBox="${cameraView.x} ${cameraView.y} ${cameraView.width} ${cameraView.height}" role="group" aria-label="北座席、北通路、南通路、南座席の4層。外側の扉際は3人まで。"><defs><linearGradient id="metal-seat" x2="0" y2="1"><stop stop-color="#bdf5ff"/><stop offset=".2" stop-color="#3799c0"/><stop offset=".52" stop-color="#205576"/><stop offset=".85" stop-color="#49b0d1"/><stop offset="1" stop-color="#12324e"/></linearGradient><linearGradient id="metal-priority" x2="0" y2="1"><stop stop-color="#ffecc2"/><stop offset=".3" stop-color="#d6a14c"/><stop offset=".75" stop-color="#866028"/><stop offset="1" stop-color="#483421"/></linearGradient><pattern id="metal-floor" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="#1b2939"/><path d="M0 60H120M60 0V120" stroke="#304154" stroke-width="8"/></pattern><pattern id="luggage-hatch" width="90" height="90" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="90" height="90" fill="#d9e2ed"/><path d="M0 0V90" stroke="#7890a9" stroke-width="24"/></pattern></defs><rect class="train-outline" x="300" y="250" width="19400" height="3300" rx="250"/><path class="center-line" d="M1000 1900H19000"/>
    <text class="row-label" x="820" y="950">座</text><text class="row-label" x="820" y="1600">立</text><text class="row-label" x="820" y="2250">立</text><text class="row-label" x="820" y="2900">座</text>
    ${[2570, 7090, 11610, 16130].map((x, index) => `<path class="closed-door" d="M${x} 340H${x + 1300}M${x + 650} 320V470"/><text class="door-caption" x="${x + 650}" y="215">閉鎖</text><path class="open-door" d="M${x} 3400H${x + 1300}"/><text class="door-caption south" x="${x + 650}" y="3780">↓ 乗降口 ${index + 1}</text>`).join('')}
    ${boardCells}${links}${renderEventMarkers(effectPeople)}${renderBoarding(people)}</svg>`;
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
  if (state.finished || reducedMotion.matches) return '';
  return people.map(person => {
    const walk = boarding.get(person.id);
    if (!walk) return '';
    const elapsed = Math.min(walk.duration, performance.now() - walk.started);
    return `<g class="boarding-passenger" data-walking="${person.id}" aria-hidden="true"><animateMotion path="${walk.path}" dur="${walk.duration}ms" begin="-${elapsed}ms" fill="freeze"/><svg class="boarding-step" x="-200" y="-200" width="400" height="400" viewBox="0 0 64 64"><use href="${portraitHref(person)}"/></svg></g>`;
  }).join('');
}

function renderEventMarkers(people: Passenger[]): string {
  return currentEvents().map(event => {
    const positions = event.participants.map(id => people.find(person => person.id === id)).filter((person): person is Passenger => !!person?.cellId).map(person => cells.find(cell => cell.id === person.cellId)!);
    if (!positions.length) return '';
    const x = positions.reduce((sum, cell) => sum + cell.x + cell.width / 2, 0) / positions.length;
    const y = positions.reduce((sum, cell) => sum + rowY(cell.row) + 260, 0) / positions.length;
    const emblem = event.rare
      ? '<path d="M0 -210 210 0 0 210 -210 0Z"/>'
      : '<path d="M-120 -120H120V120H-120Z" transform="rotate(45)"/>';
    return `<g data-effect="${event.id}" class="event-impact ${event.rare ? 'rare' : ''}" transform="translate(${x} ${y})" aria-hidden="true"><g class="impact-rings"><circle r="240"/><circle r="310"/></g><g class="impact-rays"><path d="M0-260V-350 M0 260V350 M-260 0H-350 M260 0H350 M-185-185L-245-245 M185 185L245 245 M185-185L245-245 M-185 185L-245 245"/></g><g class="event-marker ${event.rare ? 'rare' : ''}">${emblem}</g></g>`;
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
  const available = !state.finished && modal !== 'upgrade' && !!person && person.cellId !== cell.id && canPlace(state, person.id, cell.id);
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
  const kindName = cell.kind === 'seat' ? cell.priority ? '優先席' : '座席' : cell.kind === 'door' ? '扉際' : '通路';
  const occupancy = cell.kind === 'door' ? `${occupants.length}人・2人推奨` : `使用${usage}/${getSpaceCapacity(cell.id)}マス`;
  const description = `${cell.row < 2 ? '北' : '南'}側 ${kindName} ${occupancy}${available ? ' 配置可能' : ''}${luggageSpace ? ` 荷物${luggageSpace}マス` : ''}${occupants.length ? '。' + occupants.map(occupant => `${occupant.species}${occupant.age}代 ストレス${occupant.stress}${occupant.bodySpace === 0.5 ? ' 半マスで窮屈' : ''}`).join('、') : ''}`;
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
    return `<g class="person ${occupant.special ? 'special-passenger rarity-' + occupant.special.rarity : ''} ${compressed ? 'compressed' : ''} ${occupants.length === 3 ? 'crowded' : ''} ${flaring ? 'is-flaring' : ''} ${receiving ? 'is-receiving' : ''} ${selectedId === occupant.id ? 'is-selected' : ''}" ${!state.finished && !reducedMotion.matches && boarding.has(occupant.id) ? 'visibility="hidden"' : ''} data-person="${occupant.id}" data-body-space="${occupant.bodySpace ?? 1}" aria-label="${occupant.species} ${occupant.age}代 ストレス${stress} ${stations[occupant.destination]}で降車${compressed ? ' 半マスで窮屈' : ''}"><rect class="person-selection" x="${x - 12}" y="${rowY(cell.row) + 8}" width="${tokenWidth + 24}" height="530" rx="45"/>${receiving ? `<ellipse class="receiver-ring" cx="${x + tokenWidth / 2}" cy="${rowY(cell.row) + 270}" rx="${tokenWidth / 2 + 35}" ry="245"/>` : ''}<g class="token-reaction"><svg x="${x}" y="${rowY(cell.row) + 25}" width="${tokenWidth}" height="400" viewBox="0 0 64 64" ${compressed && cell.kind === 'standing' ? 'preserveAspectRatio="none"' : ''}><use class="token-body motion-${motion} ${stress >= 80 ? 'agitated' : ''}" style="${motionStyle(occupant)}" href="${portraitHref(occupant)}"></use></svg></g><rect class="stress-track" x="${x + 20}" y="${rowY(cell.row) + 450}" width="${tokenWidth - 40}" height="38"/><rect class="stress-fill ${stress >= 80 ? 'hot' : ''}" x="${x + 20}" y="${rowY(cell.row) + 450}" width="${(tokenWidth - 40) * stress / 100}" height="38"/>${occupant.lastReaction ? `<circle class="reaction-dot" cx="${x + tokenWidth - 35}" cy="${rowY(cell.row) + 75}" r="24"><title>${escape(occupant.lastReaction)}</title></circle>` : ''}${occupant.special ? `<text class="special-rarity" x="${x + tokenWidth / 2}" y="${rowY(cell.row) + 80}">${occupant.special.rarity}</text>` : ''}${occupant.luggage ? `<text class="person-badge" x="${x + tokenWidth - 90}" y="${rowY(cell.row) + 400}">荷</text>` : ''}${occupant.destination === state.station + 1 ? `<text class="person-next" x="${x + 90}" y="${rowY(cell.row) + 180}">↓</text>` : ''}</g>`;
  }).join('');
  return `<g class="cell ${cell.kind} ${cell.priority ? 'priority' : ''} ${available ? 'available' : ''} ${highlighted ? 'hovered' : ''} ${personSelected ? 'selected-cell' : ''} ${occupants.length === 3 && cell.kind === 'door' ? 'overcrowded' : ''} ${luggageSpace ? 'has-luggage' : ''}" data-cell="${cell.id}" data-usage="${usage}" role="button" tabindex="${cell.id === (hoveredCell ?? cells[0].id) ? '0' : '-1'}" aria-label="${description}"><title>${description}</title><rect class="cell-shape" x="${cell.x + 15}" y="${rowY(cell.row)}" width="${cell.width - 30}" height="560" rx="${cell.kind === 'seat' ? 55 : 15}"/>${cell.kind === 'seat' ? `<path class="seat-back" d="M${cell.x + 55} ${rowY(cell.row) + (cell.row === 0 ? 65 : 495)}H${cell.x + cell.width - 55}" />` : ''}${heatLayer}${reservationSvg}${!occupants.length && cell.priority ? `<text class="priority-symbol" x="${cell.x + cell.width / 2}" y="${rowY(cell.row) + 350}">優</text>` : ''}${portraitsSvg}</g>`;
}

// ===== SECTION: Input, preview and deterministic animation =====
function bindEvents(): void {
  app.querySelector('.board-scroll')?.addEventListener('pointerdown', () => {
    pointerActive = true;
    lastBoardInput = performance.now();
    const scroll = app.querySelector('.board-scroll')!;
    scroll.scrollTo({ left: scroll.scrollLeft, behavior: 'instant' });
  });
  app.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.addEventListener('click', () => handleAction(button.dataset.action!)));
  app.querySelectorAll<HTMLElement>('[data-person]').forEach(element => element.addEventListener('click', event => {
    event.stopPropagation();
    if (state.finished || modal === 'upgrade') return;
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
  app.querySelector<HTMLSelectElement>('#presentation-mode')?.addEventListener('change', event => {
    presentationMode = (event.target as HTMLSelectElement).value === 'tempo' ? 'tempo' : 'full';
    writeStored('chaos-line.presentation', presentationMode);
  });
  app.querySelector('.modal-backdrop')?.addEventListener('click', event => { if (event.target === event.currentTarget) closeModal(); });
  app.querySelector<HTMLFormElement>('#restart-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const input = app.querySelector<HTMLInputElement>('#seed-input')!;
    restart(input.value.trim() || freshSeed());
  });
}
function highlightCell(cellId: string): void {
  if (state.finished || modal === 'upgrade' || !selected()) return;
  hoveredCell = cellId;
  app.querySelectorAll('[data-cell]').forEach(element => element.classList.toggle('hovered', (element as HTMLElement).dataset.cell === cellId));
}
function chooseCell(cellId: string): void {
  if (state.finished || modal === 'upgrade') return;
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
  if (state.lastEvaluation) queueEvaluation(state.lastEvaluation);
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
    state = choosePerk(state, action.slice('perk-'.length));
    if (!state.perk) return;
    modal = null;
    selectedId = state.waiting[0]?.id ?? null;
    enableAudio();
    render();
    return;
  }
  if (action.startsWith('jump-')) {
    const door = Number(action.slice(5));
    resetCamera();
    zoom = true;
    render();
    centerBoardAt([3220, 7740, 12260, 16780][door]);
    return;
  }
  if (action === 'skip') { animationToken++; evaluationQueue.length = 0; finishAnimation(true); return; }
  if (action === 'close') { closeModal(); return; }
  if (action === 'depart') {
    if (state.waiting.length || animating || state.finished) return;
    enableAudio();
    boarding.clear();
    state = depart(state);
    selectedId = state.waiting[0]?.id ?? null;
    hoveredCell = null;
    activeWave = null;
    modal = state.finished ? 'result' : 'upgrade';
    render();
    focusModal();
    return;
  }
  if (action === 'undo' && !animating) {
    const previous = state;
    state = undo(state);
    if (state !== previous) for (const id of boarding.keys()) {
      if (!state.passengers.some(person => person.id === id)) boarding.delete(id);
    } selectedId = state.waiting[0]?.id ?? null; render(); return;
  }
  if (action === 'zoom') { resetCamera(); zoom = !zoom; render(); return; }
  if (['help', 'catalog', 'sound', 'restart', 'result', 'upgrade'].includes(action)) {
    modal = action as typeof modal;
    render();
    focusModal();
  }
}
function queueEvaluation(evaluation: Evaluation): void {
  if (presented.has(evaluation)) return;
  presented.add(evaluation);
  firstSeenTypes.set(evaluation, new Set(evaluation.events.filter(event => !discovered.has(event.type)).map(event => event.type)));
  evaluation.events.forEach(event => discovered.add(event.type));
  writeStored('chaos-line.discovery', JSON.stringify([...discovered]));
  // Every accepted evaluation is shown once with the same reading time, even when queued.
  evaluationQueue.push(evaluation);
  if (!animating) void animateEvaluation();
}

function effectAnimationTimes(): Map<string, number> {
  const times = new Map<string, number>();
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation) || !(animation.effect instanceof KeyframeEffect)) continue;
    const target = animation.effect.target;
    if (target?.classList.contains('token-body')) continue;
    const owner = target?.closest<SVGElement>('.train-board [data-person], .train-board [data-effect]');
    if (owner && typeof animation.currentTime === 'number') {
      times.set(`${owner.dataset.person ?? owner.dataset.effect}:${animation.animationName}`, animation.currentTime);
    }
  }
  return times;
}
function restoreEffectAnimationTimes(times: Map<string, number>): void {
  if (!times.size) return;
  for (const animation of document.getAnimations()) {
    if (!(animation instanceof CSSAnimation) || !(animation.effect instanceof KeyframeEffect)) continue;
    const owner = animation.effect.target?.closest<SVGElement>('.train-board [data-person], .train-board [data-effect]');
    const time = owner ? times.get(`${owner.dataset.person ?? owner.dataset.effect}:${animation.animationName}`) : undefined;
    if (typeof time === 'number' && Number.isFinite(time)) animation.currentTime = time;
  }
}
function currentEvents(): Wave['events'] {
  return activeWave?.events.slice(activeEventOffset, activeEventOffset + 2) ?? [];
}
function applyCamera(): void {
  app.querySelector('.train-board')?.setAttribute('viewBox', `${cameraView.x} ${cameraView.y} ${cameraView.width} ${cameraView.height}`);
}
function resetCamera(): void {
  cameraPanToken++;
  cameraFocusToken++;
  cameraCell = null;
  cameraHeldUntil = 0;
  cameraView = { ...fullCamera };
  applyCamera();
}
function moveCamera(destination: typeof cameraView, milliseconds: number, scrollTo?: { left: number; top: number }, returning = false): void {
  const panToken = ++cameraPanToken;
  let from = { ...cameraView };
  const scroll = app.querySelector<HTMLElement>('.board-scroll');
  let fromLeft = scroll?.scrollLeft ?? 0, fromTop = scroll?.scrollTop ?? 0;
  let remaining = milliseconds, elapsed = 0, previous = performance.now();
  let paused = false;
  const step = (now: number): void => {
    if (panToken !== cameraPanToken) return;
    let delta = Math.min(50, now - previous);
    previous = now;
    // Menus and pointer interaction pause a shot; explicit zoom/skip/restart still cancel it.
    // Returning to the normal board can continue behind the results dialog.
    if (document.hidden || (!returning && modal) || pointerActive) {
      paused = true;
      if (!returning) cameraHeldUntil += delta;
      requestAnimationFrame(step);
      return;
    }
    if (paused) {
      remaining = Math.max(1, remaining - elapsed);
      elapsed = 0;
      from = { ...cameraView };
      const current = app.querySelector<HTMLElement>('.board-scroll');
      fromLeft = current?.scrollLeft ?? fromLeft;
      fromTop = current?.scrollTop ?? fromTop;
      paused = false;
      delta = 0;
    }
    elapsed += delta;
    const progress = Math.min(1, elapsed / remaining);
    const eased = progress * progress * (3 - 2 * progress);
    cameraView = {
      x: from.x + (destination.x - from.x) * eased,
      y: from.y + (destination.y - from.y) * eased,
      width: from.width + (destination.width - from.width) * eased,
      height: from.height + (destination.height - from.height) * eased,
    };
    applyCamera();
    if (scrollTo) {
      const current = app.querySelector<HTMLElement>('.board-scroll');
      if (current) {
        current.scrollLeft = fromLeft + (scrollTo.left - fromLeft) * eased;
        current.scrollTop = fromTop + (scrollTo.top - fromTop) * eased;
      }
    }
    if (progress < 1) requestAnimationFrame(step);
    else if (!returning) cameraHeldUntil = Math.max(cameraHeldUntil, now + 2200);
  };
  requestAnimationFrame(step);
}
function focusWave(wave: Wave, evaluation: Evaluation): void {
  if (reducedMotion.matches || !wave.events.length) return;
  const focusToken = ++cameraFocusToken;
  const eventOffset = activeEventOffset;
  const participant = currentEvents()[0]?.participants[0];
  const rider = evaluation.passengers.find(person => person.id === participant);
  if (!rider?.cellId) return;
  const attempt = (): void => {
    if (focusToken !== cameraFocusToken || activeWave !== wave || activeEventOffset !== eventOffset || !animating || reducedMotion.matches) return;
    if (document.hidden || modal || pointerActive || performance.now() - lastBoardInput < 700) {
      window.setTimeout(attempt, 100);
      return;
    }
    const board = app.querySelector<SVGGraphicsElement>('.train-board');
    // A shared cell can contain several riders; focus the actual reacting portrait.
    const actor = app.querySelector<SVGGraphicsElement>(`.train-board .person[data-person="${participant}"]`);
    const target = actor?.querySelector<SVGSVGElement>('.token-reaction > svg');
    const scroll = app.querySelector<HTMLElement>('.board-scroll');
    if (!board || !actor || !target || !scroll) return;
    if (boarding.has(participant) || actor.getAttribute('visibility') === 'hidden') {
      window.setTimeout(attempt, 100);
      return;
    }
    // These placement coordinates are in train space; nested SVG getBBox() can report local icon coordinates.
    const widthInTrain = target.width.baseVal.value, heightInTrain = target.height.baseVal.value;
    const x = target.x.baseVal.value + widthInTrain / 2;
    const y = target.y.baseVal.value + heightInTrain / 2;
    if (![x, y, widthInTrain, heightInTrain].every(Number.isFinite) || widthInTrain <= 0 || heightInTrain <= 0) return;
    const boardBounds = board.getBoundingClientRect(), frame = scroll.getBoundingClientRect();
    const left = Math.max(0, Math.min(scroll.scrollWidth - scroll.clientWidth, x / 20000 * boardBounds.width - scroll.clientWidth / 2));
    const top = Math.max(0, Math.min(scroll.scrollHeight - scroll.clientHeight, y / 3900 * boardBounds.height - scroll.clientHeight / 2));
    const scale = window.matchMedia('(max-width: 760px)').matches ? 1.4 : 3;
    const width = 20000 / scale, height = 3900 / scale;
    // Off-carriage framing is intentional: edge riders deserve the same centered close-up.
    const visibleX = (frame.left + scroll.clientWidth / 2 - boardBounds.left + left - scroll.scrollLeft) / boardBounds.width;
    const visibleY = (frame.top + scroll.clientHeight / 2 - boardBounds.top + top - scroll.scrollTop) / boardBounds.height;
    cameraCell = rider.cellId;
    cameraHeldUntil = performance.now() + 3300;
    board.dataset.cameraPerson = participant;
    moveCamera({ x: x - width * visibleX, y: y - height * visibleY, width, height }, 1100, { left, top });
  };
  attempt();
}

async function holdPresentation(milliseconds: number, token: number): Promise<boolean> {
  let remaining = milliseconds;
  let previous = performance.now();
  while (remaining > 0 && token === animationToken) {
    await new Promise(resolve => setTimeout(resolve, 50));
    const now = performance.now();
    if (!document.hidden && !modal && !pointerActive) remaining -= Math.min(100, now - previous);
    previous = now;
  }
  return token === animationToken;
}
async function animateEvaluation(): Promise<void> {
  if (animating) return;
  animating = true;
  const token = ++animationToken;
  while (evaluationQueue.length && token === animationToken) {
    const evaluation = evaluationQueue.shift()!;
    activeEvaluation = evaluation;
    for (const wave of evaluation.waves) {
      if (!await holdPresentation(1, token)) return;
      activeWave = wave;
      // Present no more than two events together so every name and line can be read without scrolling.
      for (activeEventOffset = 0; activeEventOffset < Math.max(1, wave.events.length); activeEventOffset += 2) {
        if (token !== animationToken) return;
        render();
        const events = currentEvents();
        const rare = events.some(event => event.rare);
        if (activeEventOffset === 0) audio.playWave(wave.index, wave.events.length, rare);
        else audio.playEvent(rare, activeEventOffset / 2);
        const mobile = window.matchMedia('(max-width: 760px)').matches;
        const familiar = events.length > 0 && events.every(event => !event.rare && !firstSeenTypes.get(evaluation)?.has(event.type));
        const compact = presentationMode === 'tempo' && familiar;
        if (!compact) focusWave(wave, evaluation);
        const duration = compact ? 1200 : events.length ? (rare ? (mobile ? 3800 : 4800) : (mobile ? 3000 : 4200)) + (events.length > 1 ? 450 : 0) : 420;
        if (!await holdPresentation(duration, token)) return;
      }
    }
  }
  if (!await holdPresentation(Math.max(0, cameraHeldUntil - performance.now()), token)) return;
  if (token === animationToken) finishAnimation();
}
function finishAnimation(immediate = false): void {
  animating = false;
  activeWave = null;
  activeEvaluation = null;
  cameraCell = null;
  cameraFocusToken++;
  cameraHeldUntil = 0;
  if (immediate || reducedMotion.matches) resetCamera();
  else moveCamera({ ...fullCamera }, 900, undefined, true);
  activeEventOffset = 0;
  audio.playFinish();
  if (state.finished) {
    const best = Number(readStored('chaos-line.best-score')) || 0;
    writeStored('chaos-line.best-score', String(Math.max(best, state.score)));
    modal = 'result';
  }
  render();
  if (modal) focusModal();
  notify('車内の反応が収まりました。');
}

function restart(seed: string): void {
  animationToken++;
  boarding.clear();
  evaluationQueue.length = 0;
  activeEvaluation = null;
  resetCamera();
  activeEventOffset = 0;
  state = createGame(seed.slice(0, 80));
  selectedId = state.waiting[0]?.id ?? null;
  hoveredCell = null;
  animating = false;
  activeWave = null;
  modal = 'upgrade';
  enableAudio();
  render();
  focusModal();
}

// ===== SECTION: Dialogs and event discovery =====
function renderUpgrade(): string {
  const acquired = state.buffs.length ? `<details class="acquired-buffs"><summary>取得済みバフ ${state.buffs.length}</summary><p class="dialog-note">効果は合算。ストレス追加は最大48、向かいの通路への追加は最大35。</p><ul>${state.buffs.map(buff => `<li><strong>${escape(buff.name)}</strong><span>${escape(buff.description)}</span></li>`).join('')}</ul></details>` : '';
  if (state.perk) return `${state.perk.kind === 'special' ? `<p>${escape(state.perk.name)}</p><p class="dialog-note">${escape(state.perk.description)}</p>` : ''}${acquired}`;
  return `<div class="upgrade-cards">${perkChoices(state.seed, state.station, state.buffs).map(choice => {
    const special = choice.kind === 'special';
    return `<button class="upgrade-card ${special ? 'special-choice rarity-' + choice.rarity : ''}" data-action="perk-${choice.id}">
      <span class="upgrade-kind">${special ? `特殊駒 · ${choice.rarity}` : choice.scope === 'global' ? '全体バフ' : '区画バフ'}</span>
      ${special ? `<svg class="upgrade-portrait" viewBox="0 0 64 64" aria-hidden="true"><use href="${import.meta.env.BASE_URL}special-tokens.svg#${choice.skill}"/></svg>` : ''}<strong>${escape(choice.name)}</strong><span>${escape(choice.description)}</span>
    </button>`;
  }).join('')}</div>${acquired}`;
}

function renderCutin(): string {
  if (!activeWave?.events.length) return '';
  const flavors: Record<string, string> = {
    N01: '右へ半歩。お隣も右へ半歩。肩だけは離れない。',
    N02: 'そちらが押すなら、こちらも少々。背中の無言会議。',
    N03: '三人そろって譲ったつもりが、全員同じ方向へ。',
    N04: '背もたれだと思ったら、人の座席だった。',
    N05: 'ひじ掛けのない席で、ひじの境界線争い。',
    N06: '靴と荷物がぎゅうぎゅう。足の置き場、募集中。',
    N07: '目が合う。そらす。また合う。席だけ動かない。',
    N08: '両隣はゆったり。真ん中だけ、息をひそめる。',
    N09: '端席を選んだのに、逃げ道まで端になった。',
    N10: 'こくり、こくり。お隣を枕にするには近すぎる。',
    N11: '本人は通れた。リュックはまだ通っていない。',
    N12: '手提げがこつん。足元から始まるご挨拶。',
    N13: '出口は見えている。車輪付きの関所も見えている。',
    N14: '荷物同士は初対面。持ち主より先にぶつかった。',
    N15: '座れた安心もつかの間、足元に荷物の壁。',
    N16: '振り向く本人。遅れて大きく振り回されるリュック。',
    N17: '右にも荷物、左にも荷物。手ぶらがいちばん窮屈。',
    N18: '大荷物が二つ。扉前だけ、臨時の荷物置き場。',
    N19: '「今、電車」。車内のみなさんもご存じです。',
    N20: 'その曲、隣の人まで聴く予定はなかった。',
    N21: '同じ行を三度読んだ。会話の続きだけ覚えている。',
    N22: '画面には夢中。ぶつかった肩には気づかない。',
    N23: '見たつもりはない。隠す動きは、しっかり見えた。',
    N24: 'ページを開くたび、お隣の余白がなくなる。',
    N25: 'いい夢の途中へ、いい匂いが割り込んだ。',
    N26: '電話の声が上がる。会話も負けずに上がる。',
    N27: '「降ります」が届かない。イヤホンの向こうは別世界。',
    N28: '画面の続きは気になる。後ろの「降ります」も気にして。',
    N29: '降りたい人と、ここで動きたくない人がご対面。',
    N30: '荷物を引いたら別の荷物へ。出口まであと少し。',
    N31: '先にどうぞ、の気配はない。二人とも出口しか見ていない。',
    N32: '席から立った。そこから先が、まだ遠い。',
    N33: '乗って落ち着いたその場所が、誰かの帰り道。',
    N34: 'やっと座れた。と思ったら、もう降りる駅。',
    N35: '別々に来た降車の列が、同じ場所でこんにちは。',
    N36: '待てども開かない。今日の出口は反対側。',
    N37: '「みんないる？」の確認は、できれば出口の先で。',
    N38: 'まだまだ乗る人の特等席が、降りたい人の目の前に。',
    N39: '友達への一言が、眠る人の頭上を飛び交う。',
    N40: '仲間の席は確保済み。立っている人の視線が痛い。',
    N41: '会話は右から左へ。真ん中の人は参加していない。',
    N42: '「座れてよかったね」。笑顔の奥に少しだけ圧。',
    N43: '仲間の荷物はひとまとめ。出口の幅もひとまとめ。',
    N44: '話したい二人と、読みたい二人。隣同士はつらい。',
    N45: '電話と音楽が背中合わせ。静かな場所はどちら側？',
    N46: '壁は動かない。荷物も引かない。こちらだけ小さくなる。',
    N47: '本を避けたら、向こうの本も同じ方向へ。',
    N48: '手元に夢中の二人。足元だけが先に出会った。',
    N49: '降りたいので、まずはお隣の夢から起こします。',
    N50: '降りたい、動かしたくない、画面を見たい。三者三様。',
    N51: '入れると思った。息を吸う場所までは数えていなかった。',
    S01: 'あっちで「ちょっと」。こっちでも「ちょっと」。',
    S02: 'どの出口を選んでも、ひと騒動が待っている。',
    S03: '背負う、提げる、転がす。本日の荷物、全員集合。',
    S04: '電話、会話、音楽。車内放送だけが聞こえない。',
    S05: '五人五様の都合が、ひとつの車内に収まらない。',
    S06: '若い人も、働き盛りも、年配の人も。今日は譲れない。',
    S07: '「降ります」「降ります」。声はそろって、足は進まない。',
    S08: '静かな車内だった。みんなが目を覚ますまでは。',
    S09: '乗った駅は違っても、不満の行き先は同じだった。',
    S10: 'あちらのひと騒動へ、こちらのひと騒動が合流。',
  };
  return `<div class="event-cutin" aria-live="polite"><div class="cutin-stack">
    ${currentEvents().map(event => {
      const flavor = flavors[event.type] ?? 'ひとつのため息が、車内をざわつかせた。';
      return `<article class="cutin-metal ${event.rare ? 'rare-cutin' : ''}" data-event="${event.type}" data-event-id="${escape(event.id)}" data-event-station="${event.station ?? state.station}">
        <span class="cutin-tag">${event.rare ? '特殊トラブル' : `${activeWave!.index}連鎖`} · ${activeEventOffset + 1}–${Math.min(activeEventOffset + 2, activeWave!.events.length)} / ${activeWave!.events.length}</span>
        <strong>${escape(event.name)}</strong><p>${flavor}</p>
      </article>`;
    }).join('')}
  </div></div>`;
}

function renderModal(): string {
  let title = '';
  let body = '';
  if (modal === 'upgrade') {
    title = state.perk ? '獲得した強化' : '強化を1つ獲得';
    body = renderUpgrade();
  } else if (modal === 'help') {
    title = '遊び方';
    body = `<ol class="help-steps"><li>乗車待ちの乗客を選び、空き区画へ配置します。扉際は2人推奨、3人では過密になります。盤面の色は現在のストレスの分布を示します。</li><li>各停車駅で特殊駒1枚とバフ2枚から1つ選びます。バフは終点まで重なります。配置すると反応が確定し、ストレスが伝播します。全員を配置したら発車できます。</li><li>ストレス80以上の乗客から隣接する乗客へ25ずつ伝播します。伝播で条件が揃うとトラブルが成立します。</li></ol><p class="dialog-note">車内のストレスとトラブルを増やしていきます。全7駅・6区間。終着到着時、または混雑率200%・配置先がなくなると終了します。荷物付きの乗客は本体1マスと通路0.5マスを使います。着席時は前の通路、立席時は隣の通路を確保します。</p><div class="help-callout"><div class="help-portraits">${Object.keys(portraits).map(species => `<span class="help-species">${personIcon({ species } as Passenger)}${species}</span>`).join('')}</div><p>顔と衣服で種族を識別できます。バーはストレス、「荷」は荷物、「↓」は次駅での降車です。斜線は荷物が使う通路です。</p></div><details class="keyboard-help"><summary>キーボード操作</summary><p>Tabで領域移動、矢印で区画移動、Enterで配置、Escで選択解除。選択解除後、車内区画でEnterを押すと乗客を選択できます。同じ区画でEnterを押すと乗客を切り替えます。</p></details>`;
  } else if (modal === 'catalog') {
    title = 'トラブル図鑑';
    body = `<p class="dialog-note">通常${eventDefinitions.filter(event => !event.rare).length}種・特殊${eventDefinitions.filter(event => event.rare).length}種。連鎖でストレスが80以上になった乗客を含むと成立します。</p><div class="catalog-controls"><input id="catalog-search" placeholder="名前・条件で探す" aria-label="トラブルを検索" value="${escape(search)}"><select id="catalog-filter" aria-label="図鑑の絞り込み"><option value="all" ${catalogFilter === 'all' ? 'selected' : ''}>すべて</option><option value="normal" ${catalogFilter === 'normal' ? 'selected' : ''}>通常</option><option value="rare" ${catalogFilter === 'rare' ? 'selected' : ''}>特殊</option><option value="found" ${catalogFilter === 'found' ? 'selected' : ''}>発見済み</option><option value="new" ${catalogFilter === 'new' ? 'selected' : ''}>未発見</option></select></div><div class="catalog-list">${catalogCards()}</div>`;
  } else if (modal === 'sound') {
    title = '設定';
    body = `<div class="sound-controls"><label for="presentation-mode">演出<select id="presentation-mode"><option value="full" ${presentationMode === 'full' ? 'selected' : ''}>全件しっかり</option><option value="tempo" ${presentationMode === 'tempo' ? 'selected' : ''}>テンポ優先</option></select></label><p class="dialog-note">テンポ優先では、見たことのある通常トラブルだけを短く表示します。</p><label>音を有効にする<input id="mute-toggle" type="checkbox" ${audio.muted ? '' : 'checked'}></label><label>BGM<input id="music-toggle" type="checkbox" ${audio.musicEnabled ? 'checked' : ''}></label><label>音量<input id="volume" type="range" min="0" max="1" step="0.01" value="${audio.volume}"></label><button class="secondary-button" data-action="audio-retry">音源を再読み込み</button></div>`;
  } else if (modal === 'restart') {
    title = '新しい運行';
    body = `<form id="restart-form"><label class="field-label" for="seed-input">シード（同じ値で乗客と乗降を再現）</label><input class="seed-input" id="seed-input" maxlength="80" value="${escape(state.seed)}"><div class="modal-actions"><button type="button" class="secondary-button" data-action="random-seed">別のシード</button><button class="primary-button" type="submit">このシードで始める</button></div></form>`;
  } else {
    const chaos = summarizeChaos(state);
    title = state.finished === 'terminal' ? '終着駅に到着' : state.finished === 'capacity' ? '混雑率200%で終了' : state.finished ? '運行結果' : '車内の状況';
    body = `<div class="result-hero"><p class="eyebrow">${escape(chaos.label)}</p><strong>${chaos.total}<small>件のトラブル</small></strong><p>${state.station + 1}駅目 · ${stations[state.station]}</p></div><div class="result-stats"><div><b>${chaos.types}</b>種類</div><div><b>${chaos.sectors}<small>/4</small></b>広がった区画</div><div><b>${chaos.maxChain}</b>最大連鎖</div><div><b>${chaos.rare}</b>特殊トラブル</div></div>${chaos.mainCategory ? `<p class="dialog-note">多かったトラブル · ${escape(chaos.mainCategory)}</p>` : ''}<details class="run-history" open><summary>トラブル履歴 ${chaos.total}件</summary><ol class="event-log run-event-log">${state.eventLedger.map(event => `<li><span><small>${stations[event.station ?? 0]} · ${event.wave}連鎖</small><b>${escape(event.name)}</b></span>${event.rare ? '<b class="rare-mark">特殊</b>' : ''}</li>`).join('') || '<li>まだトラブルは起きていません。</li>'}</ol></details><details class="result-numbers"><summary>集計詳細</summary><p>内部カオス値 ${state.score.toLocaleString()} · 通常 ${chaos.events}件 · 特殊 ${chaos.rare}件</p></details><p class="dialog-note">シード ${escape(state.seed)}</p><div class="modal-actions"><button class="secondary-button" data-action="catalog">図鑑を見る</button>${state.finished ? '<button class="primary-button" data-action="same-seed">同じシードで再挑戦</button>' : '<button class="primary-button" data-action="close">車内へ戻る</button>'}</div>`;
  }
  return `<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header class="modal-header"><h2 id="modal-title">${title}</h2>${modal === 'upgrade' && !state.perk ? '' : '<button class="close-button" data-action="close" aria-label="閉じる">×</button>'}</header>${body}</section></div>`;
}
function catalogCards(): string {
  const normalized = search.trim().toLocaleLowerCase();
  const filtered = eventDefinitions.filter(event => (!normalized || `${event.name} ${event.description}`.toLocaleLowerCase().includes(normalized)) && (catalogFilter === 'all' || catalogFilter === 'rare' && event.rare || catalogFilter === 'normal' && !event.rare || catalogFilter === 'found' && discovered.has(event.id) || catalogFilter === 'new' && !discovered.has(event.id)));
  return filtered.length ? filtered.map(event => `<article class="catalog-card ${event.rare ? 'rare' : ''} ${discovered.has(event.id) ? 'discovered' : ''}"><div class="catalog-card-top"><h3>${escape(event.name)}</h3><b>${event.points}</b></div><p>${escape(event.description)}</p><footer><span>${event.rare ? '特殊' : event.category}</span><span>${discovered.has(event.id) ? '発見済み' : '未発見'}</span></footer></article>`).join('') : '<p class="empty-catalog">条件に合うトラブルはありません。</p>';
}
function updateCatalogList(): void { const list = app.querySelector('.catalog-list'); if (list) list.innerHTML = catalogCards(); }
function closeModal(): void { if (modal === 'upgrade' && !state.perk) return; modal = null; render(); app.querySelector<HTMLButtonElement>('[data-action="help"]')?.focus(); }
function focusModal(): void { app.querySelector<HTMLElement>('.modal button, .modal input')?.focus(); }
app.addEventListener('click', event => {
  const action = (event.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'same-seed') restart(state.seed);
  if (action === 'random-seed') { const input = app.querySelector<HTMLInputElement>('#seed-input'); if (input) input.value = freshSeed(); }
  if (action === 'audio-retry') enableAudio();
});
document.addEventListener('pointerup', () => { pointerActive = false; lastBoardInput = performance.now(); });
document.addEventListener('pointercancel', () => { pointerActive = false; });
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
  if (document.hidden) audio.stop();
  else if (animating) enableAudio();
});
render();
focusModal();
