import {mountAdminShell,adminJson} from './admin-console.js';
// Admin › People: the list of testers. Each row opens the person page.
mountAdminShell('people');
const $ = id => document.getElementById(id);
const date = at => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let people = [];
function render() {
  const query = $('people-search').value.replace(/\s/g, '');
  const shown = people.filter(p => !query || p.sender_id.replace(/\s/g, '').includes(query));
  $('people').replaceChildren(...shown.map(person => {
    const row = document.createElement('tr'), link = document.createElement('a');
    link.href = `/admin/people/${person.id}`; link.textContent = person.sender_id;
    const when = document.createElement('td'); when.className = 'num'; when.textContent = date(person.updated_at);
    const open = document.createElement('td'); open.className = 'num'; const go = document.createElement('a'); go.href = link.href; go.textContent = 'Open →'; go.setAttribute('aria-label', `Open ${person.sender_id}`); open.append(go);
    const name = document.createElement('td'); name.append(link);
    row.append(name, when, open); row.onclick = event => { if (!event.target.closest('a')) location.href = link.href; };
    return row;
  }));
  $('notice').textContent = !people.length ? 'No testers yet.' : !shown.length ? 'No testers match this search.' : `${shown.length} of ${people.length} testers`;
}
async function load() {
  $('notice').textContent = 'Loading…';
  try { people = (await adminJson('/api/admin')).conversations; render(); }
  catch (error) { $('notice').textContent = error.message; }
}
// Chat quality summary (lib/chat-metrics.js). Counts only; the full breakdown is scripts/chat-metrics.js.
const METRICS = [
  ['first_message_s.median', 'First message', v => `${v}s`],
  ['final_result_s.median', 'Final result', v => `${v}s`],
  ['final_result_s.p90', 'Final result p90', v => `${v}s`],
  ['failure_rate', 'Failed replies', v => `${Math.round(v * 100)}%`],
  ['model_written_share', 'Model-written', v => `${Math.round(v * 100)}%`],
  ['first_try_rate', 'First-try find', v => `${Math.round(v * 100)}%`],
];
const BADGE = { better: 'ok', worse: 'fail', unchanged: 'plain' };
async function loadMetrics() {
  try {
    const trend = await adminJson('/api/admin?view=metrics');
    $('chat-metrics-stats').replaceChildren(...METRICS.map(([key, label, format]) => {
      const moved = trend.moved.find(m => m.metric === key), cell = document.createElement('div');
      const name = document.createElement('span'); name.className = 'mono-label'; name.textContent = label;
      const value = document.createElement('strong'); value.textContent = moved?.after === null || moved?.after === undefined ? '—' : format(moved.after);
      const badge = document.createElement('span'); badge.className = `badge ${BADGE[moved?.verdict] ?? ''}`;
      badge.textContent = moved?.before === null || moved?.before === undefined ? moved?.verdict ?? 'no data' : `${moved.verdict} · was ${format(moved.before)}`;
      cell.append(name, value, badge); return cell;
    }));
    const c = trend.current;
    const note = document.createElement('p'); note.className = 'muted';
    note.textContent = `${c.turns} turns (${c.timed_turns} timed), ${c.fallbacks} fallbacks, ${c.stuck} never delivered, ${c.named_accepted} named-product searches with a pick.`;
    $('chat-metrics-stats').after(note);
    $('chat-metrics').hidden = false;
  } catch { /* The people list does not depend on metrics. */ }
}
$('people-search').oninput = render;
$('refresh').onclick = load;
load();
loadMetrics();
