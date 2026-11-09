import {createHash, randomUUID} from 'node:crypto';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import type {LibraryPaths} from './libraryPaths.js';
import {assertSafeFolderName,computeSourceRevision,pathExists,readJson,resolveSourceSelection} from './quizFiles.js';

const encode=(v:unknown)=>JSON.stringify(v,null,2)+'\n';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const repo='botgc-comms/services', branch='master', root='BOTGC.RulesQuiz';
const stateName='services-publication.json';
type TreeEntry={path:string;mode:'100644';type:'blob';sha?:string;content?:string};
type ReleaseState={contentVersion:string;servicesCommit:string;commitUrl:string;workflowUrl:string;publishedAtUtc:string;rules:Record<string,{contentRevision:string;sourceRevision:string}>};

export function servicesPublishingConfiguration(){
  return {configured:Boolean(process.env.SERVICES_GITHUB_TOKEN?.trim()),repository:repo,targetBranch:branch,source:'services',contentPath:root};
}
export async function readServicesPublication(paths:LibraryPaths):Promise<ReleaseState|null>{
  const file=path.join(paths.publishedDir,stateName);
  return await pathExists(file)?readJson<ReleaseState>(file):null;
}
function validate(master:any){
  if(master.schemaVersion!==1||!Array.isArray(master.rules)||!master.rules.length)throw new Error('Invalid canonical library.');
  const ids=new Set<string>();
  for(const r of master.rules){
    assertSafeFolderName(r.id);if(ids.has(r.id))throw new Error(`Duplicate question: ${r.id}`);ids.add(r.id);
    if(!r.metadata||!Array.isArray(r.metadata.questions)||r.metadata.questions.length!==2)throw new Error(`Both audiences are required: ${r.id}`);
    const audiences=r.metadata.questions.map((q:any)=>q.audience).sort();
    if(!isDeepStrictEqual(audiences,['junior-friendly','standard']))throw new Error(`Invalid audiences: ${r.id}`);
    for(const q of r.metadata.questions){
      const choices=q.choices.map((c:any)=>c.id),keys=q.correctAnswers;
      if(choices.length<2||new Set(choices).size!==choices.length||!keys?.length||keys.length>=choices.length||new Set(keys).size!==keys.length||keys.some((k:string)=>!choices.includes(k)))throw new Error(`Invalid answer keys: ${r.id}`);
      if(!isDeepStrictEqual(q.correctAnswer,keys.length===1?keys[0]:keys)||q.type!==r.metadata.type||q.type!==(keys.length===1?'multiple_choice':'multi_select'))throw new Error(`Conflicting answer types: ${r.id}`);
      for(const field of ['title','question','explanation'])if(typeof q[field]!=='string'||!q[field].trim())throw new Error(`Missing ${field}: ${r.id}`);
      if(q.choices.some((c:any)=>typeof c.text!=='string'||!c.text.trim()))throw new Error(`Empty answer: ${r.id}`);
    }
    if(r.contentRevision!==hash(encode({metadata:r.metadata,assets:r.assets})))throw new Error(`Stale content revision: ${r.id}`);
  }
  if(master.contentVersion!==hash(encode(master.rules)))throw new Error('Stale library content version.');
}

export async function publishServicesRules(paths:LibraryPaths,folderNames:string[],options:{fetchImplementation?:typeof fetch;token?:string;progress?:(v:{message:string;processed?:number;total?:number})=>void}={}){
  const token=options.token??process.env.SERVICES_GITHUB_TOKEN?.trim();
  if(!token)throw new Error('Services publishing needs a GitHub credential restricted to botgc-comms/services.');
  const transport=options.fetchImplementation??fetch;
  async function api<T>(method:string,route:string,body?:unknown):Promise<T>{
    const response=await transport(`https://api.github.com/repos/${repo}${route}`,{
      method,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'RulesReady-Content-Studio',...(body?{'Content-Type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60_000)});
    if(!response.ok)throw new Error(`Services GitHub ${method} failed (${response.status}). ${response.status===422?'The repository may have changed; review and retry.':''}`);
    return await response.json() as T;
  }
  const ids=[...new Set(folderNames.map(assertSafeFolderName))];
  if(!ids.length)throw new Error('No compiled questions selected.');
  options.progress?.({message:'Reading the authoritative Services library...',processed:0,total:ids.length+2});
  const baseRef=await api<{object:{sha:string}}>('GET',`/git/ref/heads/${branch}`);
  const baseCommit=await api<{tree:{sha:string}}>('GET',`/git/commits/${baseRef.object.sha}`);
  const file=await api<{sha:string;encoding:string;content?:string}>('GET',`/contents/${root}/library.json?ref=${baseRef.object.sha}`);
  const blob=file.encoding==='base64'?file:await api<{content:string}>('GET',`/git/blobs/${file.sha}`);
  const master=JSON.parse(Buffer.from(blob.content!,'base64').toString('utf8'));
  validate(master);
  const baseline=await readJson<any>(path.join(paths.projectRoot,'migrations','2026-11-09-services-library.json'));
  const previous=await readServicesPublication(paths);
  const baselineMap=new Map<string,string>(baseline.rules.map((r:any)=>[r.id,r.contentRevision]));
  for(const [id,r] of Object.entries(previous?.rules??{}))baselineMap.set(id,r.contentRevision);
  const merged=new Map<string,any>(master.rules.map((r:any)=>[r.id,r]));
  const pending:TreeEntry[]=[],assets:{path:string;bytes:Buffer}[]=[];
  const releasedRules={...previous?.rules};
  const changed:string[]=[],skipped:string[]=[];
  const publishedAtUtc=new Date().toISOString();
  for(const [index,id] of ids.entries()){
    const selected=await resolveSourceSelection(path.join(paths.outputDir,id));
    if(!selected.juniorQuestion||!selected.imagePath||!selected.promptPath)throw new Error(`Both audiences and artwork are required: ${id}`);
    const revision=await computeSourceRevision(selected);
    const compiled=await readJson<any>(path.join(paths.compiledDir,id,'metadata.json'));
    if(compiled.compiledFrom?.sourceRevision!==revision)throw new Error(`Compile current changes before releasing: ${id}`);
    const existing=merged.get(id);
    const metadata={...selected.metadata};
    for(const k of ['audience','membershipCategories','learningLevel','title','question','choices','correctAnswer','correctAnswers','explanation','vocabulary','teachingTip','likelyMisconceptions','juniorVersion','compiledFrom'])delete metadata[k];
    metadata.schemaVersion=existing?.metadata.schemaVersion??2;
    metadata.questions=[selected.juniorQuestion,selected.standardQuestion];
    const extension=path.extname(selected.imagePath).toLowerCase();
    if(!['.png','.jpg','.jpeg','.webp'].includes(extension))throw new Error(`Unsupported artwork format: ${id}`);
    metadata.imageFileName=`illustration${extension}`;metadata.promptFileName='final-prompt.txt';
    const image=await fs.readFile(selected.imagePath),prompt=await fs.readFile(selected.promptPath);
    const ruleAssets={image:{path:`Questions/${id}/${metadata.imageFileName}`,sha256:hash(image)},prompt:{path:`Questions/${id}/final-prompt.txt`,sha256:hash(prompt)}};
    // Preserve original key ordering where the semantic metadata is unchanged.
    const effectiveMetadata=existing&&isDeepStrictEqual(metadata,existing.metadata)?existing.metadata:metadata;
    const candidate={...(existing??{id,provenance:{createdIn:'RulesReady Content Studio'}}),metadata:effectiveMetadata,assets:ruleAssets};
    candidate.contentRevision=hash(encode({metadata:candidate.metadata,assets:candidate.assets}));
    const baseRevision=baselineMap.get(id);
    if(candidate.contentRevision===baseRevision&&existing?.contentRevision!==baseRevision){skipped.push(id);continue;}
    if(existing?.contentRevision!==baseRevision&&candidate.contentRevision!==existing?.contentRevision)throw new Error(`Services has newer changes to ${id}. Import/reconcile them before releasing this draft.`);
    if(candidate.contentRevision!==existing?.contentRevision){
      candidate.provenance={...candidate.provenance,studioRelease:{publishedAtUtc,sourceRevision:revision}};
      merged.set(id,candidate);changed.push(id);
      pending.push({path:`${root}/Questions/${id}/metadata.json`,mode:'100644',type:'blob',content:encode(candidate.metadata)});
      if(ruleAssets.image.sha256!==existing?.assets.image.sha256)assets.push({path:`${root}/${ruleAssets.image.path}`,bytes:image});
      if(ruleAssets.prompt.sha256!==existing?.assets.prompt.sha256)assets.push({path:`${root}/${ruleAssets.prompt.path}`,bytes:prompt});
    }
    releasedRules[id]={contentRevision:candidate.contentRevision,sourceRevision:revision};
    options.progress?.({message:`Checked ${id}`,processed:index+1,total:ids.length+2});
  }
  master.rules=[...merged.values()];
  master.contentVersion=hash(encode(master.rules));
  validate(master);
  // Validate the entire merge before uploading any blobs or moving the branch.
  for(const asset of assets){
    const uploaded=await api<{sha:string}>('POST','/git/blobs',{content:asset.bytes.toString('base64'),encoding:'base64'});
    pending.push({path:asset.path,mode:'100644',type:'blob',sha:uploaded.sha});
  }
  if(changed.length)pending.push({path:`${root}/library.json`,mode:'100644',type:'blob',content:encode(master)});
  pending.push({path:`${root}/release-request.json`,mode:'100644',type:'blob',content:encode({schemaVersion:1,releaseId:randomUUID(),publishedAtUtc,contentVersion:master.contentVersion,selectedQuestions:ids,changedQuestions:changed,preservedNewerRepositoryQuestions:skipped,reviewConfirmedBy:process.env.PORTAL_USERNAME??'admin'})});
  const tree=await api<{sha:string}>('POST','/git/trees',{base_tree:baseCommit.tree.sha,tree:pending});
  const commit=await api<{sha:string}>('POST','/git/commits',{message:`Release reviewed quiz content from Studio (${changed.length} changed questions)`,tree:tree.sha,parents:[baseRef.object.sha]});
  await api('PATCH',`/git/refs/heads/${branch}`,{sha:commit.sha,force:false});
  const result:ReleaseState={contentVersion:master.contentVersion,servicesCommit:commit.sha,commitUrl:`https://github.com/${repo}/commit/${commit.sha}`,workflowUrl:`https://github.com/${repo}/actions?query=branch%3Amaster`,publishedAtUtc,rules:releasedRules};
  await fs.mkdir(paths.publishedDir,{recursive:true});
  const stateFile=path.join(paths.publishedDir,stateName);
  await fs.writeFile(stateFile+'.tmp',encode(result));await fs.rename(stateFile+'.tmp',stateFile);
  options.progress?.({message:'Committed to Services. Automatic deployment and consumer verification are running.',processed:ids.length+2,total:ids.length+2});
  return {...result,changedQuestions:changed.length,preservedNewerRepositoryQuestions:skipped.length,deploymentStatus:'pending'};
}
