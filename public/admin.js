import {trackedFetch as fetch} from './activity.js';
import {createSession} from './wishlist-session.js';
const session=createSession({storage:localStorage,fetcher:fetch,lock:work=>navigator.locks?navigator.locks.request('jules-wishlist-refresh',work):work()});
const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('jules_token') ?? session.read()?.access_token;
let dedicatedLogin=Boolean(sessionStorage.getItem('jules_token'));
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('access_token')) {
  dedicatedLogin=true; token = fragment.get('access_token'); sessionStorage.setItem('jules_token', token);
}
const loginError = fragment.get('error_description');
if (location.hash) history.replaceState(null, '', '/admin');
let current = null, requestVersion = 0, cursor = null, historyMessages = [], sending = false, operation = null, profileBusy = false, profileVersion = 0;
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function showLogin() { token = null; dedicatedLogin=true; sessionStorage.removeItem('jules_token'); $('login').hidden = false; $('inbox').hidden = true; $('signout').hidden = true; }
async function api(path, options = {}) {
  if(!dedicatedLogin&&session.read())token=await session.token();
  let response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
  if(response.status===401&&!dedicatedLogin&&session.read()?.refresh_token){token=await session.token(true);response=await fetch(path,{...options,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},cache:'no-store'});}
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 || response.status === 403) showLogin(); throw new Error(data.error ?? 'Request failed.'); }
  return data;
}
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
      fetch(`/api/image?id=${encodeURIComponent(image.id)}`, {headers:{Authorization:`Bearer ${token}`},cache:'no-store'})
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
  if (!earlier) await loadProfile(id);
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
  $('login').hidden = true; $('inbox').hidden = false; $('signout').hidden = false;
  $('people').replaceChildren();
  if (!data.conversations.length) { const p = document.createElement('p'); p.className = 'no-people'; p.textContent = 'No conversations yet. Send an iMessage to your assigned line to begin.'; $('people').append(p); }
  for (const person of data.conversations) {
    const button = document.createElement('button'); button.className = `person-button${current === person.id ? ' selected' : ''}`;
    button.dataset.conversation = person.id;
    const title = document.createElement('strong'); title.textContent = person.sender_id;
    const subtitle = document.createElement('span'); subtitle.textContent = `Last activity · ${date(person.updated_at)}`;
    button.append(title, subtitle); button.disabled = sending;
    button.onclick = async () => {
      if (sending || profileBusy) return;
      if (current !== person.id && $('reply').value && !confirm('Discard your unsent draft?')) return;
      if (current !== person.id) { $('reply').value = ''; operation = null; }
      current = person.id;
      document.querySelectorAll('.person-button').forEach(item => item.classList.remove('selected')); button.classList.add('selected');
      $('conversation').hidden = true; $('empty').hidden = false;
      try { await loadConversation(current); notice(''); } catch (error) { notice(error.message); }
    };
    $('people').append(button);
  }
  if (current) await loadConversation(current);
}
$('login-form').onsubmit = async event => {
  event.preventDefault(); $('login-button').disabled = true;
  try { await api('/api/session', { method: 'POST', body: JSON.stringify({ email: $('email').value }) }); notice('Check your email and open the sign-in link. It expires after one hour.'); }
  catch (error) { notice(error.message); }
  finally { $('login-button').disabled = false; }
};
$('signout').onclick = () => { session.clear(); current = null; $('reply').value = ''; operation = null; showLogin(); notice('Signed out on this browser.'); };
$('refresh').onclick = async () => { try { await loadInbox(); notice(''); } catch (error) { notice(error.message); } };
$('older').onclick = async () => { $('older').disabled = true; try { await loadConversation(current, true); } catch (error) { notice(error.message); } finally { $('older').disabled = false; } };
$('reply').oninput = () => { operation = null; };
$('reply-form').onsubmit = async event => {
  event.preventDefault(); if (sending || !current || !$('reply').value.trim()) return;
  sending = true; $('send').disabled = true; $('reply').disabled = true; $('refresh').disabled = true;
  document.querySelectorAll('.person-button').forEach(item => { item.disabled = true; });
  operation ??= crypto.randomUUID();
  try {
    const result = await api('/api/admin', { method: 'POST', body: JSON.stringify({ conversation: current, operation, body: $('reply').value }) });
    if (result.status === 'sent') { $('reply').value = ''; operation = null; notice('Reply accepted by Photon.'); }
    else { notice('Delivery is uncertain. Check the phone before composing a new reply. Repeating this request will not send twice.'); }
    await loadConversation(current);
  } catch (error) { notice(error.message + ' Your draft is saved here; refresh the history before retrying.'); }
  finally { sending = false; $('send').disabled = false; $('reply').disabled = false; $('refresh').disabled = false; document.querySelectorAll('.person-button').forEach(item => { item.disabled = false; }); }
};
if (loginError) notice('The sign-in link expired or was already used. Request a new link.');
if (token) loadInbox().catch(error => notice(error.message));

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
  finally { profileBusy=false; buttons.forEach(b => { b.disabled=false; }); document.querySelectorAll('.person-button').forEach(b => { b.disabled=sending; }); }
}
$('profile-reload').onclick = () => { if (current && !profileBusy) loadProfile(current); };
$('profile-import').onclick = () => changeProfile({action:'import'});
$('profile-add').onsubmit = event => { event.preventDefault(); changeProfile({action:'set',field:$('fact-field').value,key:$('fact-key').value,value:$('fact-value').value}); };
