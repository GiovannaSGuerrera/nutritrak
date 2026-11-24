// Audit probes against a fixed LOCAL disposable database; never uses DATABASE_URL.
const { Pool } = require('../../../../apps/api/node_modules/pg');
const { createPostgresStore } = require('../../../../apps/api/dist/postgres-store');
const { spawn } = require('node:child_process');
const net = require('node:net');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const adminUrl = 'postgresql://audit_test@127.0.0.1:55489/nutritrack_main_reaudit_test';
const report = {};
async function start(databaseUrl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nutritrack-reaudit-'));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0,'127.0.0.1',()=>{const p=s.address().port; s.close(()=>resolve(p));}); });
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), DATA_DIR: dir };
  delete env.DATABASE_URL; delete env.TEST_DATABASE_URL; delete env.DB_AUTO_MIGRATE;
  if (databaseUrl) env.DATABASE_URL = databaseUrl;
  const child = spawn(process.execPath,[path.resolve('apps/api/dist/server.js')],{env,stdio:'ignore'});
  const base = `http://127.0.0.1:${port}`;
  for(let i=0;i<100;i++){try {if((await fetch(base+'/api/health')).ok) return {base,child,dir};}catch{} await new Promise(r=>setTimeout(r,50));}
  child.kill(); throw Error('Synthetic server failed to start');
}
async function run(databaseUrl, mode) {
 const server = await start(databaseUrl); const {base}=server;
 async function call(route,method='GET',data,cookie){const res=await fetch(base+route,{method,headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)}); return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
 try {
  const register=(email)=>call('/api/register','POST',{name:'Synthetic audit',email,password:'Synthetic-password-123!'});
  const a=await register('a@example.invalid'), b=await register('b@example.invalid');
  let duplicateRegistration;
  if(databaseUrl){const peer=await start(databaseUrl);try{
    const data={name:'Synthetic duplicate',email:'duplicate@example.invalid',password:'Synthetic-password-123!'};
    duplicateRegistration=await Promise.all([base,peer.base].map(target=>fetch(target+'/api/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)}).then(r=>r.status)));
  }finally{peer.child.kill();}}
  const p=await call('/api/patients','POST',{name:'Original synthetic',email:'patient@example.invalid'},a.cookie), id=p.body.patient.id;
  const cross=await Promise.all([call(`/api/patients/${id}`,'GET',undefined,b.cookie),call(`/api/patients/${id}`,'PATCH',{name:'Cross tenant'},b.cookie)]);
  const invalid=await call(`/api/patients/${id}`,'PATCH',{name:''},a.cookie);
  const after=await call(`/api/patients/${id}`,'GET',undefined,a.cookie);
  // Restore valid name to keep subsequent audit observations independent.
  await call(`/api/patients/${id}`,'PATCH',{name:'Original synthetic'},a.cookie);
  const assessment=await call('/api/assessments','POST',{patientId:id,weight:65,height:170,waist:'not-a-number',date:'2026-99-99'},a.cookie);
  const malformed=await call('/api/meal-plans','POST',{patientId:id,name:'Malformed',meals:[null]},a.cookie);
  const payload={patientId:id,name:'Original plan',objective:'Original objective',meals:[{name:'Meal',items:[{food:'Food',quantity:100,unit:'g'}]}]};
  const plan=await call('/api/meal-plans','POST',payload,a.cookie), planId=plan.body.mealPlan.id;
  const edit1=await call(`/api/meal-plans/${planId}/draft`,'PUT',{...payload,objective:'First edit',expectedRevision:0},a.cookie);
  const edit2=await call(`/api/meal-plans/${planId}/draft`,'PUT',{...payload,objective:'Stale edit',expectedRevision:0},a.cookie);
  const publish=await call(`/api/meal-plans/${planId}/publish`,'POST',{expectedRevision:-999},a.cookie);
  const startAt=new Date(Date.now()+86400000).toISOString();
  const appointment=await call('/api/appointments','POST',{patientId:id,start:startAt,duration:50},a.cookie);
  await call(`/api/appointments/${appointment.body.appointment.id}`,'PATCH',{status:'cancelada'},a.cookie);
  const replacement=await call('/api/appointments','POST',{patientId:id,start:startAt,duration:50},a.cookie);
  const reactivate=await call(`/api/appointments/${appointment.body.appointment.id}`,'PATCH',{status:'agendada'},a.cookie);
  const invalidStatus=await call(`/api/patients/${id}`,'PATCH',{status:'NOT_A_VALID_STATUS'},a.cookie);
  await call(`/api/patients/${id}`,'PATCH',{status:'Ativo'},a.cookie);
  const invite=await call(`/api/patients/${id}/invitations`,'POST',{},a.cookie);
  await call('/api/patient/activate','POST',{token:invite.body.token,email:'patient@example.invalid',password:'Synthetic-password-123!'});
  const reset=await call(`/api/patients/${id}/password-resets`,'POST',{},a.cookie);
  const other=databaseUrl?await start(databaseUrl):null;
  let resetStatuses;
  try {
    const attempt=(target)=>fetch(target+'/api/patient/password-resets/complete',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:reset.body.token,password:'Synthetic-new-password-123!'})}).then(r=>r.status);
    resetStatuses=await Promise.all([attempt(base),attempt(other?.base||base)]);
  } finally {other?.child.kill();}
  const missingAccountRoutes=await Promise.all(['/api/account/export','/api/auth/password-reset/request'].map((route,i)=>call(route,i?'POST':'GET',i?{email:'a@example.invalid'}:undefined,i?undefined:a.cookie)));
  // Only a partial local request is used; cancel it after 200ms.
  const slow=http.request(base+'/api/register',{method:'POST',headers:{'content-type':'application/json','content-length':100}}); slow.on('error',()=>{}); slow.write('{');
  await new Promise(r=>setTimeout(r,30)); let healthCompleted=false;
  const health=fetch(base+'/api/health').then(r=>{healthCompleted=true;return r.status;});
  await new Promise(r=>setTimeout(r,200)); const healthBlocked=!healthCompleted; slow.destroy();
  const healthAfter=await health;
  report[mode]={registration:[a.status,b.status],duplicateRegistration,parallelResetStatuses:resetStatuses,crossTenantReadPatch:cross.map(x=>x.status),invalidPatch:{status:invalid.status,nameAfter:after.body.patient.name},invalidAssessment:{status:assessment.status,waist:assessment.body.assessment?.waist,date:assessment.body.assessment?.date},malformedMeal:malformed.status,stalePlan:{updates:[edit1.status,edit2.status],finalObjective:edit2.body.mealPlan.versions.at(-1).objective,publishInvalidRevision:publish.status},agenda:{replacement:replacement.status,reactivation:reactivate.status},arbitraryPatientStatus:invalidStatus.status,missingAccountRoutes:missingAccountRoutes.map(x=>x.status),partialBodyBlocksHealth200ms:healthBlocked,healthAfterCancellation:healthAfter};
  if(databaseUrl){ const db=new Pool({connectionString:databaseUrl}); try {const r=await db.query('SELECT "waist"::text AS waist, date FROM assessments WHERE id=$1',[assessment.body.assessment.id]); report[mode].databaseAssessment=r.rows[0];} finally{await db.end();}}
 } finally { server.child.kill(); }
}
(async()=>{
 const admin=new Pool({connectionString:adminUrl}); const schema='probe_'+randomUUID().replaceAll('-','');
 await admin.query(`CREATE SCHEMA "${schema}"`);
 const url=new URL(adminUrl); url.searchParams.set('options','-c search_path='+schema);
 try {await run(url.toString(),'postgres'); await run(undefined,'jsonDevelopment'); await fs.writeFile(path.join(__dirname,'probe-results.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));}
 finally {await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});
