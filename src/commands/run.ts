import {z} from 'zod';
import {register} from '../core/router.js';
import {commandConfig} from './read.js';
import {Runner,detachRunner,setActiveRunner} from '../runner/lifecycle.js';
register('run',{description:'Start persistent signing runner (foreground or detach)',schema:z.object({detach:z.boolean().default(false),daemon:z.boolean().default(false)}),execute:async(input,context)=>{
 if(input.detach||input.daemon) return detachRunner([...(context.configPath?['--config',context.configPath]:[]),...(context.network?['--network',context.network]:[])]);
 const runner=new Runner(await commandConfig(context));const info=await runner.start();if(!info.existing){setActiveRunner(runner);runner.signals();}return info;
}});
