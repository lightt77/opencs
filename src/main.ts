import './style.css';
import { Game } from './game';
import { initPhysics } from './physics';
import { UI } from './ui';

async function main() {
  const app = document.querySelector<HTMLElement>('#app')!;
  app.innerHTML = '<div class="loading"><div class="loading-mark">+</div><strong>OPENCS</strong><span>PREPARING THE FIELD</span></div>';
  try {
    await initPhysics();
    const game = new Game(document.querySelector<HTMLCanvasElement>('#game')!);
    new UI(game);
    // Development-only diagnostics for automated browser integration tests.
    if (import.meta.env.DEV) Object.defineProperty(window, '__OPENCS__', { value: game, configurable: true });
  } catch (error) {
    console.error(error);
    app.innerHTML = '<div class="loading"><strong>COULD NOT PREPARE THE FIELD</strong><p>OpenCS needs a desktop browser with WebGL2 and hardware acceleration enabled.</p><p>Check the browser console for details, then reload to try again.</p></div>';
  }
}

void main();
