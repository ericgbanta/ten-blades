// The shared styles go first, so every screen's own CSS comes after the tokens and the kit.
import './styles.css';
import { useEffect, useState } from 'preact/hooks';
import { Title } from './Title';
import { Battle } from './Battle';
import { Story } from './Story';
import { NewGame } from './menus/NewGame';
import { LoadGame } from './menus/LoadGame';
import { Settings } from './menus/Settings';
import { ChapterComplete } from './menus/ChapterComplete';
import { DevMc } from './DevMc';
import { Camp } from './camp/Camp';
import { installCampTestHook } from './camp/testHook';
import { installKit } from './kit';

installKit();
// Test only (`?test=1`): window.__camp, for reaching every camp screen.
installCampTestHook();

function currentRoute(): string {
  // A query after the route (`#/battle?seed=3`) carries test overrides, not a route.
  return window.location.hash.replace(/^#/, '').split('?')[0] || '/';
}

export function App() {
  const [route, setRoute] = useState(currentRoute());
  useEffect(() => {
    const onChange = () => setRoute(currentRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  if (route === '/camp' || route.startsWith('/camp/')) return <Camp path={route} />;
  switch (route) {
    case '/battle':
      return <Battle />;
    case '/story':
      return <Story />;
    case '/new':
      return <NewGame />;
    case '/load':
      return <LoadGame />;
    case '/settings':
      return <Settings />;
    case '/complete':
      return <ChapterComplete />;
    case '/dev/mc':
      return <DevMc />;
    default:
      return <Title />;
  }
}
