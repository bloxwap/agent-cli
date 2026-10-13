import { expect, test } from 'vitest';
import { z } from 'zod';
import { dispatch, register } from '../src/core/router.js';
register('echo',{description:'test',schema:z.object({value:z.string()}),execute:async input=>input});
register('crash',{description:'test',schema:z.object({}),execute:async()=>{throw new Error('unexpected');}});
test('flags and stdin give one success envelope',async()=>{
 expect((await dispatch(['echo','--value','hello'])).body).toEqual({ok:true,data:{value:'hello'}});
 expect((await dispatch(['echo'],'{"value":"stdin"}')).exitCode).toBe(0);
 expect((await dispatch(['echo','--json','{"value":"json"}'])).exitCode).toBe(0);
});
test('validation and unexpected failures normalize',async()=>{
 expect((await dispatch(['echo'])).body).toMatchObject({ok:false,code:'CONFIG_INVALID'});
 expect((await dispatch(['crash'])).body).toMatchObject({ok:false,code:'INTERNAL'});
 expect((await dispatch(['schema','echo'])).exitCode).toBe(0);
});
