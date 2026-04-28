import { h } from '../lib/state.js';

export function Tabs({ tabs, current, onChange }) {
  const buttons = tabs.map((tab) => {
    const btn = h(
      'button',
      {
        type: 'button',
        class: `tab${tab.key === current ? ' is-active' : ''}`,
        'aria-selected': tab.key === current ? 'true' : 'false',
        role: 'tab',
        onClick: () => {
          if (tab.key !== current) onChange(tab.key);
        },
      },
      tab.label,
    );
    return btn;
  });
  return h('div', { class: 'tabs', role: 'tablist' }, buttons);
}
