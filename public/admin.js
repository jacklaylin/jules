const $ = id => document.getElementById(id);
let token = sessionStorage.getItem('jules_token');
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has('access_token')) {
  token = fragment.get('access_token'); sessionStorage.setItem('jules_token', token);
}
const loginError = fragment.get('error_description');
if (location.hash) history.replaceState(null, '', '/admin');
let current = null, requestVersion = 0, cursor = null, historyMessages = [], sending = false, operation = null;
function notice(message) { $('notice').textContent = message; $('notice').hidden = !message; }
function showLogin() { token = null; sessionStorage.removeItem('jules_token'); $('login').hidden = false; $('inbox').hidden = true; $('signout').hidden = true; }
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401 || response.status === 403) showLogin(); throw new Error(data.error ?? 'Request failed.'); }
  return data;
}
const date = at => new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
function renderMessages() {
  $('messages').replaceChildren();
  for (const message of historyMessages) {
    const item = document.createElement('article'); item.className = `message ${message.direction} ${message.status}`;
    const bubble = document.createElement('div'); bubble.className = 'bubble'; bubble.textContent = message.body;
    const meta = document.createElement('div'); meta.className = 'meta';
    const status = message.status === 'sent' ? 'Accepted by Photon' : message.status === 'generating' ? 'AI preparing reply · refresh to check' : message.status === 'sending' ? 'Send started · refresh to check' : message.status === 'uncertain' ? 'Delivery uncertain · check the phone before resending' : 'Received';
    meta.textContent = `${date(message.created_at)} · ${message.source === 'greeting' ? 'Automatic greeting · ' : message.source === 'ai' ? 'Jules AI · ' : message.source === 'ai_fallback' ? 'AI failed · manual review needed · ' : ''}${status}`;
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
  if (!earlier) $('messages').scrollTop = $('messages').scrollHeight;
}
async function loadInbox() {
  const data = await api('/api/admin');
  $('login').hidden = true; $('inbox').hidden = false; $('signout').hidden = false;
  $('people').replaceChildren();
  if (!data.conversations.length) { const p = document.createElement('p'); p.className = 'no-people'; p.textContent = 'No conversations yet. Send an iMessage to your assigned line to begin.'; $('people').append(p); }
  for (const person of data.conversations) {
    const button = document.createElement('button'); button.className = `person-button${current === person.id ? ' selected' : ''}`;
    const title = document.createElement('strong'); title.textContent = person.sender_id;
    const subtitle = document.createElement('span'); subtitle.textContent = `Last activity · ${date(person.updated_at)}`;
    button.append(title, subtitle); button.disabled = sending;
    button.onclick = async () => {
      if (sending) return;
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
$('signout').onclick = () => { current = null; $('reply').value = ''; operation = null; showLogin(); notice('Signed out on this browser.'); };
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
