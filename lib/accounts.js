// Self-serve accounts. Approving someone in Admin › People gives their conversation what the owner
// used to add by hand (ONBOARDING.md): a Supabase sign-in user, its wishlist_members row and an
// onboarding invite. People sign in by phone code or a texted link, so the sign-in email is internal:
// it is never shown, typed or mailed, and it says nothing about the person.
export const accountEmail = conversationId => `${conversationId}@members.jules.invalid`;

// Creates the Supabase Auth user for an internal email. An existing user with that email is fine
// (a retried approval); any other failure throws without the provider's message.
export async function createSignInUser(email, env, fetcher = fetch) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetcher(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/admin/users`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, email_confirm: true }), signal: AbortSignal.timeout(10000) });
  if (response.ok) return 'created';
  const failure = await response.json().catch(() => ({}));
  if (response.status === 422 && (failure.code === 'email_exists' || /already (been )?registered/i.test(failure.msg ?? failure.message ?? ''))) return 'existing';
  throw Object.assign(new Error('Sign-in user not created'), { status: response.status, code: typeof failure.code === 'string' ? failure.code.slice(0, 40) : null });
}

// Gives an approved conversation an account and an onboarding invite. A conversation that already has
// a member (an owner-provisioned tester) keeps it; only a missing invite is added.
// Returns 'created' or 'existing'.
export async function setUpAccount(store, conversation, env, fetcher = fetch) {
  let outcome = 'existing';
  if (!await store.memberEmail(conversation.id)) {
    const email = accountEmail(conversation.id);
    await createSignInUser(email, env, fetcher);
    await store.addMember(email, conversation.id);
    outcome = 'created';
  }
  await store.inviteOnboarding(conversation.id);
  return outcome;
}
