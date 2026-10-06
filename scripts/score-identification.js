import {readFile} from 'node:fs/promises';
import {scoreIdentification} from '../lib/evaluation.js';
if(!process.argv[2])throw new Error('Provide a private grades file path.');
console.log(JSON.stringify(scoreIdentification(JSON.parse(await readFile(process.argv[2],'utf8')))),null,2));
