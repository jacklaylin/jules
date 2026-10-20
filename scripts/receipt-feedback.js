import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createReceiptFeedback,addReceiptQuestions,applyReceiptFeedback,receiptLearningView,proposeReceiptQuestions,interpretReceiptAnswer,applyReceiptAnswer,refreshReceiptEvidence} from '../lib/receipt-feedback.js';
import { callModel as modelCall } from '../lib/model-call.js';

async function callModel({schema,context,instructions}){
  if(!process.env.OPENAI_API_KEY)throw Error('Model interpretation needs OPENAI_API_KEY. Approve the private payload before running.');
  return modelCall({role:'extract',env:process.env,instructions,input:JSON.stringify(context),name:'receipt_feedback',schema,
    failed:response=>Error(`Interpretation HTTP ${response.status}; response omitted`),incomplete:'Interpretation incomplete'});
}

const [command,inputPath,outputPath,eventPath]=process.argv.slice(2);
if(!['create','apply','questions','answer','refresh'].includes(command)||!inputPath||!outputPath)throw Error('Use create INPUT OUTPUT; apply STATE OUTPUT EVENTS; questions STATE OUTPUT PROPOSALS; answer STATE OUTPUT ANSWER; or refresh STATE OUTPUT ITEMS. Use private files outside the repository.');
const input=JSON.parse(await readFile(inputPath,'utf8'));
let state;
if(command==='create'){
  try{await readFile(outputPath);throw Error('Feedback state already exists; use refresh to preserve corrections.');}catch(error){if(error.code!=='ENOENT')throw error;}
  let proposals=input.questions??[];
  if(input.generate_questions){
    const proposed=await proposeReceiptQuestions(input,callModel);proposals=proposed.questions;
  }
  state=createReceiptFeedback(input.owner_id,input.items,proposals);
} else {
  if(!eventPath)throw Error('Provide the structured events/proposals file');
  const changes=JSON.parse(await readFile(eventPath,'utf8'));
  if(command==='refresh')state=refreshReceiptEvidence(input,changes);
  else if(command==='answer'){
    const proposed=await interpretReceiptAnswer(input,changes.message,callModel);
    state=applyReceiptAnswer(input,proposed,changes.provenance);
  }else state=command==='questions'?addReceiptQuestions(input,changes):changes.reduce((current,event)=>applyReceiptFeedback(current,event),input);
}
await mkdir(dirname(outputPath),{recursive:true,mode:0o700});
const temporary=`${outputPath}.${randomUUID()}.tmp`;
await writeFile(temporary,JSON.stringify(state,null,2)+'\n',{mode:0o600});await rename(temporary,outputPath);
const view=receiptLearningView(state);
console.log(JSON.stringify({open_questions:view.questions.map(q=>({id:q.id,question:q.question,item_ids:q.item_ids})),history_items:view.purchase_history.length,learning_observations:view.learning_observations.length,profile_writes:false}));
