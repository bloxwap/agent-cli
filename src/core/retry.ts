import { normalizeError } from '../errors/index.js';
export async function retry<T>(operation:()=>Promise<T>,options:{attempts?:number;baseMs?:number;maxMs?:number;random?:()=>number;sleep?:(ms:number)=>Promise<void>}={}) {
 const attempts=options.attempts??3;
 if(!Number.isInteger(attempts)||attempts<1) throw new RangeError('attempts must be positive');
 for(let attempt=0;;attempt++) {
  try{return await operation();}catch(error){
   const normalized=normalizeError(error);if(!normalized.retryable||attempt+1>=attempts) throw normalized;
   const base=Math.min(options.maxMs??30_000,(options.baseMs??250)*2**attempt);
   const jitter=0.5+(options.random??Math.random)();
   await (options.sleep??(ms=>new Promise(resolve=>setTimeout(resolve,ms))))(Math.min(options.maxMs??30_000,base*jitter));
  }
 }
}
