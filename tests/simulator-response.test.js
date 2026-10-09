import test from 'node:test';
import assert from 'node:assert/strict';
import {readSimulatorResponse} from '../public/simulator-response.js';

test('platform timeout preserves recovery guidance instead of exposing a JSON parse error',async()=>{
  await assert.rejects(readSimulatorResponse(new Response('An error occurred',{status:504}),{turn:true}),error=>/took too long/.test(error.message)&&/save may have completed/.test(error.message)&&!/Unexpected token/.test(error.message));
});
test('HTML gateway failures and malformed successful responses are handled',async()=>{
  await assert.rejects(readSimulatorResponse(new Response('<html>Bad gateway</html>',{status:502})),/unreadable response/);
  await assert.rejects(readSimulatorResponse(new Response('{}'),{turn:true}),/incomplete response/);
});
test('application errors retain useful server guidance',async()=>{
  await assert.rejects(readSimulatorResponse(new Response(JSON.stringify({error:'Owner sign-in required.'}),{status:401})),/Owner sign-in required/);
});
test('valid turn and collection responses pass through',async()=>{
  const turn={snapshot:{messages:[]},replies:[],events:[],outcome:'sent',elapsed_ms:100};
  assert.deepEqual(await readSimulatorResponse(new Response(JSON.stringify(turn)),{turn:true}),turn);
  assert.deepEqual(await readSimulatorResponse(new Response('{"items":[]}')),{items:[]});
});
