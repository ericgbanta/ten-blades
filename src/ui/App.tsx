import { useEffect, useState } from 'preact/hooks';
import { Title } from './Title';
import { Battle } from './Battle';

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
  return route === '/battle' ? <Battle /> : <Title />;
}
