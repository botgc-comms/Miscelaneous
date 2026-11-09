import {spawn} from 'node:child_process';
import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repository='git@github.com:botgc-comms/services.git';
const apiRoot='https://api.github.com/repos/botgc-comms/services';
// Public host key from https://api.github.com/meta, verified 9 November 2026.
const githubHostKey='github.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl\n';
const quote=(s:string)=>`'${s.replaceAll("'", "'\\''")}'`;
const objectId=(s:unknown)=>{if(typeof s!=='string'||!/^[a-f0-9]{40}$/.test(s))throw new Error('Invalid Git object.');return s;};
const safePath=(s:unknown)=>{if(typeof s!=='string'||!s.startsWith('BOTGC.RulesQuiz/')||s.split('/').some(p=>!p||p==='.'||p==='..')||/[\\\x00-\x1f]/.test(s))throw new Error('Invalid release path.');return s;};

/** The same reconciliation can use a repository-only deploy key without a personal token.
 * localRepository is an explicit test-only argument; it is never read from configuration.
 */
export async function withServicesGitTransport<T>(privateKey:string, action:(transport:typeof fetch)=>Promise<T>, localRepository?:string):Promise<T>{
  const temporaryRoot=path.resolve(os.tmpdir());
  const scratch=await fs.mkdtemp(path.join(temporaryRoot,'services-publish-'));
  const checkout=path.join(scratch,'repository');
  const env:NodeJS.ProcessEnv={...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'never',
    GIT_AUTHOR_NAME:'RulesReady Content Studio',GIT_AUTHOR_EMAIL:'content-studio@users.noreply.github.com',
    GIT_COMMITTER_NAME:'RulesReady Content Studio',GIT_COMMITTER_EMAIL:'content-studio@users.noreply.github.com'};
  // Never pass the configured private key on to Git or its subprocesses as an env var.
  delete env.SERVICES_GITHUB_SSH_KEY;
  delete env.SERVICES_GITHUB_TOKEN;
  const run=(args:string[],input?:Buffer|string,cwd=checkout):Promise<Buffer>=>new Promise((resolve,reject)=>{
    const process=spawn('git',args,{cwd,env,stdio:['pipe','pipe','pipe'],windowsHide:true});
    const chunks:Buffer[]=[];let size=0,settled=false;
    const timer=setTimeout(()=>{process.kill();reject(new Error('Services Git operation timed out.'));},120_000);
    process.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>24*1024*1024){process.kill();}else chunks.push(chunk);});
    // Drain stderr, but do not log it: Git/SSH diagnostics may contain configuration.
    process.stderr.on('data',()=>{});
    process.on('error',()=>{if(!settled){settled=true;clearTimeout(timer);reject(new Error('Services Git could not start.'));}});
    process.on('close',code=>{if(settled)return;settled=true;clearTimeout(timer);if(code!==0||size>24*1024*1024)reject(new Error('Services Git operation failed. Check repository access or concurrent changes.'));else resolve(Buffer.concat(chunks));});
    process.stdin.on('error',()=>{});process.stdin.end(input);
  });
  try{
    if(localRepository){
      if(!path.isAbsolute(localRepository))throw new Error('Local test repository must be absolute.');
    }else{
      if(!privateKey.includes('PRIVATE KEY'))throw new Error('Services deploy key is missing or invalid.');
      const key=path.join(scratch,'identity'),hosts=path.join(scratch,'known_hosts');
      await fs.writeFile(key,privateKey.trim()+'\n',{mode:0o600});
      await fs.writeFile(hosts,githubHostKey,{mode:0o600});
      Object.assign(env,{GIT_SSH_COMMAND:`ssh -i ${quote(key)} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${quote(hosts)}`});
    }
    await run(['clone','--bare','--filter=blob:none','--depth=1','--single-branch','--branch','master','--',localRepository??repository,checkout],undefined,scratch);
    await run(['config','core.autocrlf','false']);
    const gitText=async(args:string[],input?:Buffer|string)=>(await run(args,input)).toString('utf8').trim();
    const transport:typeof fetch=async(input,init)=>{
      const url=String(input);if(!url.startsWith(apiRoot+'/'))throw new Error('Unexpected Services API destination.');
      const route=url.slice(apiRoot.length),method=init?.method??'GET';
      const body=init?.body?JSON.parse(String(init.body)):undefined;
      let result:unknown;
      if(method==='GET'&&route==='/git/ref/heads/master')result={object:{sha:await gitText(['rev-parse','refs/heads/master'])}};
      else if(method==='GET'&&/^\/git\/commits\/[a-f0-9]{40}$/.test(route))result={tree:{sha:await gitText(['rev-parse',`${objectId(route.split('/').at(-1))}^{tree}`])}};
      else if(method==='GET'&&/^\/contents\/BOTGC\.RulesQuiz\/library\.json\?ref=[a-f0-9]{40}$/.test(route)){
        const bytes=await run(['show',`${objectId(route.split('ref=')[1])}:BOTGC.RulesQuiz/library.json`]);
        result={encoding:'base64',content:bytes.toString('base64')};
      }else if(method==='POST'&&route==='/git/blobs'){
        if(body.encoding!=='base64')throw new Error('Unexpected Git blob encoding.');
        result={sha:await gitText(['hash-object','-w','--stdin'],Buffer.from(body.content,'base64'))};
      }else if(method==='POST'&&route==='/git/trees'){
        await run(['read-tree',objectId(body.base_tree)]);
        for(const entry of body.tree){
          if(entry.mode!=='100644'||entry.type!=='blob')throw new Error('Unexpected Git tree entry.');
          const file=safePath(entry.path);
          const sha=entry.sha?objectId(entry.sha):await gitText(['hash-object','-w','--stdin'],entry.content);
          await run(['update-index','--add','--cacheinfo','100644',sha,file]);
        }
        result={sha:await gitText(['write-tree'])};
      }else if(method==='POST'&&route==='/git/commits'){
        if(body.parents?.length!==1)throw new Error('Release requires one parent.');
        result={sha:await gitText(['commit-tree',objectId(body.tree),'-p',objectId(body.parents[0]),'-m',String(body.message)])};
      }else if(method==='PATCH'&&route==='/git/refs/heads/master'){
        if(body.force!==false)throw new Error('Forced release updates are forbidden.');
        try{await run(['push','origin',`${objectId(body.sha)}:refs/heads/master`]);}
        catch{return new Response('{}',{status:422});}
        result={object:{sha:body.sha}};
      }else throw new Error('Unsupported Services Git operation.');
      return new Response(JSON.stringify(result),{status:200});
    };
    return await action(transport);
  }finally{
    // Resolve and check the exact temporary directory before recursive cleanup.
    const resolved=path.resolve(scratch);
    if(path.dirname(resolved)!==temporaryRoot||!path.basename(resolved).startsWith('services-publish-'))throw new Error('Unsafe temporary cleanup path.');
    await fs.rm(resolved,{recursive:true,force:true});
  }
}
