import { getWheelMode, setWheelMode, type WheelMode } from '../input/index.js';

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
      <tr><td>Double-click</td><td>Unit: select all of that type on screen · Barracks/Factory: make primary · MCV: deploy</td></tr>
      <tr><td>Mouse wheel</td><td>Zoom in/out (trackpad: two-finger pan, pinch to zoom). Change in the pause menu if your wheel pans instead</td></tr>
      <tr><td>Middle-drag / screen edge</td><td>Pan camera</td></tr>
      <tr><td>Minimap click</td><td>Jump camera · right-click: move selected units there · A, then click: attack-move there</td></tr>
      <tr><td>Sell</td><td>Click a building, then click it again to confirm (hold Shift to keep selling)</td></tr>
      <tr><td>Build button</td><td>Left-click: build · Shift: x10 · Right-click: cancel</td></tr>
    </table>
    <h3 style="margin-top:18px">Touch</h3>
    <table>
      <tr><td>Tap</td><td>Select your unit · with units selected: move / attack there (tap your transport to load infantry)</td></tr>
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
      <tr><td>Ctrl + 0-9</td><td>Assign control group (Ctrl + Shift + 0-9 if your browser switches tabs instead)</td></tr>
      <tr><td>Shift + 0-9</td><td>Add selection to control group</td></tr>
      <tr><td>0-9</td><td>Select control group (press twice: jump to it)</td></tr>
      <tr><td>A, then click</td><td>Attack-move to the clicked spot</td></tr>
      <tr><td>S</td><td>Stop</td></tr>
      <tr><td>Q</td><td>Select all combat units</td></tr>
      <tr><td>C</td><td>Centre camera on the selection</td></tr>
      <tr><td>F / G / H</td><td>Stance: Attack / Guard / Stand Ground</td></tr>
      <tr><td>U</td><td>Unload transport</td></tr>
      <tr><td>Enter</td><td>Deploy MCV</td></tr>
      <tr><td>B</td><td>Bird's eye view</td></tr>
      <tr><td>M</td><td>Show / hide the minimap (when watching an AI battle)</td></tr>
      <tr><td>V</td><td>Switch 3D / classic 2D view</td></tr>
      <tr><td>[ / ]</td><td>Game speed slower / faster (or click / right-click the speed badge)</td></tr>
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
/** What had keyboard focus before a dialog opened, to hand it back on close. */
let focusBeforeDialog: HTMLElement | null = null;

function isInsideDialogs(el: Element | null): boolean {
  return !!el && (!!pauseOverlay?.contains(el) || !!helpPanel?.contains(el));
}

function rememberFocus(): void {
  const active = document.activeElement as HTMLElement | null;
  if (active && active !== document.body && !isInsideDialogs(active)) focusBeforeDialog = active;
}

function restoreFocus(): void {
  const target = focusBeforeDialog;
  focusBeforeDialog = null;
  // Only hand focus back if nothing else claimed it meanwhile and the element still exists
  if (target && target.isConnected && (isInsideDialogs(document.activeElement) || document.activeElement === document.body)) {
    target.focus({ preventScroll: true });
  } else if (isInsideDialogs(document.activeElement)) {
    (document.activeElement as HTMLElement).blur();
  }
}

/** Create the pause overlay and help panel once (the help panel is also opened from the main menu). */
function ensureElements(): void {
  if (pauseOverlay && helpPanel) return;

  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <div class="pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title">
      <h2 id="pause-title">Game Paused</h2>
      <div class="pause-buttons">
        <button id="pause-resume" class="start-btn">Resume</button>
        <button id="pause-help" class="menu-btn">Controls &amp; Help</button>
        <button id="pause-quit" class="menu-btn">Quit to Menu</button>
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
    <div class="help-modal" role="dialog" aria-modal="true" aria-label="Controls and help">
      <div class="help-tabs" role="tablist">
        <button class="help-tab active" data-tab="controls" role="tab" aria-selected="true" aria-controls="help-content">Mouse</button>
        <button class="help-tab" data-tab="shortcuts" role="tab" aria-selected="false" aria-controls="help-content">Keyboard</button>
        <button class="help-tab" data-tab="tips" role="tab" aria-selected="false" aria-controls="help-content">Tips</button>
      </div>
      <div class="help-content" id="help-content" role="tabpanel" tabindex="0">${HELP_CONTENT.controls}</div>
      <button class="help-back menu-btn">Back</button>
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

      helpPanel?.querySelectorAll('.help-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      target.classList.add('active');
      target.setAttribute('aria-selected', 'true');

      const content = helpPanel?.querySelector('.help-content');
      if (content) {
        content.innerHTML = HELP_CONTENT[tabName];
        // A new tab starts at its top, not wherever the previous one was scrolled to
        content.scrollTop = 0;
      }
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
  rememberFocus();
  onHelpBack = () => {
    if (helpPanel) helpPanel.style.display = 'none';
    onBack();
    // Back to the main menu (nothing else opened): return focus to what opened help
    if (!isPauseMenuVisible()) restoreFocus();
  };
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) {
    helpPanel.style.display = 'flex';
    (helpPanel.querySelector('.help-tab.active') as HTMLElement | null)?.focus({ preventScroll: true });
  }
}

export function closeHelp(): void {
  onHelpBack?.();
}

export function showPauseMenu(): void {
  setQuitArmed(false);
  const wheelSelect = document.getElementById('pause-wheel-mode') as HTMLSelectElement | null;
  if (wheelSelect) wheelSelect.value = getWheelMode();
  rememberFocus();
  if (pauseOverlay) pauseOverlay.style.display = 'flex';
  if (helpPanel) helpPanel.style.display = 'none';
  // Move keyboard / screen-reader focus into the dialog. Space still resumes via the global
  // handler (it prevents the button's own activation), Enter activates the focused button.
  document.getElementById('pause-resume')?.focus({ preventScroll: true });
}

export function hidePauseMenu(): void {
  setQuitArmed(false);
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) helpPanel.style.display = 'none';
  restoreFocus();
}

export function isHelpVisible(): boolean {
  return helpPanel?.style.display === 'flex';
}

export function isPauseMenuVisible(): boolean {
  return pauseOverlay?.style.display === 'flex' || helpPanel?.style.display === 'flex';
}
