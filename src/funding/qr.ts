import QRCode from 'qrcode';
import {writeFile} from 'node:fs/promises';
export async function renderQr(value:string,options:{enabled?:boolean;path?:string;stderr?:(value:string)=>void}={}){
 if(options.enabled===false) return {qrAscii:null,qrPath:null};
 const qrAscii=await QRCode.toString(value,{type:'terminal',small:true});
 (options.stderr??(value=>process.stderr.write(value)))(qrAscii+'\n');
 if(options.path){if(options.path.endsWith('.svg')) await writeFile(options.path,await QRCode.toString(value,{type:'svg'}),{mode:0o600});else await writeFile(options.path,await QRCode.toBuffer(value,{type:'png'}),{mode:0o600});}
 return {qrAscii,qrPath:options.path??null};
}
