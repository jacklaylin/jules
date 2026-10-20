import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SECOND_PERSON,CLAIMS,MONEY,BANNED} from '../lib/copy-guards.js';

// The shared guards are exactly the lists fit-read.js and style-report.js each kept before they moved here.
test('shared copy guards keep the patterns the report cards used',()=>{
 assert.equal(SECOND_PERSON.source,String.raw`\b(you|your|yours|you're|you’re|yourself)\b`);
 assert.equal(CLAIMS.source,String.raw`\b(favou?rite|loyal|always|every ?time|obsess|addict)`);
 assert.equal(MONEY.source,String.raw`[$€£]|\b(price|cost|costs|spent|expensive|cheap|dollars?|pounds?|euros?|budget|rich|poor|salary)\b`);
 assert.equal(BANNED.source,String.raw`\b(favou?rite|loyal|always|every ?time|obsess|addict|complete history|\$|€|£|dollars?|pounds?|euros?|cost|spent|price)`);
 for(const re of [SECOND_PERSON,CLAIMS,MONEY,BANNED])assert.equal(re.flags,'i');
});

test('guards catch claims, money and second person in model-written lines',()=>{
 assert.ok(BANNED.test('YOUR FAVORITE STORE')&&BANNED.test('NO PRICE ADJUSTMENTS'));
 assert.ok(!BANNED.test('NO RETURNS ON BEIGE'));
 assert.ok(CLAIMS.test('always in black')&&MONEY.test('expensive taste')&&!MONEY.test('cream harrington'));
 assert.ok(SECOND_PERSON.test('you skipped the beginner colours')&&!SECOND_PERSON.test('youth'));
});
