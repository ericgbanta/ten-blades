import { render } from 'preact';
import { App } from './ui/App';
import './ui/styles.css';
import { registerServiceWorker } from './pwa/register';

render(<App />, document.getElementById('app')!);
registerServiceWorker();
