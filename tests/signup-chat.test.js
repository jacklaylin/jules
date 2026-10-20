import test from 'node:test';
import assert from 'node:assert/strict';
import {splitName,maskBirthday,parseBirthday,starSign,outcomeLines,maskPhone,formatPhone} from '../public/signup-chat.js';
import {normalizeSignupPhone} from '../lib/public-signup.js';
import {normalizeSignupPhone as pagePhone} from '../public/signup-phone.js';

const now=new Date('2026-10-19T12:00:00Z');

test('a full name splits at the last space; one word leaves the last name to ask for',()=>{
 assert.deepEqual(splitName('  Sam   Rivera '),{first:'Sam',last:'Rivera'});
 assert.deepEqual(splitName('Mary Ann Lee'),{first:'Mary Ann',last:'Lee'});
 assert.deepEqual(splitName('Cher'),{first:'Cher',last:''});
 assert.equal(splitName('   '),null);
});

test('birthday digits format as MM / DD / YYYY while typing',()=>{
 assert.equal(maskBirthday('1'),'1');
 assert.equal(maskBirthday('1019'),'10 / 19');
 assert.equal(maskBirthday('10191994'),'10 / 19 / 1994');
 assert.equal(maskBirthday('10/19/19945'),'10 / 19 / 1994');
});

test('birthdays must be real past dates for adults',()=>{
 assert.deepEqual(parseBirthday('10 / 19 / 1994',now),{iso:'1994-10-19',month:10,day:19});
 assert.equal(parseBirthday('10 / 19',now).error,'format');
 assert.equal(parseBirthday('02 / 30 / 1994',now).error,'date');
 assert.equal(parseBirthday('01 / 01 / 1899',now).error,'date');
 assert.equal(parseBirthday('10 / 20 / 2008',now).error,'under_18');
 assert.equal(parseBirthday('10 / 19 / 2008',now).iso,'2008-10-19');
});

test('star signs follow the western date ranges, including the year-end wrap',()=>{
 for(const [month,day,name] of [[10,19,'Libra'],[9,23,'Libra'],[9,22,'Virgo'],[1,19,'Capricorn'],[1,20,'Aquarius'],[12,22,'Capricorn'],[12,21,'Sagittarius'],[2,29,'Pisces'],[7,23,'Leo']])
  assert.equal(starSign(month,day).name,name,`${month}/${day}`);
});

test('the page and the server accept the same phone formats',()=>{
 for(const value of ['(415) 555-0123','14155550123','+44 20 7946 0958','555','+0123','4155550123x'])assert.equal(pagePhone(value),normalizeSignupPhone(value));
 assert.equal(maskPhone('+14155550123'),'•••-0123');
 assert.equal(formatPhone('+14155550123','4155550123'),'+1 (415) 555-0123');
 assert.equal(formatPhone('+442079460958',' +44 20 7946 0958 '),'+44 20 7946 0958');
});

test('closing lines only claim a text when the server confirmed it',()=>{
 const sent=outcomeLines({message_sent:true,text_url:'sms:+1'},'+14155550123');
 assert.match(sent.lines[0],/texted •••-0123/);assert.equal(sent.open,true);
 for(const result of [{message_sent:false,message_status:'uncertain'},{message_sent:false,onboarding_started:true},{message_sent:false,waitlisted:true,text_url:'sms:+1'},{message_sent:false,text_url:'sms:+1'},{message_sent:false}]){
  const {lines}=outcomeLines(result,'+14155550123');
  assert.ok(lines.length>0);assert.ok(!lines.join(' ').includes('i just texted'),JSON.stringify(result));
 }
 assert.match(outcomeLines({message_sent:false,message_status:'sending'},'+1').lines[0],/couldn’t confirm/);
 assert.match(outcomeLines({message_sent:false,waitlisted:true,text_url:'sms:+1'},'+1').lines[0],/waitlist/);
 assert.equal(outcomeLines({message_sent:false},'+1').open,false);
});
