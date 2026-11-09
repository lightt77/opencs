import type { Game } from './game';
import { DEFAULTS, PRIMARIES, ROUND_LIMIT, TDM_LIMIT, WEAPON_IDS, WEAPONS, isGrenade, loadSettings, type Settings, type WeaponId } from './config';
import { MAPS, type Arena } from './maps';
import { clamp } from './math';
import { SOUND_PACKS, soundPackDescription } from './audio';
import { CUSTOM_WEAPONS } from './custom-audio';
import { Vector3 } from 'three';
import { BOT_PROFILES, profileLabel, sanitizeProfiles } from './bot-profiles';

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

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
      ${(arena.sites ?? []).map(site => `<text x="${site.x * sx + 29}" y="${site.z * sz + 34}" fill="#edb978" font-size="6" font-family="monospace" font-weight="bold" text-anchor="middle">${site.label}</text>`).join('')}
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
  private popupElements = new Map<number, HTMLElement>();
  private popupPoint = new Vector3();
  private lanName = '';

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
    game.lan.onChange = () => {
      if (game.screen === 'menu' && this.overlay.querySelector('.lan-dialog')) this.lanDialog();
      if (game.screen === 'menu' && game.lan.status && !this.overlay.querySelector('.lan-dialog')) this.lanDialog();
    };
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
          <div class="eyebrow"><span class="tiny-cross">+</span> SOLO OR LOCAL WI-FI. SQUAD MENTALITY.</div>
          <h1 id="hero-title">SMALL MAPS.<br><span>BIG STAKES.</span></h1>
          <p class="intro">Old-school gunplay. A fresh field of play.<br><span>Find your angle. Trust your squad. Make every shot count.</span></p>
          <div class="section-label"><span>01 — SELECT YOUR BATTLEFIELD</span><span class="quiet">${Object.keys(MAPS).length} AVAILABLE</span></div>
          <div class="map-grid" role="group" aria-label="Battlefield">
            ${Object.values(MAPS).map((map, i) => `<button class="map-card ${s.map === map.id ? 'selected' : ''}" data-map="${map.id}" aria-pressed="${s.map === map.id}" aria-label="${map.name}">
              <span class="map-number">0${i + 1}</span><span class="map-check">↗</span>${mapSvg(map)}
              <span class="map-caption"><strong>${map.name}</strong><small>${map.subtitle.split(' / ')[1]}</small></span>
            </button>`).join('')}
          </div>
          <div class="field-stats"><span><b>${s.teamSize} <i>vs</i> ${s.teamSize}</b> SQUAD COMBAT</span><span><b>08</b> WEAPONS & UTILITY</span><span><b>100%</b> IN YOUR BROWSER</span></div>
        </section>
        <aside class="setup-card" aria-labelledby="setup-title">
          <div class="setup-heading"><div><span class="eyebrow">YOUR NEXT MATCH</span><h2 id="setup-title">MISSION SETUP</h2></div><span class="card-cross">${cross}</span></div>
          <div class="setup-content">
            <div class="control-label"><span>GAME MODE</span><span>02</span></div>
            <div class="mode-options" role="group" aria-label="Game mode">
              <button data-mode="tdm" class="mode-option ${s.mode === 'tdm' ? 'selected' : ''}" aria-pressed="${s.mode === 'tdm'}"><span class="mode-icon">≋</span><span><strong>TEAM DEATHMATCH</strong><small>Respawn. Regroup. First to ${TDM_LIMIT}.</small></span><span class="radio"></span></button>
              <button data-mode="elimination" class="mode-option ${s.mode === 'elimination' ? 'selected' : ''}" aria-pressed="${s.mode === 'elimination'}"><span class="mode-icon">◇</span><span><strong>ELIMINATION</strong><small>One life. Every angle matters.</small></span><span class="radio"></span></button>
            </div>
            <div class="control-label"><span>BOT DIFFICULTY</span><button class="text-button" id="bot-profiles">BOT PROFILES ↗</button></div>
            <div class="segments" role="group" aria-label="Bot difficulty">${(['easy', 'medium', 'hard'] as const).map(d => `<button data-difficulty="${d}" class="${s.difficulty === d ? 'selected' : ''}" aria-pressed="${s.difficulty === d}">${d.toUpperCase()}</button>`).join('')}</div>
             <div class="control-label"><span>PRIMARY WEAPON</span><span>${s.map === 'longshot' ? 'AWP RECOMMENDED' : 'ALLOWED LOADOUT'}</span></div>
             <div class="segments weapons" role="group" aria-label="Primary weapon">${PRIMARIES.map(id => `<button data-primary="${id}" ${s.allowedWeapons.includes(id) ? '' : 'disabled'} class="${s.primary === id && s.allowedWeapons.includes(id) ? 'selected' : ''}" aria-pressed="${s.primary === id && s.allowedWeapons.includes(id)}"><span class="weapon-glyph">${id === 'awp' ? '━╋━' : '━┳┓'}</span>${WEAPONS[id].name}</button>`).join('')}</div>
             <button class="secondary-button rules-button" id="weapon-rules">WEAPON RULES · ${s.allowedWeapons.map(id => WEAPONS[id].short).join(' + ')}</button>
            <div class="squad-note"><span class="status-dot"></span> YOU + ${s.teamSize - 1} ALLIES <span>VS</span> ${s.teamSize} ENEMY BOTS</div>
            <button class="deploy-button" id="deploy"><span>DEPLOY TO ${s.map.toUpperCase()}</span>${arrow}</button>
            <button class="secondary-button rules-button" id="lan-play">LOCAL WI-FI · HOST / JOIN ROOM</button>
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
    this.menu.querySelector('#deploy')!.addEventListener('click', () => { if (this.game.lan.room) this.game.lan.leave(); this.save(); this.game.start(this.settings); });
    this.menu.querySelector('#lan-play')!.addEventListener('click', () => this.lanDialog());
    this.menu.querySelector('#open-settings')!.addEventListener('click', () => this.openSettings());
    this.menu.querySelector('#open-controls')!.addEventListener('click', () => this.controls());
    this.menu.querySelector('#weapon-rules')!.addEventListener('click', () => { this.openSettings(); this.overlay.querySelector('#match-rules')!.scrollIntoView(); });
    this.menu.querySelector('#bot-profiles')!.addEventListener('click', () => { this.openSettings(); this.overlay.querySelector('#bot-personalities')!.scrollIntoView(); });
  }

  private lanDialog() {
    const lan = this.game.lan, room = lan.room;
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<section class="dialog lan-dialog" role="dialog" aria-modal="true" aria-labelledby="lan-title">
      <div class="dialog-title"><div><span class="eyebrow">SAME WI-FI. SAME BATTLEFIELD.</span><h2 id="lan-title">${room ? 'ROOM ' + room.key : 'LOCAL WI-FI'}</h2></div><button class="close-button" aria-label="Close LAN room">×</button></div>
      ${room ? `<p>${['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) ? 'Share the Network URL printed by npm run lan (localhost cannot be shared)' : `Share <strong>${escapeHTML(location.origin)}</strong>`} and room key <strong id="room-key">${room.key}</strong>. Other computers must use this host's Wi-Fi IP address, not localhost.</p>
        <p>${room.settings.teamSize} slots per team · ${room.settings.botFill ? 'empty slots filled by bots' : 'human players only'} · ${MAPS[room.settings.map].name} · ${room.settings.mode.toUpperCase()}</p>
        <div class="lan-roster">${(['blue', 'red'] as const).map(team => `<section><h3 class="${team}-text">${team.toUpperCase()}</h3>${room.members.filter(m => m.team === team).map(m => `<p>${escapeHTML(m.name)}${m.id === lan.id ? ' / YOU' : ''}${m.id === room.host ? ' / HOST' : ''}</p>`).join('')}<button class="secondary-button" data-team="${team}">JOIN ${team.toUpperCase()}</button></section>`).join('')}</div>
        <p class="settings-hint">Human teams may differ by at most one. A choice that would unbalance teams is blocked. Team size and match rules are locked when the room is created.</p>
        ${lan.host ? '<button class="deploy-button" id="lan-start">START LAN MATCH</button>' : '<p>Waiting for the host to start…</p>'}
        <button class="text-button exit-button" id="lan-leave">LEAVE ROOM</button>` : `
        <p>On the host computer run <code>npm run lan</code> (development), or <code>npm run build</code> then <code>npm start</code>. Open its network URL on every computer.</p>
        <label class="slider-label" for="lan-name">PLAYER NAME</label><input class="pack-select" id="lan-name" maxlength="18" placeholder="Your callsign" value="${escapeHTML(this.lanName)}" />
        <label class="slider-label" for="lan-team">PREFERRED TEAM</label><select id="lan-team" class="pack-select"><option value="blue">BLUE</option><option value="red">RED</option></select>
        <p class="settings-hint">Host uses Mission Setup / Settings: ${this.settings.teamSize} slots per team, ${this.settings.botFill ? 'bot fill on' : 'humans only'}. Configure these before creating a room.</p>
        <button class="deploy-button" id="lan-create">CREATE ROOM</button>
        <label class="slider-label" for="lan-key">SHARED ROOM KEY</label><input class="pack-select" id="lan-key" maxlength="6" placeholder="ABC123" autocomplete="off" />
        <button class="secondary-button rules-button" id="lan-join">JOIN ROOM</button>`}
      <p id="lan-status" class="settings-hint" role="status">${escapeHTML(lan.status)}</p>
      <p class="dialog-footnote">LAN only; no matchmaking, port forwarding or accounts. The host browser runs the simulation: keep it open and in the foreground. ESC releases your mouse but does not pause a shared match. Players join before the match starts.</p>
    </section>`;
    this.overlay.querySelector('.close-button')!.addEventListener('click', () => this.closeDialog());
    const request = async (type: 'create' | 'join') => {
      this.lanName = this.overlay.querySelector<HTMLInputElement>('#lan-name')!.value;
      const team = this.overlay.querySelector<HTMLSelectElement>('#lan-team')!.value;
      const key = this.overlay.querySelector<HTMLInputElement>('#lan-key')!.value;
      const buttons = this.overlay.querySelectorAll<HTMLButtonElement>('#lan-create, #lan-join'); buttons.forEach(b => b.disabled = true);
      try { await lan.connect(); lan.send({ type, name: this.lanName, team, key, primary: this.settings.primary, settings: this.settings }); }
      catch (error) { lan.status = error instanceof Error ? error.message : 'LAN connection failed.'; this.lanDialog(); }
      finally { buttons.forEach(b => b.disabled = false); }
    };
    this.overlay.querySelector('#lan-create')?.addEventListener('click', () => { void request('create'); });
    this.overlay.querySelector('#lan-join')?.addEventListener('click', () => { void request('join'); });
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-team]').forEach(b => b.addEventListener('click', () => lan.send({ type: 'team', team: b.dataset.team })));
    this.overlay.querySelector('#lan-start')?.addEventListener('click', () => lan.send({ type: 'start' }));
    this.overlay.querySelector('#lan-leave')?.addEventListener('click', () => { lan.leave(); this.lanDialog(); });
  }

  private buildHUD() {
    this.hud.innerHTML = `
      <div class="hud-vignette"></div><div class="damage-wash" id="damage-wash"></div><div class="flash-wash" id="flash-wash"></div>
      <div class="smoke-wash" id="smoke-wash"></div>
      <div class="hud-map"><div class="hud-map-title"><span class="status-dot"></span><span id="map-name"></span></div><canvas width="196" height="220" aria-label="Tactical minimap"></canvas><span class="map-footer">N ↑ <span id="location-name">FRIENDLIES ONLY</span></span></div>
      <div class="match-strip"><div class="team-score blue"><span>BLUE</span><b id="blue-score">0</b></div><div class="match-clock"><strong id="clock">06:00</strong><span id="match-label">FIRST TO 40</span></div><div class="team-score red"><b id="red-score">0</b><span>RED</span></div></div>
      <div class="performance"><b id="fps">60 FPS</b><span>LOCAL MATCH · <span id="difficulty-label">MEDIUM</span></span></div>
      <div class="kill-feed" id="kill-feed"></div>
      <div class="radio-message" id="radio-message" aria-live="polite" hidden></div>
      <div class="grenade-charge" id="grenade-charge" hidden><span id="charge-label"></span><progress id="charge-progress" max="1" value="0"></progress></div>
      <div class="announcement" id="announcement"></div>
      <div class="crosshair" id="crosshair"><i></i><i></i><i></i><i></i><b></b></div>
      <div class="hit-marker" id="hit-marker">╳</div>
      <div class="damage-numbers" id="damage-numbers" aria-label="Damage dealt"></div>
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
    if (screen === 'loadout') this.roundLoadout();
    this.root.classList.toggle('in-game', screen !== 'menu');
    this.lastBoard = ''; this.lastHUD = 0;
  }

  private pauseHTML() {
    this.overlay.innerHTML = `<section class="dialog pause-dialog"><span class="eyebrow">TAKE A BREATHER</span><h2>${this.game.network ? 'MOUSE RELEASED' : 'MATCH PAUSED'}</h2><p>${this.game.network ? 'The LAN match is still live. Your operator can be attacked while this menu is open.' : 'The battlefield can wait.<br>Your match is paused while the mouse is released.'}</p>
      <button class="deploy-button" id="resume"><span>BACK IN THE FIGHT</span>${arrow}</button>
      <div class="pause-actions"><button class="secondary-button" id="pause-settings">SETTINGS</button><button class="secondary-button" id="pause-controls">CONTROLS</button></div>
      <button class="text-button exit-button" id="leave">LEAVE MATCH</button>
    </section>`;
    this.overlay.querySelector('#resume')!.addEventListener('click', () => this.game.resume());
    this.overlay.querySelector('#pause-settings')!.addEventListener('click', () => this.openSettings());
    this.overlay.querySelector('#pause-controls')!.addEventListener('click', () => this.controls());
    this.overlay.querySelector('#leave')!.addEventListener('click', () => this.game.toMenu());
  }

  private roundLoadout() {
    const g = this.game;
    let selected = PRIMARIES.find(id => id === this.settings.primary && g.settings.allowedWeapons.includes(id)) ?? PRIMARIES.find(id => g.settings.allowedWeapons.includes(id)) ?? this.settings.primary;
    this.overlay.innerHTML = `<section class="dialog round-loadout" role="dialog" aria-modal="true" aria-labelledby="round-loadout-title">
      <span class="eyebrow">ROUND ${g.round} COMPLETE · BLUE ${g.scores.blue} : ${g.scores.red} RED</span>
      <h2 id="round-loadout-title">NEXT ROUND LOADOUT</h2><p>${g.announcement}<br>Choose your primary for round ${g.round + 1}. No rush—the match is waiting.</p>
      <div class="result-score round-score" aria-label="Total team scores"><span class="blue-text">${g.scores.blue}<small>BLUE ROUNDS · ${g.actors.filter(a => a.team === 'blue').reduce((sum, a) => sum + a.kills, 0)} KILLS</small></span><i>:</i><span class="red-text">${g.scores.red}<small>RED ROUNDS · ${g.actors.filter(a => a.team === 'red').reduce((sum, a) => sum + a.kills, 0)} KILLS</small></span></div>
      <div class="round-board" aria-label="Player scores">${this.scoreboardHTML(true)}</div>
      <div class="segments weapons" role="group" aria-label="Next round primary">${PRIMARIES.filter(id => g.settings.allowedWeapons.includes(id)).map(id => `<button data-round-primary="${id}" class="${id === selected ? 'selected' : ''}" aria-pressed="${id === selected}">${WEAPONS[id].name}</button>`).join('')}</div>
      <p class="loadout-note">Allowed weapons: ${g.settings.allowedWeapons.map(id => WEAPONS[id].short).join(' + ')}. Allowed ammunition and up to ${g.settings.grenadeCapacity} total grenades replenish at round start. Scores persist.</p>
      <button class="secondary-button rules-button" id="round-rules">CHANGE NEXT ROUND WEAPON RULES</button>
      <button class="deploy-button" id="continue-round" ${g.network && !g.lan.host ? 'disabled' : ''}><span>${g.network && !g.lan.host ? 'WAITING FOR HOST' : `START ROUND ${g.round + 1}`}</span>${arrow}</button>
      <button class="text-button exit-button" id="loadout-leave">LEAVE MATCH</button>
    </section>`;
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-round-primary]').forEach(button => button.addEventListener('click', () => {
      selected = button.dataset.roundPrimary as Settings['primary'];
      if (g.network && !g.lan.host) { this.settings.primary = selected; this.save(); g.lan.send({ type: 'primary', primary: selected }); }
      this.overlay.querySelectorAll<HTMLButtonElement>('[data-round-primary]').forEach(b => {
        const active = b.dataset.roundPrimary === selected; b.classList.toggle('selected', active); b.setAttribute('aria-pressed', String(active));
      });
    }));
    this.overlay.querySelector('#continue-round')!.addEventListener('click', () => {
      if (g.continueRound(selected)) { this.settings.primary = selected; this.save(); }
    });
    this.overlay.querySelector('#loadout-leave')!.addEventListener('click', () => g.toMenu());
    this.overlay.querySelector('#round-rules')!.addEventListener('click', () => { this.openSettings(); this.overlay.querySelector('#match-rules')!.scrollIntoView(); });
    this.overlay.querySelector<HTMLButtonElement>('[aria-pressed="true"], #continue-round')!.focus({ preventScroll: true });
  }

  private closeDialog() {
    if (this.overlay.querySelector('.custom-audio-dialog')) { this.openSettings(); return; }
    if (this.game.screen === 'paused') this.pauseHTML();
    else if (this.game.screen === 'loadout') this.roundLoadout();
    else { this.overlay.hidden = true; this.overlay.innerHTML = ''; if (this.game.screen === 'menu') { this.game.preview(this.settings); this.renderMenu(); } }
  }

  private openSettings() {
    this.overlay.hidden = false;
    const s = this.game.network ? { ...this.game.settings, primary: this.game.player.primary } : this.settings;
    this.overlay.innerHTML = `<section class="dialog settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title"><div class="dialog-title"><div><span class="eyebrow">MAKE IT YOURS</span><h2 id="settings-title">SETTINGS</h2></div><button class="close-button" aria-label="Close settings">×</button></div>
      <div class="settings-grid"><section aria-labelledby="movement-title"><h3 id="movement-title">INPUT & MOVEMENT</h3>
      <h3>TEAM SIZES & LAN BOTS</h3>
      <label class="slider-label" for="teamSize">OPERATORS PER TEAM <output>${s.teamSize}</output></label><input id="teamSize" type="range" min="1" max="10" step="1" value="${s.teamSize}" />
      <label class="checkbox-label"><span>FILL LAN TEAMS WITH BOTS <small>Off: human-only room. On: bots fill remaining team slots at match start. Solo always uses bots.</small></span><input id="botFill" type="checkbox" ${s.botFill ? 'checked' : ''} /></label>
      <label class="slider-label" for="sensitivity">MOUSE SENSITIVITY <output>${s.sensitivity.toFixed(2)}</output></label><input id="sensitivity" type="range" min="0.25" max="2.5" step="0.05" value="${s.sensitivity}" />
      <label class="slider-label" for="movementSpeed">MOVEMENT SPEED <output>${s.movementSpeed.toFixed(1)}×</output></label><input id="movementSpeed" type="range" min="0.5" max="2" step="0.1" value="${s.movementSpeed}" />
      <label class="slider-label" for="jumpGravity">JUMP GRAVITY <output>${s.jumpGravity} m/s²</output></label><input id="jumpGravity" type="range" min="10" max="35" step="1" value="${s.jumpGravity}" />
      <label class="checkbox-label"><span>DOUBLE JUMP <small>Press Space again in the air for one extra jump.</small></span><input id="doubleJump" type="checkbox" ${s.doubleJump ? 'checked' : ''} /></label>
      <h3>ROUND TIMING</h3>
      <label class="slider-label" for="freezeTime">START FREEZE <output>${s.freezeTime}s</output></label><input id="freezeTime" type="range" min="0" max="10" step="0.5" value="${s.freezeTime}" />
      <label class="slider-label" for="roundEndDelay">ROUND-END BUFFER <output>${s.roundEndDelay}s</output></label><input id="roundEndDelay" type="range" min="0" max="6" step="0.5" value="${s.roundEndDelay}" />
      <p class="settings-hint">Hold Shift + forward to sprint. Hold Ctrl or C to crouch and move quietly. Round-end buffer plays before loadout/results.</p>
      <p class="settings-hint">Speed applies to both teams. Lower gravity makes jumps higher and floatier. Grenade gravity is unchanged.</p>
      </section><section aria-labelledby="audio-video-title"><h3 id="audio-video-title">AUDIO & VIDEO</h3>
      <label class="slider-label" for="volume">MASTER VOLUME <output>${s.volume}%</output></label><input id="volume" type="range" min="0" max="100" value="${s.volume}" />
      <label class="slider-label" for="soundPack">GUNSHOT SOUND PACK</label>
      <select id="soundPack" class="pack-select">${Object.entries(SOUND_PACKS).map(([id, pack]) => `<option value="${id}" ${s.soundPack === id ? 'selected' : ''}>${pack.name}</option>`).join('')}<option value="assets" ${s.soundPack === 'assets' ? 'selected' : ''}>ASSET RECORDINGS</option><option value="custom" ${s.soundPack === 'custom' ? 'selected' : ''}>CUSTOM / YOUR FILES</option></select>
      <p class="pack-description" id="pack-description">${soundPackDescription(s.soundPack)}</p>
      <button class="secondary-button preview-sound" id="preview-sound">▶ PREVIEW ${WEAPONS[s.primary].name} GUNSHOT</button>
      <button class="secondary-button manage-sounds" id="manage-sounds">IMPORT / MANAGE CUSTOM SOUNDS</button>
      <label class="slider-label" for="effectsPack">MOVEMENT & EFFECT SOUNDS</label><select id="effectsPack" class="pack-select"><option value="assets" ${s.effectsPack === 'assets' ? 'selected' : ''}>ASSET RECORDINGS</option><option value="classic" ${s.effectsPack === 'classic' ? 'selected' : ''}>CLASSIC SYNTHESIZED</option></select>
      <p class="settings-hint">Footsteps, jumps, scope zoom, reloads, HE and flash sounds.</p>
      <label class="checkbox-label"><span>RADIO CHATTER & DEATH VOICES <small>Team observations, reactions and victories. No overlapping radio callouts.</small></span><input id="radioChatter" type="checkbox" ${s.radioChatter ? 'checked' : ''} /></label>
      <label class="slider-label" for="radioVolume">VOICE VOLUME <output>${s.radioVolume}%</output></label><input id="radioVolume" type="range" min="0" max="100" value="${s.radioVolume}" />
      <label class="slider-label" for="fov">FIELD OF VIEW <output>${s.fov}°</output></label><input id="fov" type="range" min="70" max="105" value="${s.fov}" />
      <label class="checkbox-label"><span>SOFT SHADOWS <small>Turn off for a lighter GPU workload.</small></span><input id="shadows" type="checkbox" ${s.shadows ? 'checked' : ''} /></label>
      </section></div>
      <section id="match-rules"><h3>MATCH WEAPON RULES · BOTH TEAMS</h3>
      <div class="rule-presets">${['all', 'awp', 'awp-ak', 'usp', 'knife', 'grenades'].map(id => `<button class="secondary-button" data-preset="${id}">${({ all: 'ALL', awp: 'AWP ONLY', 'awp-ak': 'AWP + AK', usp: 'USP ONLY', knife: 'KNIFE ONLY', grenades: 'GRENADES ONLY' })[id]}</button>`).join('')}</div>
      <div class="weapon-rules" role="group" aria-label="Allowed weapons">${WEAPON_IDS.map(id => `<label><input type="checkbox" data-allowed="${id}" ${s.allowedWeapons.includes(id) ? 'checked' : ''} />${WEAPONS[id].name}</label>`).join('')}</div>
      <p class="settings-hint" id="rules-hint">One allowed primary per operator, plus allowed sidearm/knife/utility. At least one weapon must remain enabled. Changes apply on deployment or next round; grenades-only elimination has limited ammunition.</p>
      <label class="slider-label" for="grenadeCapacity">TOTAL CARRIED GRENADES <output>${s.grenadeCapacity}</output></label><input id="grenadeCapacity" type="range" min="1" max="3" step="1" value="${s.grenadeCapacity}" />
      <label class="slider-label" for="refillDelay">DEATHMATCH REFILL DELAY <output>${s.refillDelay}s</output></label><input id="refillDelay" type="range" min="1" max="30" step="1" value="${s.refillDelay}" />
      <h3>GRENADE THROW & PHYSICS</h3>
      <label class="slider-label" for="grenadePower">MAX THROW SPEED <output>${s.grenadePower} m/s</output></label><input id="grenadePower" type="range" min="12" max="65" step="1" value="${s.grenadePower}" />
      <label class="slider-label" for="grenadeWeight">GRENADE WEIGHT</label><select id="grenadeWeight" class="pack-select">${['light', 'normal', 'heavy'].map(w => `<option value="${w}" ${s.grenadeWeight === w ? 'selected' : ''}>${w.toUpperCase()}</option>`).join('')}</select>
      <label class="checkbox-label"><span>BOUNCY GRENADES <small>On: lively rebounds. Off: deadened impacts. Weight changes drop and drag, not charge time.</small></span><input id="grenadeBounce" type="checkbox" ${s.grenadeBounce ? 'checked' : ''} /></label>
      <p class="settings-hint">Hold LMB up to 1.5s, release to throw. Default cap 34 m/s; up to 65 m/s. Throws inherit some running momentum. Both teams use the same physics.</p>
      <label class="slider-label" for="wallShots">BULLET WALL PENETRATION</label><select id="wallShots" class="pack-select"><option value="walls" ${s.wallShots === 'walls' ? 'selected' : ''}>ALL WALLS · REDUCED DAMAGE</option><option value="thin" ${s.wallShots === 'thin' ? 'selected' : ''}>THIN COVER ONLY</option><option value="off" ${s.wallShots === 'off' ? 'selected' : ''}>OFF</option></select><p class="settings-hint">Floors always block bullets. Bots still need line of sight.</p>
      </section>
      <section id="bot-personalities"><h3>BOT PERSONALITIES · BOTH TEAMS</h3>
      <p class="settings-hint">Shuffle enabled profiles across active bots each round. No repeats until the pool is used; deathmatch respawns keep their profile. Skill controls aim/reaction, Co-op controls sharing/regrouping, and Bravery controls stealth/assault. Difficulty scales all profiles. Changes apply next match or round.</p>
      <div class="profile-table" role="group" aria-label="Bot personality profiles"><div class="profile-head"><span>USE / PROFILE</span><span>SKILL</span><span>CO-OP</span><span>BRAVERY</span></div>
      ${s.botProfiles.map(p => `<div class="profile-row" data-profile="${p.id}"><label><input type="checkbox" data-profile-enabled="${p.id}" aria-label="Enable ${p.name} profile" ${p.enabled ? 'checked' : ''} />${p.name}</label>${(['skill', 'coop', 'bravery'] as const).map(key => `<select data-profile-trait="${key}" aria-label="${p.name} ${key === 'coop' ? 'Co-op' : key}">${(key === 'skill' ? ['low', 'mid', 'high'] : ['low', 'high']).map(value => `<option value="${value}" ${p[key] === value ? 'selected' : ''}>${value.toUpperCase()}</option>`).join('')}</select>`).join('')}</div>`).join('')}</div>
      <p class="settings-hint" id="profile-hint" role="status">${s.botProfiles.filter(p => p.enabled).length} profiles enabled. Keep at least one selected.</p>
      <button class="secondary-button" id="reset-profiles">RESET BOT PROFILES</button>
      </section>
      <button class="secondary-button" id="reset-settings">RESTORE DEFAULTS</button><p class="dialog-footnote">Saved on this device. Match options stay unchanged.</p>
    </section>`;
    for (const key of ['sensitivity', 'volume', 'fov', 'movementSpeed', 'jumpGravity', 'freezeTime', 'roundEndDelay', 'radioVolume', 'grenadeCapacity', 'refillDelay', 'teamSize', 'grenadePower'] as const) {
      const input = this.overlay.querySelector<HTMLInputElement>(`#${key}`)!;
      input.addEventListener('input', () => {
        this.settings[key] = Number(input.value);
        const value = this.settings[key];
        input.previousElementSibling!.querySelector('output')!.textContent = key === 'sensitivity' ? value.toFixed(2) : key === 'movementSpeed' ? `${value.toFixed(1)}×` : `${value}${key === 'fov' ? '°' : key === 'jumpGravity' ? ' m/s²' : key === 'grenadePower' ? ' m/s' : key === 'freezeTime' || key === 'roundEndDelay' || key === 'refillDelay' ? 's' : key === 'grenadeCapacity' || key === 'teamSize' ? '' : '%'}`;
        this.applySettings();
      });
    }
    for (const key of ['shadows', 'doubleJump', 'radioChatter', 'botFill', 'grenadeBounce'] as const) {
      this.overlay.querySelector(`#${key}`)!.addEventListener('change', event => {
        this.settings[key] = (event.target as HTMLInputElement).checked; this.applySettings();
      });
    }
    for (const key of ['effectsPack', 'wallShots', 'grenadeWeight'] as const) this.overlay.querySelector(`#${key}`)!.addEventListener('change', event => {
      Object.assign(this.settings, { [key]: (event.target as HTMLSelectElement).value }); this.applySettings();
    });
    const updateRules = (weapons: WeaponId[]) => {
      if (!weapons.length) { this.overlay.querySelector('#rules-hint')!.textContent = 'Keep at least one weapon enabled.'; return false; }
      this.settings.allowedWeapons = weapons;
      if (!weapons.includes(this.settings.primary)) this.settings.primary = PRIMARIES.find(id => weapons.includes(id)) ?? this.settings.primary;
      this.overlay.querySelectorAll<HTMLInputElement>('[data-allowed]').forEach(input => { input.checked = weapons.includes(input.dataset.allowed as WeaponId); });
      this.applySettings(); return true;
    };
    this.overlay.querySelectorAll<HTMLInputElement>('[data-allowed]').forEach(input => input.addEventListener('change', () => {
      const weapons = WEAPON_IDS.filter(id => this.overlay.querySelector<HTMLInputElement>(`[data-allowed="${id}"]`)!.checked);
      if (!updateRules(weapons)) input.checked = true;
    }));
    const presets: Record<string, WeaponId[]> = { all: [...WEAPON_IDS], awp: ['awp'], 'awp-ak': ['ak', 'awp'], usp: ['pistol'], knife: ['knife'], grenades: ['he', 'flash', 'smoke'] };
    this.overlay.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button => button.addEventListener('click', () => { updateRules(presets[button.dataset.preset!]); }));
    this.overlay.querySelectorAll<HTMLElement>('[data-profile]').forEach(row => {
      const profile = this.settings.botProfiles.find(p => p.id === row.dataset.profile)!;
      row.querySelector<HTMLInputElement>('input')!.addEventListener('change', event => {
        const input = event.target as HTMLInputElement;
        if (!input.checked && this.settings.botProfiles.filter(p => p.enabled).length === 1) {
          input.checked = true; this.overlay.querySelector('#profile-hint')!.textContent = 'Keep at least one profile selected.'; return;
        }
        profile.enabled = input.checked;
        this.overlay.querySelector('#profile-hint')!.textContent = `${this.settings.botProfiles.filter(p => p.enabled).length} profiles enabled. Changes apply next match or round.`;
        this.applySettings();
      });
      row.querySelectorAll<HTMLSelectElement>('select').forEach(select => select.addEventListener('change', () => {
        Object.assign(profile, { [select.dataset.profileTrait!]: select.value }); this.applySettings();
      }));
    });
    this.overlay.querySelector('#reset-profiles')!.addEventListener('click', () => {
      this.settings.botProfiles = sanitizeProfiles(BOT_PROFILES); this.applySettings(); this.openSettings();
      this.overlay.querySelector('#bot-personalities')!.scrollIntoView();
    });
    this.overlay.querySelector('#soundPack')!.addEventListener('change', event => {
      this.settings.soundPack = (event.target as HTMLSelectElement).value as Settings['soundPack'];
      this.overlay.querySelector('#pack-description')!.textContent = soundPackDescription(this.settings.soundPack);
      this.applySettings();
    });
    this.overlay.querySelector('#preview-sound')!.addEventListener('click', () => { void this.game.sound.preview(this.settings.primary); });
    this.overlay.querySelector('#manage-sounds')!.addEventListener('click', () => this.customAudioDialog());
    this.overlay.querySelector('#reset-settings')!.addEventListener('click', () => {
      Object.assign(this.settings, { sensitivity: DEFAULTS.sensitivity, volume: DEFAULTS.volume, fov: DEFAULTS.fov, shadows: DEFAULTS.shadows, movementSpeed: DEFAULTS.movementSpeed, doubleJump: DEFAULTS.doubleJump, jumpGravity: DEFAULTS.jumpGravity, soundPack: DEFAULTS.soundPack, freezeTime: DEFAULTS.freezeTime, roundEndDelay: DEFAULTS.roundEndDelay, effectsPack: DEFAULTS.effectsPack, radioChatter: DEFAULTS.radioChatter, radioVolume: DEFAULTS.radioVolume });
      this.applySettings(); this.openSettings();
    });
    this.overlay.querySelector('.close-button')!.addEventListener('click', () => this.closeDialog());
    (this.overlay.querySelector('.close-button') as HTMLButtonElement).focus();
    if (this.game.network) {
      const local = new Set(['sensitivity', 'volume', 'fov', 'shadows', 'soundPack', 'effectsPack', 'radioChatter', 'radioVolume']);
      this.overlay.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select').forEach(el => { if (!local.has(el.id)) el.disabled = true; });
      this.overlay.querySelectorAll<HTMLButtonElement>('[data-preset], #reset-profiles, #reset-settings').forEach(el => el.disabled = true);
      this.overlay.querySelector('.dialog-footnote')!.textContent = 'LAN match rules are locked for every player. Sound, mouse and display preferences remain local. Create a new room to change rules.';
    }
  }

  private customAudioDialog() {
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<section class="dialog custom-audio-dialog" role="dialog" aria-modal="true" aria-labelledby="custom-audio-title">
      <div class="dialog-title"><div><span class="eyebrow">YOUR GUNS. YOUR SOUND.</span><h2 id="custom-audio-title">CUSTOM SOUND PACK</h2></div><button class="close-button" aria-label="Back to settings">×</button></div>
      <p>Choose one gunshot file for each weapon you want to replace. Files stay on this device; nothing is uploaded.</p>
      <div class="custom-audio-rows">${CUSTOM_WEAPONS.map(id => `<div class="custom-audio-row">
        <div><strong>${WEAPONS[id].name}</strong><span class="sample-name" data-sample-name="${id}">Classic fallback</span></div>
        <div class="sample-actions"><label class="secondary-button file-picker">CHOOSE FILE<input type="file" id="custom-${id}" accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg" aria-label="Import ${WEAPONS[id].name} gunshot" /></label><button class="secondary-button" data-preview-audio="${id}" aria-label="Preview ${WEAPONS[id].name} custom gunshot">▶</button><button class="secondary-button" data-remove-audio="${id}" aria-label="Remove ${WEAPONS[id].name} custom gunshot">×</button></div>
      </div>`).join('')}</div>
      <p class="custom-audio-status" id="custom-audio-status" role="status" aria-live="polite">WAV / MP3 / OGG · max 2 MB and 5 seconds per file. PCM WAV is the most portable.</p>
      <p class="dialog-footnote">Importing selects Custom automatically. Missing samples use Classic. Samples are saved in this browser's local database; clearing site data removes them. ZIP archives must be extracted first. Use audio you own or have permission to use.</p>
      <button class="secondary-button" id="custom-audio-back">BACK TO SETTINGS</button>
    </section>`;
    const dialog = this.overlay.querySelector<HTMLElement>('.custom-audio-dialog')!;
    const status = dialog.querySelector<HTMLElement>('#custom-audio-status')!;
    let busy = false;
    const refresh = () => {
      for (const id of CUSTOM_WEAPONS) {
        const name = this.game.sound.customName(id);
        dialog.querySelector(`[data-sample-name="${id}"]`)!.textContent = name ?? 'Classic fallback';
        dialog.querySelector<HTMLInputElement>(`#custom-${id}`)!.disabled = busy;
        dialog.querySelector<HTMLButtonElement>(`[data-preview-audio="${id}"]`)!.disabled = busy || !name;
        dialog.querySelector<HTMLButtonElement>(`[data-remove-audio="${id}"]`)!.disabled = busy || !name;
      }
    };
    void this.game.sound.ready.then(refresh);
    for (const id of CUSTOM_WEAPONS) {
      const input = dialog.querySelector<HTMLInputElement>(`#custom-${id}`)!;
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; if (!file || busy) return;
        busy = true; refresh(); status.classList.remove('error'); status.textContent = 'Checking and loading audio…';
        try {
          const result = await this.game.sound.importShot(id, file);
          this.settings.soundPack = 'custom'; this.applySettings();
          status.textContent = result.persisted ? `${WEAPONS[id].name} loaded and saved locally. Custom pack selected.` : `${WEAPONS[id].name} loaded for this session only. Browser storage is unavailable or full.`;
        } catch (error) {
          status.textContent = error instanceof Error ? error.message : 'Could not import this audio.'; status.classList.add('error');
        } finally { busy = false; input.value = ''; refresh(); }
      });
      dialog.querySelector(`[data-preview-audio="${id}"]`)!.addEventListener('click', () => { void this.game.sound.previewCustom(id); });
      dialog.querySelector(`[data-remove-audio="${id}"]`)!.addEventListener('click', async () => {
        if (busy) return; busy = true; refresh();
        const result = await this.game.sound.removeCustomShot(id);
        status.classList.remove('error');
        status.textContent = result.persisted ? `${WEAPONS[id].name} removed. Classic fallback is active for this weapon.` : 'Removed for this session, but browser storage could not be updated.';
        busy = false; refresh();
      });
    }
    dialog.querySelector('.close-button')!.addEventListener('click', () => this.closeDialog());
    dialog.querySelector('#custom-audio-back')!.addEventListener('click', () => this.closeDialog());
    dialog.querySelector<HTMLButtonElement>('.close-button')!.focus();
  }

  private applySettings() {
    this.save();
    if (this.game.network) {
      for (const key of ['sensitivity', 'volume', 'fov', 'shadows', 'soundPack', 'effectsPack', 'radioChatter', 'radioVolume'] as const) Object.assign(this.game.settings, { [key]: this.settings[key] });
    } else Object.assign(this.game.settings, this.settings);
    this.game.configureAudio(this.settings);
    this.game.view.renderer.shadowMap.enabled = this.settings.shadows;
  }

  private controls() {
    this.overlay.hidden = false;
    this.overlay.innerHTML = `<section class="dialog manual-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-title"><div class="dialog-title"><div><span class="eyebrow">READ THE ROOM. THEN CLEAR IT.</span><h2 id="manual-title">FIELD MANUAL</h2></div><button class="close-button" aria-label="Close manual">×</button></div>
      <div class="manual-grid">${[
        ['W A S D', 'Move'], ['SHIFT + W', 'Sprint (louder footsteps)'], ['SPACE', 'Jump / optional air jump'], ['CTRL / C', 'Hold crouch / quiet movement'], ['LMB', 'Fire / hold to charge grenade, release to throw'], ['RMB', 'AWP: zoom → 2× zoom → off'], ['R', 'Reload'], ['Q / Q Q', 'Last weapon / faster AWP cycle'], ['1 — 6', 'Equip allowed inventory slot (see HUD)'], ['WHEEL', 'Cycle weapons'], ['TAB', 'Scoreboard'], ['ESC', 'Pause & release mouse'],
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
      <div class="round-board" aria-label="Player scores">${this.scoreboardHTML(true)}</div>
      <button class="deploy-button" id="rematch"><span>${g.network ? 'NEW LAN ROOM' : 'RUN IT BACK'}</span>${arrow}</button><button class="text-button exit-button" id="back-menu">BACK TO MISSION SETUP</button>
    </section>`;
    this.overlay.querySelector('#rematch')!.addEventListener('click', () => { if (g.network) { g.toMenu(); this.lanDialog(); } else g.start(this.settings); });
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
    e['crosshair'].hidden = p.weapon === 'awp' || g.scoped || !p.alive;
    const radio = g.radio.message;
    e['radio-message'].hidden = !g.settings.radioChatter || !radio || g.time >= radio.until;
    if (radio) this.set('radio-message', `[RADIO] ${radio.speaker}: ${radio.text}`);
    e['grenade-charge'].hidden = g.grenadeCharge === undefined || !p.alive;
    if (g.grenadeCharge !== undefined) {
      (e['charge-progress'] as HTMLProgressElement).value = g.grenadeCharge;
      this.set('charge-label', `THROW POWER ${Math.round(g.grenadeCharge * 100)}% · RELEASE LMB`);
    }
    const gap = 4 + p.speed * 1.3 + p.shots * .8 + (p.body.grounded ? 0 : 12);
    e['crosshair'].style.setProperty('--gap', `${gap}px`);
    e['hit-marker'].style.opacity = String(Math.max(0, 1 - (g.time - g.hitTime) / .23));
    e['hit-marker'].classList.toggle('headshot', g.hitHead);
    this.drawDamageNumbers();
    if (performance.now() - this.lastHUD < 85) return;
    this.lastHUD = performance.now();
    this.set('map-name', g.arena.name); this.set('blue-score', String(g.scores.blue)); this.set('red-score', String(g.scores.red));
    const area = g.arena.areas?.filter(a => Math.hypot(a.x - p.position.x, a.z - p.position.z) < a.radius).sort((a, b) => Math.hypot(a.x - p.position.x, a.z - p.position.z) - Math.hypot(b.x - p.position.x, b.z - p.position.z))[0];
    this.set('location-name', area?.name ?? 'FRIENDLIES ONLY');
    this.set('clock', timeString(g.phase !== 'live' ? g.phaseTime : g.remaining));
    e['clock'].classList.toggle('time-low', g.remaining < 20 && g.phase === 'live');
    this.set('match-label', g.settings.mode === 'tdm' ? `FIRST TO ${TDM_LIMIT}` : `ROUND ${g.round} · FIRST TO ${ROUND_LIMIT}`);
    this.set('fps', `${Math.round(g.fps)} FPS`); this.set('difficulty-label', g.settings.difficulty.toUpperCase());
    this.set('health', String(p.health)); e['health-bar'].style.width = `${p.health}%`;
    e['health'].classList.toggle('low-health', p.health < 30);
    this.set('weapon-name', WEAPONS[p.weapon].name);
    this.set('clip', p.weapon === 'knife' ? '∞' : String(p.ammo[p.weapon].clip));
    this.set('reserve', String(p.ammo[p.weapon].reserve));
    const refill = p.refillTimers[p.weapon];
    this.set('weapon-status', g.grenadeCharge !== undefined ? 'HOLD TO CHARGE · RELEASE TO THROW' : p.reload > 0 ? `RELOADING · ${p.reload.toFixed(1)}s` : refill !== undefined ? `AUTO REFILL IN ${Math.ceil(refill)}s` : p.sprinting ? 'SPRINTING · FIRE TO READY WEAPON' : p.body.crouched ? 'CROUCHED · QUIET STEPS' : p.immunity > 0 ? 'SPAWN PROTECTION' : p.weapon === 'awp' ? `RMB: ZOOM ${g.scopeLevel}/2 · Q Q QUICK CYCLE` : isGrenade(p.weapon) ? 'HOLD LMB · RELEASE TO THROW' : p.weapon === 'knife' ? 'CLOSE QUARTERS' : 'STOP TO SHOOT ACCURATELY');
    this.set('announcement', g.phase === 'warmup' ? `GET READY · ${Math.ceil(g.phaseTime)}` : g.announcementTime > 0 ? g.announcement : '');
    e['announcement'].classList.toggle('visible', !!e['announcement'].textContent);
    const feed = g.kills.filter(k => g.time - k.time < 7).map(k => `<div><b class="${k.team}-text">${k.killer}</b><span>${WEAPONS[k.weapon].short}${k.head ? ' ⊕' : ''}</span><b class="${k.team === 'blue' ? 'red' : 'blue'}-text">${k.victim}</b></div>`).join('');
    if (e['kill-feed'].innerHTML !== feed) e['kill-feed'].innerHTML = feed;
    e['death-card'].hidden = p.alive;
    if (!p.alive) e['death-card'].innerHTML = `<span>${g.settings.mode === 'tdm' ? `BACK IN ${Math.max(1, Math.ceil(p.respawn))}` : 'YOU ARE ELIMINATED'}</span><strong>${g.spectating ? `WATCHING ${g.spectating.toUpperCase()}` : 'WAITING FOR NEXT ROUND'}</strong><small>${g.settings.mode === 'tdm' ? 'Regroup. Find another angle.' : 'Your squad is still in the fight.'}</small>`;
    const slots = p.weapons.map((id, i) => `<div class="${id === p.weapon ? 'active' : ''} ${isGrenade(id) && !p.ammo[id].clip ? 'empty' : ''}"><kbd>${i + 1}</kbd><span>${WEAPONS[id].short}${isGrenade(id) ? ` ×${p.ammo[id].clip}` : ''}</span></div>`).join('');
    if (e['weapon-slots'].innerHTML !== slots) e['weapon-slots'].innerHTML = slots;
    e['scoreboard'].hidden = !g.scoreboard;
    if (g.scoreboard) this.drawScoreboard();
    this.drawMinimap();
  }

  private drawScoreboard() {
    const content = this.scoreboardHTML();
    if (content !== this.lastBoard) { this.hudElements['scoreboard'].innerHTML = content; this.lastBoard = content; }
  }

  private scoreboardHTML(intermission = false) {
    const g = this.game;
    const teams = (['blue', 'red'] as const).map(team => `<section class="board-team"><div class="scoreboard-team ${team}-text"><span>${team.toUpperCase()} TEAM</span><span>${g.scores[team]}</span></div><div class="scoreboard-row board-labels"><span>OPERATOR</span><span>K</span><span>D</span><span>STATUS</span></div>${g.actors.filter(a => a.team === team).sort((a, b) => b.kills - a.kills).map(a => `<div class="scoreboard-row ${a === g.player ? 'is-you' : ''}"><span class="operator-name" ${a.profile ? `title="${profileLabel(a.profile)}" aria-label="${a.name}: ${profileLabel(a.profile)}"` : ''}>${a.name}${a === g.player ? ' <small>/ YOU</small>' : a.human ? ' <small>/ PLAYER</small>' : a.profile ? ` <small class="profile-badge">${a.profile.name}</small>` : ''}</span><span>${a.kills}</span><span>${a.deaths}</span><span class="${a.alive ? 'alive' : 'dead'}">${a.alive ? 'ACTIVE' : 'DOWN'}</span></div>`).join('')}</section>`).join('');
    return `<div class="scoreboard-heading"><span>${g.arena.name} / ${g.settings.mode === 'tdm' ? 'TEAM DEATHMATCH' : 'ELIMINATION'}</span><span>LOCAL MATCH</span></div><h2>SQUAD STATUS</h2><div class="board-teams">${teams}</div>${intermission ? '' : '<p>HOLD TAB TO VIEW · RELEASE TO CLOSE</p>'}`;
  }

  private drawDamageNumbers() {
    const g = this.game, live = new Set(g.damagePopups.map(p => p.id));
    for (const [id, element] of this.popupElements) {
      if (!live.has(id)) { element.remove(); this.popupElements.delete(id); }
    }
    for (const popup of g.damagePopups) {
      let element = this.popupElements.get(popup.id);
      if (!element) {
        element = document.createElement('span');
        element.className = `damage-number${popup.head ? ' is-headshot' : ''}${popup.killed ? ' is-lethal' : ''}`;
        element.textContent = `${popup.head ? '⊕ ' : ''}${popup.amount}`;
        element.dataset.damage = String(popup.amount);
        this.hudElements['damage-numbers'].append(element); this.popupElements.set(popup.id, element);
      }
      const age = g.time - popup.time;
      this.popupPoint.copy(popup.point); this.popupPoint.y += age * .55; this.popupPoint.project(g.view.camera);
      const inView = this.popupPoint.z > -1 && this.popupPoint.z < 1 && Math.abs(this.popupPoint.x) < 1.1 && Math.abs(this.popupPoint.y) < 1.1;
      element.hidden = !inView;
      element.style.opacity = String(clamp((.95 - age) / .4, 0, 1));
      element.style.transform = `translate(${(this.popupPoint.x * .5 + .5) * innerWidth + (popup.id % 3 - 1) * 10}px,${(-this.popupPoint.y * .5 + .5) * innerHeight}px) translate(-50%,-50%)`;
    }
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
      if (actor.team !== g.player.team || !actor.alive) continue;
      ctx.fillStyle = actor === g.player ? '#f1c27f' : '#8cc3d2';
      ctx.beginPath(); ctx.arc(px(actor.position.x), pz(actor.position.z), actor === g.player ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      if (actor === g.player) {
        ctx.strokeStyle = '#f1c27f'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(px(actor.position.x), pz(actor.position.z)); ctx.lineTo(px(actor.position.x - Math.sin(actor.yaw) * 3), pz(actor.position.z - Math.cos(actor.yaw) * 3)); ctx.stroke();
      }
    }
    ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.fillStyle = '#e6b577';
    for (const site of g.arena.sites ?? []) ctx.fillText(site.label, px(site.x), pz(site.z) + 4);
  }
}
