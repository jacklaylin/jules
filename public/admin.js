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
$('people-search').oninput = render;
$('refresh').onclick = load;
load();
