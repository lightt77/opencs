import type { Game } from './game';
import { DEFAULTS, ROUND_LIMIT, TDM_LIMIT, WEAPONS, isGrenade, loadSettings, type Settings } from './config';
import { MAPS, type Arena } from './maps';
import { clamp } from './math';
import { SOUND_PACKS } from './audio';

const cross = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 2v8m0 12v8M2 16h8m12 0h8" stroke="currentColor" stroke-width="3"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg>';
const arrow = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" stroke-width="1.6"/></svg>';
const timeString = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;

export function mapSvg(arena: Arena) {
  const color = arena.id === 'snow' ? '#aec8d0' : arena.id === 'india' ? '#a6b5a0' : '#c7ab79';
  const sx = 58 / arena.width, sz = 66 / arena.depth;
  return `<svg class="map-art" viewBox="0 0 232 150" aria-hidden="true">
    <defs><pattern id="grid-${arena.id}" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0H0v12" fill="none" stroke="${color}" stroke-opacity=".12" stroke-width=".6"/></pattern></defs>
    <rect width="232" height="150" fill="url(#grid-${arena.id})"/>
    <g transform="translate(116 74) rotate(-28) scale(1.6 .96) translate(-29 -33)">
      <rect x="0" y="0" width="58" height="66" fill="${color}" fill-opacity=".07" stroke="${color}" stroke-opacity=".5" stroke-width=".7"/>
      ${arena.boxes.filter(b => b.kind !== 'beam' && b.w < arena.width / 2 && b.d < arena.depth / 2).map(b => `<rect x="${(b.x - b.w / 2) * sx + 29}" y="${(b.z - b.d / 2) * sz + 33}" width="${b.w * sx}" height="${b.d * sz}" fill="${color}" fill-opacity="${b.kind === 'crate' ? '.25' : '.5'}" stroke="${color}" stroke-width=".35"/>`).join('')}
      <path d="M29 60V40M29 6V24" stroke="${color}" stroke-dasharray="2 2" stroke-opacity=".65"/>
      <circle cx="29" cy="60" r="1.6" fill="#8cc3d2"/><circle cx="29" cy="6" r="1.6" fill="#da967d"/>
    </g><text x="12" y="137" fill="${color}" font-size="8" font-family="monospace" opacity=".55">SECTOR 0${Object.keys(MAPS).indexOf(arena.id) + 1} // ${arena.width} × ${arena.depth}</text>
  </svg>`;
}

export class UI {
  settings: Settings = loadSettings();
  private root: HTMLElement;
  private menu: HTMLElement;
  private hud: HTMLElement;
  private overlay: HTMLElement;
  private lastHUD = 0;
  private lastBoard = '';
  private minimap: HTMLCanvasElement;
  private hudElements: Record<string, HTMLElement> = {};

  constructor(readonly game: Game) {
    this.root = document.querySelector('#app')!;
    this.root.innerHTML = '<div id="menu"></div><div id="hud" hidden></div><div id="overlay" hidden></div>';
    this.menu = document.querySelector('#menu')!;
    this.hud = document.querySelector('#hud')!;
    this.overlay = document.querySelector('#overlay')!;
    this.buildHUD();
    this.minimap = this.hud.querySelector('canvas')!;
    game.onScreenChange = () => this.screen();
    game.onFrame = () => this.frame();
    game.preview(this.settings); this.screen();
    window.addEventListener('keydown', event => {
      if (this.overlay.hidden) return;
      if (event.code === 'Escape' && this.overlay.querySelector('.close-button')) {
        event.preventDefault(); this.closeDialog();
      }
      if (event.code === 'Tab') {
        const focusable = [...this.overlay.querySelectorAll<HTMLElement>('button, input, select, a[href]')];
        const first = focusable[0], last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || !this.overlay.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !this.overlay.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    });
  }

  private save() {
    try { localStorage.setItem('opencs.settings', JSON.stringify(this.settings)); } catch { /* Private browsing can disable storage. */ }
  }

  private menuHTML() {
    const s = this.settings;
    return `<div class="menu-shell">
      <header class="topbar">
        <a class="brand" href="#" aria-label="OpenCS home"><span class="brand-mark">${cross}</span><span>OPEN<span class="brand-light">CS</span><span class="brand-dot">®</span></span></a>
        <nav aria-label="Main navigation"><span class="nav-active">PLAY</span><button class="text-button" id="open-settings">SETTINGS</button><button class="text-button" id="open-controls">FIELD MANUAL ${arrow}</button></nav>
        <div class="build-tag"><span class="status-dot"></span> OFFLINE READY <span class="version">/ v0.1</span></div>
      </header>
      <main class="lobby">
        <section class="briefing" aria-labelledby="hero-title">
          <div class="eyebrow"><span class="tiny-cross">+</span> SINGLE PLAYER. SQUAD MENTALITY.</div>
          <h1 id="hero-title">SMALL MAPS.<br><span>BIG STAKES.</span></h1>
          <p class="intro">Old-school gunplay. A fresh field of play.<br><span>Find your angle. Trust your squad. Make every shot count.</span></p>
          <div class="section-label"><span>01 — SELECT YOUR BATTLEFIELD</span><span class="quiet">${Object.keys(MAPS).length} AVAILABLE</span></div>
          <div class="map-grid" role="group" aria-label="Battlefield">
            ${Object.values(MAPS).map((map, i) => `<button class="map-card ${s.map === map.id ? 'selected' : ''}" data-map="${map.id}" aria-pressed="${s.map === map.id}" aria-label="${map.name}">
              <span class="map-number">0${i + 1}</span><span class="map-check">↗</span>${mapSvg(map)}
              <span class="map-caption"><strong>${map.name}</strong><small>${map.subtitle.split(' / ')[1]}</small></span>
            </button>`).join('')}
          </div>
          <div class="field-stats"><span><b>05 <i>vs</i> 05</b> SQUAD COMBAT</span><span><b>08</b> WEAPONS & UTILITY</span><span><b>100%</b> IN YOUR BROWSER</span></div>
        </section>
        <aside class="setup-card" aria-labelledby="setup-title">
          <div class="setup-heading"><div><span class="eyebrow">YOUR NEXT MATCH</span><h2 id="setup-title">MISSION SETUP</h2></div><span class="card-cross">${cross}</span></div>
          <div class="setup-content">
            <div class="control-label"><span>GAME MODE</span><span>02</span></div>
            <div class="mode-options" role="group" aria-label="Game mode">
              <button data-mode="tdm" class="mode-option ${s.mode === 'tdm' ? 'selected' : ''}" aria-pressed="${s.mode === 'tdm'}"><span class="mode-icon">≋</span><span><strong>TEAM DEATHMATCH</strong><small>Respawn. Regroup. First to ${TDM_LIMIT}.</small></span><span class="radio"></span></button>
              <button data-mode="elimination" class="mode-option ${s.mode === 'elimination' ? 'selected' : ''}" aria-pressed="${s.mode === 'elimination'}"><span class="mode-icon">◇</span><span><strong>ELIMINATION</strong><small>One life. Every angle matters.</small></span><span class="radio"></span></button>
            </div>
            <div class="control-label"><span>BOT DIFFICULTY</span><span>AIM + REACTION</span></div>
            <div class="segments" role="group" aria-label="Bot difficulty">${(['easy', 'medium', 'hard'] as const).map(d => `<button data-difficulty="${d}" class="${s.difficulty === d ? 'selected' : ''}" aria-pressed="${s.difficulty === d}">${d.toUpperCase()}</button>`).join('')}</div>
            <div class="control-label"><span>PRIMARY WEAPON</span><span>${s.map === 'longshot' ? 'AWP RECOMMENDED' : '+ USP & UTILITY'}</span></div>
            <div class="segments weapons" role="group" aria-label="Primary weapon">${(['ak', 'm4', 'awp'] as const).map(id => `<button data-primary="${id}" class="${s.primary === id ? 'selected' : ''}" aria-pressed="${s.primary === id}"><span class="weapon-glyph">${id === 'awp' ? '━╋━' : '━┳┓'}</span>${WEAPONS[id].name}</button>`).join('')}</div>
            <div class="squad-note"><span class="status-dot"></span> YOU + 4 ALLIES <span>VS</span> 5 ENEMY BOTS</div>
            <button class="deploy-button" id="deploy"><span>DEPLOY TO ${s.map.toUpperCase()}</span>${arrow}</button>
            <p class="deploy-note">NO LOBBY. NO LOGIN. JUST PLAY.</p>
          </div>
        </aside>
      </main>
      <footer class="lobby-footer"><div><kbd>W A S D</kbd> MOVE <span>·</span> <kbd>MOUSE</kbd> AIM & FIRE <span>·</span> <kbd>ESC</kbd> PAUSE</div><span class="headphone-note">◉ HEADPHONES RECOMMENDED <span class="desktop-note">/ DESKTOP + MOUSE</span></span></footer>
      <div class="mobile-warning">Designed for a desktop keyboard and mouse.</div>
    </div>`;
  }

  private renderMenu() {
    this.menu.innerHTML = this.menuHTML();
    this.menu.querySelector('.brand')!.addEventListener('click', e => e.preventDefault());
    for (const key of ['map', 'mode', 'difficulty', 'primary'] as const) {
      this.menu.querySelectorAll<HTMLButtonElement>(`[data-${key}]`).forEach(button => button.addEventListener('click', () => {
        Object.assign(this.settings, { [key]: button.dataset[key] });
        this.save(); this.game.preview(this.settings); this.game.sound.click(); this.renderMenu();
      }));
    }
    this.menu.querySelector('#deploy')!.addEventListener('click', () => { this.save(); this.game.start(this.settings); });
    this.menu.querySelector('#open-settings')!.addEventListener('click', () => this.openSettings());
    this.menu.querySelector('#open-controls')!.addEventListener('click', () => this.controls());
  }

  private buildHUD() {
    this.hud.innerHTML = `
      <div class="hud-vignette"></div><div class="damage-wash" id="damage-wash"></div><div class="flash-wash" id="flash-wash"></div>
      <div class="smoke-wash" id="smoke-wash"></div>
      <div class="hud-map"><div class="hud-map-title"><span class="status-dot"></span><span id="map-name"></span></div><canvas width="196" height="220" aria-label="Tactical minimap"></canvas><span class="map-footer">N ↑ <span>FRIENDLIES ONLY</span></span></div>
      <div class="match-strip"><div class="team-score blue"><span>BLUE</span><b id="blue-score">0</b></div><div class="match-clock"><strong id="clock">06:00</strong><span id="match-label">FIRST TO 40</span></div><div class="team-score red"><b id="red-score">0</b><span>RED</span></div></div>
      <div class="performance"><b id="fps">60 FPS</b><span>LOCAL MATCH · <span id="difficulty-label">MEDIUM</span></span></div>
      <div class="kill-feed" id="kill-feed"></div>
      <div class="announcement" id="announcement"></div>
      <div class="crosshair" id="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hit-marker" id="hit-marker">╳</div>
      <div class="scope" id="scope" hidden><div class="scope-horizontal"></div><div class="scope-vertical"></div><i></i></div>
      <div class="damage-direction" id="damage-direction">⌃</div>
      <div class="death-card" id="death-card" hidden></div>
      <div class="bottom-hud"><div class="health-block"><span class="health-icon">+</span><div><strong id="health">100</strong><span>HEALTH</span></div><div class="health-bar"><i id="health-bar"></i></div></div>
        <div class="quick-controls"><span><kbd>Q</kbd> QUICK SWITCH</span><span><kbd>R</kbd> RELOAD</span><span><kbd>TAB</kbd> SCORE</span><span><kbd>ESC</kbd> PAUSE</span></div>
        <div class="ammo-block"><span id="weapon-name">AK-47</span><div><strong id="clip">30</strong><span>/ <b id="reserve">90</b></span></div><small id="weapon-status">7.62 × 39 MM</small></div>
      </div>
      <div class="weapon-slots" id="weapon-slots"></div>
      <div class="scoreboard" id="scoreboard" hidden></div>
    `;
    this.hud.querySelectorAll<HTMLElement>('[id]').forEach(el => { this.hudElements[el.id] = el; });
  }

  private screen() {
    const screen = this.game.screen;
    this.menu.hidden = screen !== 'menu';
    this.hud.hidden = screen === 'menu';
    this.overlay.hidden = screen === 'playing' || screen === 'menu';
    if (screen === 'menu') this.renderMenu();
    if (screen === 'paused') this.pauseHTML();
    if (screen === 'finished') this.results();
    this.root.classList.toggle('in-game', screen !== 'menu');
    this.lastBoard = ''; this.lastHUD = 0;
  }

  private pauseHTML() {
    this.overlay.innerHTML = `<section class="dialog pause-dialog"><span class="eyebrow">TAKE A BREATHER</span><h2>MATCH PAUSED</h2><p>The battlefield can wait.<br>Your match is paused while the mouse is released.</p>
      <button class="deploy-button" id="resume"><span>BACK IN THE FIGHT</span>${arrow}</button>
      <div class="pause-actions"><button class="secondary-button" id="pause-settings">SETTINGS</button><button class="secondary-button" id="pause-controls">CONTROLS</button></div>
      <button class="text-button exit-button" id="leave">LEAVE MATCH</button>
    </section>`;
    this.overlay.querySelector('#resume')!.addEventListener('click', () => this.game.resume());
    this.overlay.querySelector('#pause-settings')!.addEventListener('click', () => this.openSettings());
    this.overlay.querySelector('#pause-controls')!.addEventListener('click', () => this.controls());
    this.overlay.querySelector('#leave')!.addEventListener('click', () => this.game.toMenu());
  }

  private closeDialog() {
    if (this.game.screen === 'paused') this.pauseHTML();
    else { this.overlay.hidden = true; this.overlay.innerHTML = ''; }
  }

  private openSettings() {
    this.overlay.hidden = false;
    const s = this.settings;
    this.overlay.innerHTML = `<section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="dialog-title"><div><span class="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">SETTINGS</h2></div><button class="close-button" aria-label="Close settings">×</button></div>
      <div class="settings-grid"><section aria-labelledby="movement-title"><h3 id="movement-title">INPUT & MOVEMENT</h3>
      <label class="slider-label" for="sensitivity">MOUSE SENSITIVITY <output>${s.sensitivity.toFixed(2)}</output></label><input id="sensitivity" type="range" min="0.25" max="2.5" step="0.05" value="${s.sensitivity}" />
      <label class="slider-label" for="movementSpeed">MOVEMENT SPEED <output>${s.movementSpeed.toFixed(1)}×</output></label><input id="movementSpeed" type="range" min="0.5" max="2" step="0.1" value="${s.movementSpeed}" />
      <label class="slider-label" for="jumpGravity">JUMP GRAVITY <output>${s.jumpGravity} m/s²</output></label><input id="jumpGravity" type="range" min="10" max="35" step="1" value="${s.jumpGravity}" />
      <label class="checkbox-label"><span>DOUBLE JUMP <small>Press Space again in the air for one extra jump.</small></span><input id="doubleJump" type="checkbox" ${s.doubleJump ? 'checked' : ''} /></label>
      <p class="settings-hint">Speed applies to both teams. Lower gravity makes jumps higher and floatier. Grenade gravity is unchanged.</p>
      </section><section aria-labelledby="audio-video-title"><h3 id="audio-video-title">AUDIO & VIDEO</h3>
      <label class="slider-label" for="volume">MASTER VOLUME <output>${s.volume}%</output></label><input id="volume" type="range" min="0" max="100" value="${s.volume}" />
      <label class="slider-label" for="soundPack">GUNSHOT SOUND PACK</label>
      <select id="soundPack" class="pack-select">${Object.entries(SOUND_PACKS).map(([id, pack]) => `<option value="${id}" ${s.soundPack === id ? 'selected' : ''}>${pack.name}</option>`).join('')}</select>
      <p class="pack-description" id="pack-description">${SOUND_PACKS[s.soundPack].description}</p>
      <button class="secondary-button preview-sound" id="preview-sound">▶ PREVIEW ${WEAPONS[s.primary].name} GUNSHOT</button>
      <label class="slider-label" for="fov">FIELD OF VIEW <output>${s.fov}°</output></label><input id="fov" type="range" min="70" max="105" value="${s.fov}" />
      <label class="checkbox-label"><span>SOFT SHADOWS <small>Turn off for a lighter GPU workload.</small></span><input id="shadows" type="checkbox" ${s.shadows ? 'checked' : ''} /></label>
      </section></div>
      <button class="secondary-button" id="reset-settings">RESTORE DEFAULTS</button><p class="dialog-footnote">Saved on this device. Match options stay unchanged.</p>
    </section>`;
    for (const key of ['sensitivity', 'volume', 'fov', 'movementSpeed', 'jumpGravity'] as const) {
      const input = this.overlay.querySelector<HTMLInputElement>(`#${key}`)!;
      input.addEventListener('input', () => {
        this.settings[key] = Number(input.value);
        const value = this.settings[key];
        input.previousElementSibling!.querySelector('output')!.textContent = key === 'sensitivity' ? value.toFixed(2) : key === 'movementSpeed' ? `${value.toFixed(1)}×` : `${value}${key === 'fov' ? '°' : key === 'jumpGravity' ? ' m/s²' : '%'}`;
        this.applySettings();
      });
    }
    for (const key of ['shadows', 'doubleJump'] as const) {
      this.overlay.querySelector(`#${key}`)!.addEventListener('change', event => {
        this.settings[key] = (event.target as HTMLInputElement).checked; this.applySettings();
      });
    }
    this.overlay.querySelector('#soundPack')!.addEventListener('change', event => {
      this.settings.soundPack = (event.target as HTMLSelectElement).value as Settings['soundPack'];
      this.overlay.querySelector('#pack-description')!.textContent = SOUND_PACKS[this.settings.soundPack].description;
      this.applySettings();
    });
    this.overlay.querySelector('#preview-sound')!.addEventListener('click', () => { void this.game.sound.preview(this.settings.primary); });
    this.overlay.querySelector('#reset-settings')!.addEventListener('click', () => {
      Object.assign(this.settings, { sensitivity: DEFAULTS.sensitivity, volume: DEFAULTS.volume, fov: DEFAULTS.fov, shadows: DEFAULTS.shadows, movementSpeed: DEFAULTS.movementSpeed, doubleJump: DEFAULTS.doubleJump, jumpGravity: DEFAULTS.jumpGravity, soundPack: DEFAULTS.soundPack });
      this.applySettings(); this.openSettings();
    });
    this.overlay.querySelector('.close-button')!.addEventListener('click', () => this.closeDialog());
    (this.overlay.querySelector('.close-button') as HTMLButtonElement).focus();
  }

  private applySettings() {
    this.save(); Object.assign(this.game.settings, this.settings);
    this.game.sound.volume = this.settings.volume / 100;
    this.game.sound.pack = this.settings.soundPack;
    this.game.view.renderer.shadowMap.enabled = this.settings.shadows;
  }

  private controls() {
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<section class="dialog manual-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div class="dialog-title"><div><span class="eyebrow">READ THE ROOM. THEN CLEAR IT.</span><h2 id="manual-title">FIELD MANUAL</h2></div><button class="close-button" aria-label="Close manual">×</button></div>
      <div class="manual-grid">${[
        ['W A S D', 'Move'], ['SPACE', 'Jump / optional air jump'], ['CTRL / C', 'Crouch'], ['LMB', 'Fire / throw'], ['RMB', 'AWP scope'], ['R', 'Reload'], ['Q / Q Q', 'Last weapon / faster AWP cycle'], ['1 / 2 / 3', 'Primary / pistol / knife'], ['4 / 5 / 6', 'HE / flash / smoke'], ['WHEEL', 'Cycle weapons'], ['TAB', 'Scoreboard'], ['ESC', 'Pause & release mouse'],
      ].map(([key, label]) => `<div><span>${label}</span><kbd>${key}</kbd></div>`).join('')}</div>
      <div class="tips"><strong>STEADY FEET. STEADY AIM.</strong><p>Stop or counter-strafe before shooting. Fire short bursts at range. Footsteps and gunfire reveal your position to bots. Smoke blocks their sight; flashbangs disrupt their aim. Friendly fire is off, but your own HE can hurt you.</p></div>
      <p class="dialog-footnote">Elimination: first to ${ROUND_LIMIT} rounds. On timeout, surviving players then total health decide the round. A draw awards no point. Matches end after 15 rounds.</p>
    </section>`;
    this.overlay.querySelector('.close-button')!.addEventListener('click', () => this.closeDialog());
    (this.overlay.querySelector('.close-button') as HTMLButtonElement).focus();
  }

  private results() {
    const g = this.game;
    this.overlay.innerHTML = `<section class="dialog results-dialog"><span class="eyebrow">MISSION COMPLETE / ${g.arena.name}</span><h2>${g.winner === 'draw' ? 'STALEMATE.' : g.winner === 'blue' ? 'GROUND TAKEN.' : 'LIVE. LEARN. RELOAD.'}</h2><p>${g.winner === 'draw' ? 'An even match. Settle it in the next one.' : `${g.winner.toUpperCase()} TEAM WINS THE MATCH`}</p>
      <div class="result-score"><span class="blue-text">${g.scores.blue}<small>BLUE TEAM</small></span><i>:</i><span class="red-text">${g.scores.red}<small>RED TEAM</small></span></div>
      <div class="personal-stats"><div><b>${g.player.kills}</b><span>KILLS</span></div><div><b>${g.player.deaths}</b><span>DEATHS</span></div><div><b>${(g.player.kills / Math.max(1, g.player.deaths)).toFixed(1)}</b><span>K / D</span></div></div>
      <button class="deploy-button" id="rematch"><span>RUN IT BACK</span>${arrow}</button><button class="text-button exit-button" id="back-menu">BACK TO MISSION SETUP</button>
    </section>`;
    this.overlay.querySelector('#rematch')!.addEventListener('click', () => this.game.start(this.settings));
    this.overlay.querySelector('#back-menu')!.addEventListener('click', () => this.game.toMenu());
  }

  private set(id: string, text: string) {
    const el = this.hudElements[id]; if (el.textContent !== text) el.textContent = text;
  }

  private frame() {
    const g = this.game, p = g.player;
    if (!p || g.screen === 'menu') return;
    const e = this.hudElements;
    const damage = Math.max(0, 1 - (g.time - g.lastDamage) / .65);
    e['damage-wash'].style.opacity = String(damage * .6);
    e['damage-direction'].style.opacity = String(damage);
    e['damage-direction'].style.transform = `translateX(-50%) rotate(${g.damageDirection}rad)`;
    e['flash-wash'].style.opacity = String(clamp(p.flash / 1.8, 0, .98));
    e['smoke-wash'].style.opacity = String(g.smokeOpacity);
    e['scope'].hidden = !g.scoped || !p.alive;
    e['crosshair'].hidden = g.scoped || !p.alive;
    const gap = 4 + p.speed * 1.3 + p.shots * .8 + (p.body.grounded ? 0 : 12);
    e['crosshair'].style.setProperty('--gap', `${gap}px`);
    e['hit-marker'].style.opacity = String(Math.max(0, 1 - (g.time - g.hitTime) / .23));
    e['hit-marker'].classList.toggle('headshot', g.hitHead);
    if (performance.now() - this.lastHUD < 85) return;
    this.lastHUD = performance.now();
    this.set('map-name', g.arena.name); this.set('blue-score', String(g.scores.blue)); this.set('red-score', String(g.scores.red));
    this.set('clock', timeString(g.phase === 'warmup' ? g.phaseTime : g.remaining));
    e['clock'].classList.toggle('time-low', g.remaining < 20 && g.phase === 'live');
    this.set('match-label', g.settings.mode === 'tdm' ? `FIRST TO ${TDM_LIMIT}` : `ROUND ${g.round} · FIRST TO ${ROUND_LIMIT}`);
    this.set('fps', `${Math.round(g.fps)} FPS`); this.set('difficulty-label', g.settings.difficulty.toUpperCase());
    this.set('health', String(p.health)); e['health-bar'].style.width = `${p.health}%`;
    e['health'].classList.toggle('low-health', p.health < 30);
    this.set('weapon-name', WEAPONS[p.weapon].name);
    this.set('clip', p.weapon === 'knife' ? '∞' : String(p.ammo[p.weapon].clip));
    this.set('reserve', String(p.ammo[p.weapon].reserve));
    this.set('weapon-status', p.reload > 0 ? `RELOADING · ${p.reload.toFixed(1)}s` : p.immunity > 0 ? 'SPAWN PROTECTION' : p.weapon === 'awp' ? 'RMB SCOPE · Q Q QUICK CYCLE' : isGrenade(p.weapon) ? 'LMB TO THROW' : p.weapon === 'knife' ? 'CLOSE QUARTERS' : 'STOP TO SHOOT ACCURATELY');
    this.set('announcement', g.phase === 'warmup' ? `GET READY · ${Math.ceil(g.phaseTime)}` : g.announcementTime > 0 ? g.announcement : '');
    e['announcement'].classList.toggle('visible', !!e['announcement'].textContent);
    const feed = g.kills.filter(k => g.time - k.time < 7).map(k => `<div><b class="${k.team}-text">${k.killer}</b><span>${WEAPONS[k.weapon].short}${k.head ? ' ⊕' : ''}</span><b class="${k.team === 'blue' ? 'red' : 'blue'}-text">${k.victim}</b></div>`).join('');
    if (e['kill-feed'].innerHTML !== feed) e['kill-feed'].innerHTML = feed;
    e['death-card'].hidden = p.alive;
    if (!p.alive) e['death-card'].innerHTML = `<span>${g.settings.mode === 'tdm' ? `BACK IN ${Math.max(1, Math.ceil(p.respawn))}` : 'YOU ARE ELIMINATED'}</span><strong>${g.spectating ? `WATCHING ${g.spectating.toUpperCase()}` : 'WAITING FOR NEXT ROUND'}</strong><small>${g.settings.mode === 'tdm' ? 'Regroup. Find another angle.' : 'Your squad is still in the fight.'}</small>`;
    const slots = p.weapons.map((id, i) => `<div class="${id === p.weapon ? 'active' : ''} ${isGrenade(id) && !p.ammo[id].clip ? 'empty' : ''}"><kbd>${i + 1}</kbd><span>${WEAPONS[id].short}</span></div>`).join('');
    if (e['weapon-slots'].innerHTML !== slots) e['weapon-slots'].innerHTML = slots;
    e['scoreboard'].hidden = !g.scoreboard;
    if (g.scoreboard) this.drawScoreboard();
    this.drawMinimap();
  }

  private drawScoreboard() {
    const g = this.game;
    const content = `<div class="scoreboard-heading"><span>${g.arena.name} / ${g.settings.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'ELIMINATION'}</span><span>LOCAL MATCH</span></div><h2>SQUAD STATUS</h2>${(['blue', 'red'] as const).map(team => `<div class="scoreboard-team ${team}-text"><span>${team.toUpperCase()} TEAM</span><span>${g.scores[team]}</span></div><div class="scoreboard-row board-labels"><span>OPERATOR</span><span>K</span><span>D</span><span>STATUS</span></div>${g.actors.filter(a => a.team === team).sort((a, b) => b.kills - a.kills).map(a => `<div class="scoreboard-row ${a.human ? 'is-you' : ''}"><span>${a.name}${a.human ? ' <small>/ YOU</small>' : ''}</span><span>${a.kills}</span><span>${a.deaths}</span><span class="${a.alive ? 'alive' : 'dead'}">${a.alive ? 'ACTIVE' : 'DOWN'}</span></div>`).join('')}`).join('')}<p>HOLD TAB TO VIEW · RELEASE TO CLOSE</p>`;
    if (content !== this.lastBoard) { this.hudElements['scoreboard'].innerHTML = content; this.lastBoard = content; }
  }

  private drawMinimap() {
    const g = this.game, canvas = this.minimap, ctx = canvas.getContext('2d')!;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(15,24,21,.82)'; ctx.fillRect(0, 0, w, h);
    const scale = Math.min((w - 16) / g.arena.width, (h - 16) / g.arena.depth);
    const px = (x: number) => w / 2 + x * scale, pz = (z: number) => h / 2 + z * scale;
    for (const b of g.arena.boxes) {
      if (b.kind === 'beam') continue;
      ctx.fillStyle = b.kind === 'crate' ? '#5a614e' : '#485449';
      ctx.fillRect(px(b.x - b.w / 2), pz(b.z - b.d / 2), b.w * scale, b.d * scale);
    }
    for (const actor of g.actors) {
      if (actor.team !== 'blue' || !actor.alive) continue;
      ctx.fillStyle = actor.human ? '#f1c27f' : '#8cc3d2';
      ctx.beginPath(); ctx.arc(px(actor.position.x), pz(actor.position.z), actor.human ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      if (actor.human) {
        ctx.strokeStyle = '#f1c27f'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px(actor.position.x), pz(actor.position.z)); ctx.lineTo(px(actor.position.x - Math.sin(actor.yaw) * 3), pz(actor.position.z - Math.cos(actor.yaw) * 3)); ctx.stroke();
      }
    }
  }
}
