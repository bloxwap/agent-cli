import {wordlist} from '@scure/bip39/wordlists/english.js';
import {AgentCliError} from '../errors/index.js';
const words=new Set(wordlist);
export function resemblesSecret(value:string){
 const trimmed=value.trim();if(/^(?:0x)?[0-9a-fA-F]{64}$/.test(trimmed)) return true;
 const tokens=trimmed.toLowerCase().split(/\s+/);return [12,15,18,21,24].includes(tokens.length)&&tokens.every(word=>words.has(word));
}
export function assertSafeInput(value:unknown):void{
 if(typeof value==='string'&&resemblesSecret(value)) throw new AgentCliError('POLICY_REJECTED','Private keys and seed phrases are forbidden; use external wallet signing');
 if(Array.isArray(value)) value.forEach(assertSafeInput);
 else if(value&&typeof value==='object') for(const [key,field] of Object.entries(value)){if(/private.?key|seed.?phrase|mnemonic/i.test(key)) throw new AgentCliError('POLICY_REJECTED','Secret key input is forbidden');assertSafeInput(field);}
}
