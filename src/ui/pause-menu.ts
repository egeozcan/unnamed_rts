let pauseOverlay: HTMLDivElement | null = null;
let helpPanel: HTMLDivElement | null = null;

const HELP_CONTENT = {
  controls: `
    <h3>Mouse Controls</h3>
    <table>
      <tr><td>Left-click</td><td>Select unit/building</td></tr>
      <tr><td>Left-drag</td><td>Box select units</td></tr>
      <tr><td>Right-click</td><td>Move / Attack / Harvest</td></tr>
      <tr><td>Middle-drag</td><td>Pan camera</td></tr>
      <tr><td>Scroll wheel</td><td>Zoom in/out</td></tr>
    </table>
  `,
  shortcuts: `
    <h3>Keyboard Shortcuts</h3>
    <table>
      <tr><td>Arrow keys</td><td>Pan camera</td></tr>
      <tr><td>1-5</td><td>Game speed</td></tr>
      <tr><td>A</td><td>Attack-move mode</td></tr>
      <tr><td>F / G / H</td><td>Stance: Aggressive / Defensive / Hold</td></tr>
      <tr><td>B</td><td>Bird's eye view</td></tr>
      <tr><td>Enter</td><td>Deploy MCV</td></tr>
      <tr><td>Escape</td><td>Cancel / Deselect</td></tr>
      <tr><td>Space / P</td><td>Pause game</td></tr>
    </table>
  `,
  tips: `
    <h3>Quick Tips</h3>
    <ul>
      <li>Build Power Plants to keep production running</li>
      <li>Harvesters are high-value targets-protect them!</li>
      <li>Double-click a Barracks/Factory to set it as primary</li>
      <li>Right-click a production building to set rally point</li>
      <li>Engineers can capture enemy buildings</li>
      <li>SAM Sites intercept incoming missiles and artillery</li>
      <li>Deploy Induction Rigs on ore wells for infinite income</li>
    </ul>
  `
};

export function initPauseMenu(
  onResume: () => void,
  onQuit: () => void
): void {
  // Create overlay
  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <div class="pause-modal">
      <h2>GAME PAUSED</h2>
      <div class="pause-buttons">
        <button id="pause-resume">Resume</button>
        <button id="pause-help">Help</button>
        <button id="pause-quit">Quit</button>
      </div>
    </div>
  `;
  pauseOverlay.style.display = 'none';
  document.body.appendChild(pauseOverlay);

  // Create help panel
  helpPanel = document.createElement('div');
  helpPanel.id = 'help-panel';
  helpPanel.innerHTML = `
    <div class="help-modal">
      <div class="help-tabs">
        <button class="help-tab active" data-tab="controls">Controls</button>
        <button class="help-tab" data-tab="shortcuts">Shortcuts</button>
        <button class="help-tab" data-tab="tips">Tips</button>
      </div>
      <div class="help-content">${HELP_CONTENT.controls}</div>
      <button class="help-back">Back</button>
    </div>
  `;
  helpPanel.style.display = 'none';
  document.body.appendChild(helpPanel);

  // Event listeners
  document.getElementById('pause-resume')?.addEventListener('click', onResume);
  document.getElementById('pause-quit')?.addEventListener('click', onQuit);
  document.getElementById('pause-help')?.addEventListener('click', () => {
    if (pauseOverlay) pauseOverlay.style.display = 'none';
    if (helpPanel) helpPanel.style.display = 'flex';
  });

  helpPanel.querySelector('.help-back')?.addEventListener('click', () => {
    if (helpPanel) helpPanel.style.display = 'none';
    if (pauseOverlay) pauseOverlay.style.display = 'flex';
  });

  helpPanel.querySelectorAll('.help-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tabName = target.dataset.tab as 'controls' | 'shortcuts' | 'tips';

      // Update active tab
      helpPanel?.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
      target.classList.add('active');

      // Update content
      const content = helpPanel?.querySelector('.help-content');
      if (content) content.innerHTML = HELP_CONTENT[tabName];
    });
  });
}

export function showPauseMenu(): void {
  if (pauseOverlay) pauseOverlay.style.display = 'flex';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function hidePauseMenu(): void {
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function isPauseMenuVisible(): boolean {
  return pauseOverlay?.style.display === 'flex' || helpPanel?.style.display === 'flex';
}
