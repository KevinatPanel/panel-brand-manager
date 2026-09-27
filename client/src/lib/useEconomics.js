import { useEffect, useState } from 'react';
import { playbook } from './playbookApi.js';
import { withDefaults } from './economics.js';

// Settings → Economics (app_settings key 'economics'), with defaults filled
// in. Fetched once per page load and shared; saveEconomics updates everyone.
let cache = null;
let inflight = null;
const listeners = new Set();

async function load() {
  if (cache) return cache;
  inflight ??= playbook
    .getSetting('economics')
    .then((v) => (cache = withDefaults(v)))
    .catch(() => (cache = withDefaults(null)));
  return inflight;
}

export function useEconomics() {
  const [settings, setSettings] = useState(cache ?? withDefaults(null));
  useEffect(() => {
    let live = true;
    load().then((s) => live && setSettings(s));
    listeners.add(setSettings);
    return () => {
      live = false;
      listeners.delete(setSettings);
    };
  }, []);
  return settings;
}

export async function saveEconomics(next) {
  const merged = withDefaults(next);
  await playbook.setSetting('economics', merged);
  cache = merged;
  listeners.forEach((fn) => fn(merged));
}
