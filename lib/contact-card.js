import { readFile } from 'node:fs/promises';
import { normalizeSignupPhone } from './public-signup.js';

// Jules's contact card (jules.vcf), sent after the onboarding welcome so a new tester can save Jules
// with the still-orb photo. The number and site come from deployment settings, never the repository.
export const CONTACT_CARD_TEXT = 'save me so you know it’s me:';
export const CONTACT_CARD_FILE = { name: 'jules.vcf', mimeType: 'text/vcard' };
const PHOTO = new URL('../public/brand/contact-photo-512.jpg', import.meta.url);

export const loadContactPhoto = () => readFile(PHOTO);

// vCard 3.0: the version iOS Contacts reads most reliably, including an inline base64 PHOTO.
// Returns null without a valid JULES_PUBLIC_LINE: a card without Jules's number would save nothing useful.
export function julesVCard(env, photo) {
  const line = normalizeSignupPhone(env.JULES_PUBLIC_LINE);
  if (!line) return null;
  const site = String(env.SITE_ORIGIN ?? '').replace(/\/$/, '');
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', 'N:;Jules;;;', 'FN:Jules', 'NOTE:Personal shopper', `TEL;TYPE=CELL,VOICE,pref:${line}`];
  if (/^https:\/\/[^\s]+$/.test(site)) lines.push(`URL:${site}`);
  if (photo?.length) lines.push(`PHOTO;ENCODING=b;TYPE=JPEG:${Buffer.from(photo).toString('base64')}`);
  lines.push('END:VCARD');
  // Lines longer than 75 octets are folded with CRLF + space (RFC 2425/6350).
  return lines.map(fold).join('\r\n') + '\r\n';
}
const fold = text => text.length <= 75 ? text : text.match(/.{1,74}/g).join('\r\n ');

// The card as an attachment for sendGreeting's `files`, or null when it can't be built.
export async function contactCardFile(env, { load = loadContactPhoto, log = console.log } = {}) {
  if (!normalizeSignupPhone(env.JULES_PUBLIC_LINE)) return null;
  let photo = null;
  try { photo = await load(); } catch { log(JSON.stringify({ event: 'contact_card_photo_missing' })); }
  const card = julesVCard(env, photo);
  return card ? { ...CONTACT_CARD_FILE, bytes: Buffer.from(card, 'utf8') } : null;
}
