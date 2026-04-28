import { state, set, h } from './lib/state.js';
import { startRouter, parseHash } from './lib/router.js';
import { getJson } from './lib/api.js';
import { TopBar } from './components/TopBar.js';
import { showToast } from './components/Toast.js';
import { ProjectPicker } from './components/ProjectPicker.js';
import { projectHome } from './views/projectHome.js';
import { issueDetail } from './views/issueDetail.js';
import { notFound, placeholder } from './views/notFound.js';

const handlers = {
  home: () => ProjectPicker({ projects: state.projects }),
  projectHome,
  issueDetail,
  admin: placeholder('Admin', 'The admin surfaces land in Stage 8.'),
  me: placeholder('Profile', 'The profile screen lands in Stage 8.'),
  notFound,
};

async function boot() {
  const topbarEl = document.getElementById('topbar');
  const appRoot = document.getElementById('app-root');

  let me;
  try {
    me = await getJson('/auth/me');
  } catch {
    return;
  }

  let projectsRes;
  try {
    projectsRes = await getJson('/api/projects');
  } catch {
    appRoot.replaceChildren(
      h(
        'section',
        { class: 'view' },
        h('h1', {}, 'Something went wrong'),
        h('p', { class: 'muted' }, 'Could not load your projects. Refresh to try again.'),
      ),
    );
    showToast('Failed to load projects', 'error');
    return;
  }

  set({ currentUser: me.user, projects: projectsRes.projects ?? [] });

  topbarEl.replaceChildren(TopBar({ user: state.currentUser }));

  if (!state.bootDone) {
    const initial = parseHash(location.hash);
    if (initial.name === 'home' && state.projects.length === 1) {
      history.replaceState(null, '', `#/projects/${state.projects[0].id}`);
    }
    set({ bootDone: true });
  }

  startRouter(handlers, appRoot);
}

boot();
