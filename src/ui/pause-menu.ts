import { getWheelMode, setWheelMode, WheelMode } from '../input/index.js';

let pauseOverlay: HTMLDivElement | null = null;
let helpPanel: HTMLDivElement | null = null;

const HELP_CONTENT = {
  controls: `
    <h3>Mouse Controls</h3>
    <table>
      <tr><td>Left-click</td><td>Select unit/building</td></tr>
      <tr><td>Left-drag</td><td>Box select units</td></tr>
      <tr><td>Shift + click / drag</td><td>Add to / remove from selection</td></tr>
      <tr><td>Right-click</td><td>Move / Attack / Harvest / Deploy (cursor shows which)</td></tr>
      <tr><td>Right-click</td><td>With a Barracks/Factory selected: set rally point</td></tr>
      <tr><td>Double-click</td><td>Barracks/Factory: make primary · MCV: deploy</td></tr>
      <tr><td>Mouse wheel</td><td>Zoom in/out (trackpad: two-finger pan, pinch to zoom). Change in the pause menu if your wheel pans instead</td></tr>
      <tr><td>Middle-drag / screen edge</td><td>Pan camera</td></tr>
      <tr><td>Minimap click</td><td>Jump camera</td></tr>
      <tr><td>Build button</td><td>Left-click: build · Shift: x10 · Right-click: cancel</td></tr>
    </table>
    <h3 style="margin-top:18px">Touch</h3>
    <table>
      <tr><td>Tap</td><td>Select your unit · with units selected: move / attack there</td></tr>
      <tr><td>Hold, then drag</td><td>Box select</td></tr>
      <tr><td>Hold on empty ground</td><td>Deselect</td></tr>
      <tr><td>Drag / pinch</td><td>Pan / zoom</td></tr>
    </table>
  `,
  shortcuts: `
    <h3>Keyboard Shortcuts</h3>
    <table>
      <tr><td>Arrow keys</td><td>Pan camera</td></tr>
      <tr><td>+ / -</td><td>Zoom in / out</td></tr>
      <tr><td>Ctrl + 0-9</td><td>Assign control group</td></tr>
      <tr><td>Shift + 0-9</td><td>Add selection to control group</td></tr>
      <tr><td>0-9</td><td>Select control group (press twice: jump to it)</td></tr>
      <tr><td>A, then click</td><td>Attack-move to the clicked spot</td></tr>
      <tr><td>F / G / H</td><td>Stance: Attack / Guard / Stand Ground</td></tr>
      <tr><td>U</td><td>Unload transport</td></tr>
      <tr><td>Enter</td><td>Deploy MCV</td></tr>
      <tr><td>B</td><td>Bird's eye view</td></tr>
      <tr><td>V</td><td>Switch 3D / classic 2D view</td></tr>
      <tr><td>[ / ]</td><td>Game speed slower / faster (or click the speed badge)</td></tr>
      <tr><td>Escape</td><td>Cancel mode / deselect / open this menu</td></tr>
      <tr><td>Space / P</td><td>Pause</td></tr>
    </table>
  `,
  tips: `
    <h3>Quick Tips</h3>
    <ul>
      <li>Build Power Plants to keep production running</li>
      <li>Harvesters are high-value targets-protect them!</li>
      <li>Production pauses when you run out of credits - build a Refinery and more Harvesters</li>
      <li>Double-click a Barracks/Factory to set it as primary</li>
      <li>Select a Barracks/Factory and right-click the ground to set its rally point</li>
      <li>Engineers can capture enemy buildings</li>
      <li>SAM Sites intercept incoming missiles and artillery</li>
      <li>Deploy Induction Rigs on ore wells for infinite income</li>
    </ul>
  `
};

type HelpTab = keyof typeof HELP_CONTENT;

let onHelpBack: (() => void) | null = null;
let quitArmed = false;

/** Create the pause overlay and help panel once (the help panel is also opened from the main menu). */
function ensureElements(): void {
  if (pauseOverlay && helpPanel) return;

  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <div class="pause-modal" role="dialog" aria-labelledby="pause-title">
      <h2 id="pause-title">GAME PAUSED</h2>
      <div class="pause-buttons">
        <button id="pause-resume">Resume</button>
        <button id="pause-help">Controls &amp; Help</button>
        <button id="pause-quit">Quit to Menu</button>
      </div>
      <label class="pause-setting">Mouse wheel
        <select id="pause-wheel-mode">
          <option value="auto">Auto (wheel zooms, trackpad pans)</option>
          <option value="zoom">Zoom</option>
          <option value="pan">Pan</option>
        </select>
      </label>
      <div class="pause-hint">Esc / Space to resume</div>
    </div>
  `;
  pauseOverlay.style.display = 'none';
  document.body.appendChild(pauseOverlay);

  helpPanel = document.createElement('div');
  helpPanel.id = 'help-panel';
  helpPanel.innerHTML = `
    <div class="help-modal" role="dialog" aria-label="Controls and help">
      <div class="help-tabs">
        <button class="help-tab active" data-tab="controls">Mouse</button>
        <button class="help-tab" data-tab="shortcuts">Keyboard</button>
        <button class="help-tab" data-tab="tips">Tips</button>
      </div>
      <div class="help-content">${HELP_CONTENT.controls}</div>
      <button class="help-back">Back</button>
    </div>
  `;
  helpPanel.style.display = 'none';
  document.body.appendChild(helpPanel);

  const wheelSelect = pauseOverlay.querySelector('#pause-wheel-mode') as HTMLSelectElement | null;
  wheelSelect?.addEventListener('change', () => {
    setWheelMode(wheelSelect.value as WheelMode);
    // Hand the keyboard back so Esc / Space resume as the menu says
    wheelSelect.blur();
    const menuSelect = document.getElementById('wheel-mode') as HTMLSelectElement | null;
    if (menuSelect) menuSelect.value = wheelSelect.value;
  });

  helpPanel.querySelector('.help-back')?.addEventListener('click', () => {
    onHelpBack?.();
  });

  helpPanel.querySelectorAll('.help-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.currentTarget as HTMLElement;
      const tabName = target.dataset.tab as HelpTab;

      helpPanel?.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
      target.classList.add('active');

      const content = helpPanel?.querySelector('.help-content');
      if (content) content.innerHTML = HELP_CONTENT[tabName];
    });
  });
}

function setQuitArmed(armed: boolean): void {
  quitArmed = armed;
  const quitBtn = document.getElementById('pause-quit');
  if (!quitBtn) return;
  quitBtn.textContent = armed ? 'Click again to quit' : 'Quit to Menu';
  quitBtn.classList.toggle('armed', armed);
}

export function initPauseMenu(
  onResume: () => void,
  onQuit: () => void
): void {
  ensureElements();

  // Replace the buttons' listeners (initPauseMenu runs again on every game start / hot reload)
  for (const id of ['pause-resume', 'pause-help', 'pause-quit']) {
    const old = document.getElementById(id);
    old?.replaceWith(old.cloneNode(true));
  }

  document.getElementById('pause-resume')?.addEventListener('click', onResume);
  document.getElementById('pause-quit')?.addEventListener('click', () => {
    // Quitting throws the match away: ask for a second click
    if (!quitArmed) {
      setQuitArmed(true);
      return;
    }
    setQuitArmed(false);
    onQuit();
  });
  document.getElementById('pause-help')?.addEventListener('click', () => {
    showHelp(() => showPauseMenu());
  });
}

/** Show the controls/help panel; Back (or Escape, via the caller) runs `onBack`. */
export function showHelp(onBack: () => void): void {
  ensureElements();
  onHelpBack = () => {
    if (helpPanel) helpPanel.style.display = 'none';
    onBack();
  };
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) helpPanel.style.display = 'flex';
}

export function closeHelp(): void {
  onHelpBack?.();
}

export function showPauseMenu(): void {
  setQuitArmed(false);
  const wheelSelect = document.getElementById('pause-wheel-mode') as HTMLSelectElement | null;
  if (wheelSelect) wheelSelect.value = getWheelMode();
  if (pauseOverlay) pauseOverlay.style.display = 'flex';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function hidePauseMenu(): void {
  setQuitArmed(false);
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function isHelpVisible(): boolean {
  return helpPanel?.style.display === 'flex';
}

export function isPauseMenuVisible(): boolean {
  return pauseOverlay?.style.display === 'flex' || helpPanel?.style.display === 'flex';
}
