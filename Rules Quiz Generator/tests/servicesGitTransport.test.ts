import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {withServicesGitTransport} from '../servicesGitTransport.js';
const execute=promisify(execFile);
test('repository transport preserves unrelated files, writes real commits and rejects a concurrent push',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'services-git-test-'));
  const source=path.join(root,'source'),remote=path.join(root,'remote.git');
  const git=async(args:string[],cwd=source)=>(await execute('git',args,{cwd,windowsHide:true})).stdout.trim();
  try{
    await fs.mkdir(source);await git(['init','-b','master']);
    await git(['config','user.name','Transport test']);await git(['config','user.email','test@example.invalid']);
    await fs.mkdir(path.join(source,'BOTGC.RulesQuiz'));
    await fs.writeFile(path.join(source,'BOTGC.RulesQuiz/library.json'),'{"original":true}\n');
    await fs.writeFile(path.join(source,'unrelated.txt'),'must remain unchanged\n');
    await git(['add','.']);await git(['commit','-m','Seed test repository']);
    await git(['clone','--bare',source,remote],root);
    await withServicesGitTransport('',async transport=>{
      const request=async(method:string,route:string,body?:unknown)=>{
        const response=await transport('https://api.github.com/repos/botgc-comms/services'+route,{method,body:body?JSON.stringify(body):undefined});
        return {status:response.status,data:await response.json() as any};
      };
      const base=(await request('GET','/git/ref/heads/master')).data.object.sha;
      const baseTree=(await request('GET',`/git/commits/${base}`)).data.tree.sha;
      const file=(await request('GET',`/contents/BOTGC.RulesQuiz/library.json?ref=${base}`)).data;
      assert.equal(Buffer.from(file.content,'base64').toString(),'{"original":true}\n');
      const blob=(await request('POST','/git/blobs',{encoding:'base64',content:Buffer.from('artwork bytes').toString('base64')})).data.sha;
      const tree=(await request('POST','/git/trees',{base_tree:baseTree,tree:[{path:'BOTGC.RulesQuiz/release-request.json',mode:'100644',type:'blob',content:'{"reviewed":true}\n'},{path:'BOTGC.RulesQuiz/Questions/test/image.png',mode:'100644',type:'blob',sha:blob}]})).data.sha;
      const commit=(await request('POST','/git/commits',{tree,parents:[base],message:'Reviewed release'})).data.sha;
      assert.equal((await request('PATCH','/git/refs/heads/master',{sha:commit,force:false})).status,200);
      assert.equal(await git(['show','master:unrelated.txt'],remote),'must remain unchanged');
      assert.equal(await git(['show','master:BOTGC.RulesQuiz/library.json'],remote),'{"original":true}');
      assert.equal(await git(['show','master:BOTGC.RulesQuiz/Questions/test/image.png'],remote),'artwork bytes');
      const race=(await request('POST','/git/commits',{tree,parents:[base],message:'Conflicting release'})).data.sha;
      assert.equal((await request('PATCH','/git/refs/heads/master',{sha:race,force:false})).status,422);
      assert.equal(await git(['rev-parse','master'],remote),commit);
      await assert.rejects(()=>request('PATCH','/git/refs/heads/master',{sha:race,force:true}),/forbidden/);
      await assert.rejects(()=>request('POST','/git/trees',{base_tree:baseTree,tree:[{path:'BOTGC.RulesQuiz/../../outside',mode:'100644',type:'blob',content:'bad'}]}),/Invalid release path/);
      await assert.rejects(()=>transport('https://example.invalid/',{}),/Unexpected Services API destination/);
    },remote);
  }finally{
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));assert(path.basename(resolved).startsWith('services-git-test-'));
    await fs.rm(resolved,{recursive:true,force:true});
  }
});
