import {mountAdminShell,adminJson,adminToken} from './admin-console.js';
import {mountPurchases,loadPurchases} from './admin-purchases.js';
mountAdminShell('people');
const $ = id => document.getElementById(id);
let current = null, requestVersion = 0, cursor = null, historyMessages = [], profileBusy = false, profileVersion = 0;
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
const api = (path, options) => adminJson(path, options);
mountPurchases(api);
const date = at => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
let imageURLs = [];
function renderMessages() {
  imageURLs.forEach(url => URL.revokeObjectURL(url)); imageURLs = [];
  $('messages').replaceChildren();
  for (const message of historyMessages) {
    const item = document.createElement('article'); item.id = `message-${message.id}`; item.className = `message ${message.direction} ${message.status}`;
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = message.body;
    for (const image of message.message_images ?? []) {
      const preview = document.createElement('img'); preview.alt = 'Private inspiration image'; preview.className = 'inspiration';
      bubble.append(preview);
      adminToken().then(token => fetch(`/api/image?id=${encodeURIComponent(image.id)}`, {headers:{Authorization:`Bearer ${token}`},cache:'no-store'}))
        .then(async response => { if (!response.ok) throw new Error(); return response.blob(); })
        .then(blob => { if (!preview.isConnected) return; const url=URL.createObjectURL(blob); imageURLs.push(url); preview.src=url; })
        .catch(() => { if (preview.isConnected) { const error=document.createElement('p'); error.textContent='Image unavailable — refresh or sign in again.'; preview.replaceWith(error); } });
    }
    for (const product of message.search_result?.products ?? []) {
      try {
        const url=new URL(product.url); if(url.protocol!=='https:')continue;
        const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.className='product-link';
        link.textContent=`${product.brand} ${product.name} · ${product.match==='likely_match'?'Likely match; unconfirmed':'Similar alternative'}`;bubble.append(link);
      } catch {}
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    const status = message.status === 'sent' ? 'Accepted by Photon' : message.status === 'generating' ? 'AI preparing reply · refresh to check' : message.status === 'sending' ? 'Send started · refresh to check' : message.status === 'uncertain' ? 'Delivery uncertain · check the phone before resending' : 'Received';
    meta.textContent = `${message.search_result && message.search_result.status !== 'found' ? 'Sourcing review needed · ' : ''}${message.search_result?.checked_at ? `Search checked ${date(message.search_result.checked_at)} · ` : ''}${message.image_status === 'failed' ? 'Image failed · manual review needed · ' : ''}${message.memory_status === 'failed' ? 'Memory update failed · ' : ''}${message.developer_feedback !== null && message.developer_feedback !== undefined ? 'Developer feedback · ' : ''}${date(message.created_at)} · ${message.source === 'greeting' ? 'Automatic greeting · ' : message.source === 'ai' ? 'Jules AI · ' : message.source === 'ai_fallback' ? 'AI failed · manual review needed · ' : ''}${status}`;
    item.append(bubble, meta); $('messages').append(item);
  }
  $('older').hidden = !cursor;
}
async function loadConversation(id, earlier = false) {
  const version = ++requestVersion;
  const query = new URLSearchParams({ conversation: id });
  if (earlier && cursor) query.set('before', JSON.stringify(cursor));
  const data = await api(`/api/admin?${query}`);
  if (version !== requestVersion || current !== id) return;
  $('empty').hidden = true; $('conversation').hidden = false;
  $('person').textContent = data.conversation.sender_id;
  historyMessages = earlier ? [...data.messages, ...historyMessages] : data.messages;
  cursor = data.before; renderMessages();
  if (!earlier) { loadPurchases(id); await loadProfile(id); }
  if (!earlier) $('messages').scrollTop = $('messages').scrollHeight;
}
async function loadInbox() {
  const [data, reports] = await Promise.all([api('/api/admin'), api('/api/admin?view=feedback')]);
  $('feedback').replaceChildren();
  if (!reports.feedback.length) $('feedback').textContent = 'No feedback yet.';
  for (const report of reports.feedback) {
    const button = document.createElement('button'); button.className = 'person-button';
    const title = document.createElement('strong'); title.textContent = report.developer_feedback;
    const subtitle = document.createElement('span'); subtitle.textContent = `${report.conversations?.sender_id ?? 'Tester'} · ${date(report.created_at)}`;
    button.append(title, subtitle);
    button.onclick = () => [...$('people').children].find(item => item.dataset.conversation === report.conversation_id)?.click();
    $('feedback').append(button);
  }
  $('people').replaceChildren();
  if (!data.conversations.length) { const p = document.createElement('p'); p.className = 'no-people'; p.textContent = 'No conversations yet. Send an iMessage to your assigned line to begin.'; $('people').append(p); }
  for (const person of data.conversations) {
    const button = document.createElement('button'); button.className = `person-button${current === person.id ? ' selected' : ''}`;
    button.dataset.conversation = person.id;
    const title = document.createElement('strong'); title.textContent = person.sender_id;
    const subtitle = document.createElement('span'); subtitle.textContent = `Last activity · ${date(person.updated_at)}`;
    button.append(title, subtitle);
    button.onclick = async () => {
      if (profileBusy) return;
      current = person.id;
      document.querySelectorAll('.person-button').forEach(item => item.classList.remove('selected')); button.classList.add('selected');
      $('conversation').hidden = true; $('empty').hidden = false;
      try { await loadConversation(current); notice(''); } catch (error) { notice(error.message); }
    };
    $('people').append(button);
  }
  if (current) await loadConversation(current);
}
$('refresh').onclick = async () => { try { await loadInbox(); notice(''); } catch (error) { notice(error.message); } };
$('older').onclick = async () => { $('older').disabled = true; try { await loadConversation(current, true); } catch (error) { notice(error.message); } finally { $('older').disabled = false; } };
loadInbox().catch(error => notice(error.message));

function profileNotice(text) { $('profile-notice').textContent = text; }
async function loadProfile(id) {
  const data = await api(`/api/profile?conversation=${encodeURIComponent(id)}`).catch(error => { if (current === id) { $('profile-facts').replaceChildren(); $('profile-summary').textContent = ''; profileNotice(error.message); } return null; });
  if (!data || current !== id) return;
  profileVersion = data.version;
  $('profile-summary').textContent = data.summary || 'No saved preferences yet. Learn from existing messages or add one below.';
  $('profile-facts').replaceChildren(); profileNotice('');
  for (const fact of data.facts.filter(f => !f.deleted)) {
    const row = document.createElement('div'); row.className = 'fact-row';
    const title = document.createElement('label'); title.textContent = `${fact.field} · ${fact.key}`;
    const value = document.createElement('input'); value.value = fact.value; value.maxLength = 500; value.setAttribute('aria-label', title.textContent);
    const evidence = document.createElement('p'); evidence.className = 'muted'; evidence.textContent = `${fact.source === 'operator' ? 'Owner edit' : 'User statement'} · ${date(fact.updated_at)} · ${fact.evidence}`;
    const save = document.createElement('button'); save.textContent = 'Save'; save.type = 'button';
    const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.type = 'button';
    save.onclick = () => changeProfile({ action:'set',field:fact.field,key:fact.key,value:value.value });
    remove.onclick = () => changeProfile({ action:'remove',field:fact.field,key:fact.key,value:'' });
    row.append(title,value,evidence,save,remove);
    if (fact.source_id) {
      const source = document.createElement('button'); source.type='button'; source.textContent='Show source';
      source.onclick = async () => {
        const selected = current;
        try {
          while (current === selected && !historyMessages.some(m => m.id === fact.source_id) && cursor) await loadConversation(selected,true);
          if (current === selected) document.getElementById(`message-${fact.source_id}`)?.scrollIntoView({block:'center',behavior:'smooth'});
        } catch (error) { profileNotice(error.message); }
      };
      row.append(source);
    } $('profile-facts').append(row);
  }
}
async function changeProfile(change) {
  if (!current || profileBusy) return;
  profileBusy = true; const id = current;
  const buttons = [...$('profile-panel').querySelectorAll('button')]; buttons.forEach(b => { b.disabled=true; });
  document.querySelectorAll('.person-button').forEach(b => { b.disabled=true; });
  profileNotice(change.action === 'import' ? 'Reading existing messages…' : 'Saving…');
  try {
    const result = await api('/api/profile',{method:'POST',body:JSON.stringify({conversation:id,version:profileVersion,...change})});
    await loadProfile(id);
    profileNotice(result.limited ? 'Imported the latest 100 incoming messages. Earlier history was not included.' : 'Profile saved.');
    if (change.action === 'set') { $('fact-key').value=''; $('fact-value').value=''; }
  } catch (error) { profileNotice(error.message); }
  finally { profileBusy=false; buttons.forEach(b => { b.disabled=false; }); document.querySelectorAll('.person-button').forEach(b => { b.disabled=false; }); }
}
$('profile-reload').onclick = () => { if (current && !profileBusy) loadProfile(current); };
$('profile-import').onclick = () => changeProfile({action:'import'});
$('profile-add').onsubmit = event => { event.preventDefault(); changeProfile({action:'set',field:$('fact-field').value,key:$('fact-key').value,value:$('fact-value').value}); };

// Price alert rehearsal: the server runs the real decision on supplied offers and
// never changes the alert; sends go only to the designated test conversation.
let testAlertList = [];
const alertResult = text => { $('alert-test-result').textContent = text; };
function selectAlert() {
  const alert = testAlertList.find(a => a.id === $('alert-test-alert').value);
  $('alert-test-store').replaceChildren(...(alert?.links ?? []).map(url => { const o = document.createElement('option'); o.value = url; o.textContent = new URL(url).hostname.replace(/^www\./, ''); return o; }));
  $('alert-test-size').value = alert?.size ?? '';
  const ref = alert?.baselines?.[0];
  if (ref) { $('alert-test-currency').value = ref.currency; $('alert-test-price').value = ''; $('alert-test-price').placeholder = `Reference ${ref.amount}`; }
  alertResult(alert ? `Reference: ${alert.baselines.map(b => `${b.amount} ${b.currency}`).join(', ') || 'none yet'} · Last stock: ${alert.stock ?? 'unknown'}` : '');
}
$('alert-rehearsal').addEventListener('toggle', async () => {
  if (!$('alert-rehearsal').open || testAlertList.length) return;
  alertResult('Loading test alerts…');
  try {
    testAlertList = (await api('/api/price-checks', { method: 'POST', body: JSON.stringify({ action: 'list' }) })).alerts;
    $('alert-test-alert').replaceChildren(...testAlertList.map(a => { const o = document.createElement('option'); o.value = a.id; o.textContent = `${a.name} · ${a.size}${a.active ? '' : ' (off)'}`; return o; }));
    if (!testAlertList.length) alertResult('The test account has no price alerts yet. Ask Jules for one from the test phone.');
    else selectAlert();
  } catch (error) { alertResult(error.message); }
});
$('alert-test-alert').onchange = selectAlert;
async function rehearse(deliver) {
  if (!$('alert-test-form').reportValidity()) return;
  const buttons = [...$('alert-test-form').querySelectorAll('button')]; buttons.forEach(b => { b.disabled = true; });
  alertResult(deliver ? 'Sending test text…' : 'Running…');
  try {
    const shipping = $('alert-test-shipping').value;
    const result = await api('/api/price-checks', { method: 'POST', body: JSON.stringify({
      alert_id: $('alert-test-alert').value, deliver, previous_stock: $('alert-test-previous').value || undefined,
      offers: [{ url: $('alert-test-store').value, size: $('alert-test-size').value, amount: Number($('alert-test-price').value), currency: $('alert-test-currency').value.toUpperCase(), available: $('alert-test-available').checked, ...(shipping ? { shipping: Number(shipping) } : {}) }],
    }) });
    alertResult(`Outcome: ${result.status}${result.event ? ` (${result.event})` : ''}${result.delivery ? ` · Delivery: ${result.delivery}` : ''}\n\n${result.message ?? 'No text would be sent.'}`);
  } catch (error) { alertResult(error.message); }
  finally { buttons.forEach(b => { b.disabled = false; }); }
}
$('alert-test-form').onsubmit = event => { event.preventDefault(); rehearse(false); };
$('alert-test-send').onclick = () => rehearse(true);
