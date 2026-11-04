const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
let handler, unlistened = 0, calls = [], timers = new Map(), nextTimer = 0;
const source = fs.readFileSync('src/speech-recognition.ts','utf8')
  .replace('import { localId } from "./id";', 'const localId = () => "test-session";')
  .replace('await import("@tauri-apps/api/core")', 'await globalThis.nativeCore')
  .replace('await import("@tauri-apps/api/event")', 'await globalThis.nativeEvents');
const context = vm.createContext({exports:{}, DOMException, Error, console,
  window:{__TAURI_INTERNALS__:{},addEventListener(){},removeEventListener(){}},
  setTimeout(fn,ms){const id=++nextTimer;timers.set(id,{fn,ms});return id;},
  clearTimeout(id){timers.delete(id);},
  nativeCore:{async invoke(command,args){calls.push({command,args});return command==='speech_recognition_available';}},
  nativeEvents:{async listen(event,callback){assert.equal(event,'agent-speech');handler=callback;return ()=>unlistened++;}}
});
vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context);
const emit = (type,fields={}) => handler({payload:{sessionId:'test-session',type,...fields}});
(async()=>{
  let started=0,finished=0,ended=0,results=[],errors=[];
  const callbacks={onStart(){started++;},onResult(text){results.push(text);},onEnd(){ended++;},onError(message){errors.push(message);}};
  const control=await context.exports.startSpeechRecognition(callbacks,{onFinishing(){finished++;}});
  emit('started');emit('result',{text:'测试',isFinal:false});
  assert.equal(started,1);
  assert.equal([...timers.values()].some(t=>t.ms===1800 || t.ms===12000),false,'Native silence must not be inferred from partial text timing');
  emit('finishing');assert.equal(finished,1);
  emit('result',{text:'测试。',isFinal:true});emit('ended');
  assert.equal(ended,1);assert.equal(results.at(-1),'测试。');assert.equal(errors.length,0);assert.equal(timers.size,0);
  control.stop();assert.equal(ended,1);
  const cancelled=await context.exports.startSpeechRecognition(callbacks);
  emit('started');cancelled.cancel();emit('result',{text:'不得发送'});emit('ended');
  assert.equal(ended,1);assert.equal(results.at(-1),'测试。');assert.ok(unlistened>=2);
  assert.ok(calls.some(c=>c.command==='stop_speech_recognition' && c.args.cancel));
  await context.exports.startSpeechRecognition(callbacks);
  emit('error',{message:'Speech / 1101'});emit('ended');assert.equal(errors.at(-1),'Speech / 1101');assert.equal(ended,1);
  console.log('System speech lifecycle, native pause ownership, cancellation and errors passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
