/**
 * The operator console's script (served inline on /admin). Plain ES2017, no
 * build step. It talks only to /api/v1/admin/* with the operator token, which
 * lives in sessionStorage for this tab and is never written anywhere else.
 * Every value is rendered through esc(): ticket text comes from the public.
 */
export const ADMIN_CONSOLE_JS = String.raw`
(function(){
var app=document.getElementById('app');
var KEY='hp-admin-token';
function token(){try{return sessionStorage.getItem(KEY)||''}catch(e){return ''}}
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function uid(){return (crypto.randomUUID&&crypto.randomUUID())||String(Date.now())+Math.random()}
async function api(method,path,body,raw){
  var h={'x-admin-token':token(),'idempotency-key':uid()};
  if(body!==undefined&&!raw)h['content-type']='application/json';
  if(raw)h['content-type']='text/csv';
  var r=await fetch('/api/v1'+path,{method:method,headers:h,body:body===undefined?undefined:(raw?body:JSON.stringify(body))});
  var j=await r.json().catch(function(){return {}});
  if(!r.ok){var e=new Error((j.error&&j.error.message)||('HTTP '+r.status));e.body=j;throw e}
  return j.data;
}
function table(rows,cols){
  if(!rows||!rows.length)return '<p class="meta">Nothing here yet.</p>';
  return '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr>'+cols.map(function(c){return '<th style="text-align:left;padding:8px;border-bottom:1px solid var(--line)">'+esc(c[1])+'</th>'}).join('')+'</tr></thead><tbody>'+
    rows.map(function(r){return '<tr>'+cols.map(function(c){var v=typeof c[0]==='function'?c[0](r):esc(r[c[0]]);return '<td style="padding:8px;border-bottom:1px solid var(--line);vertical-align:top">'+v+'</td>'}).join('')+'</tr>'}).join('')+'</tbody></table></div>';
}
function msg(el,text,ok){el.className=ok?'ok':'err';el.textContent=text}
var TABS=[['grants','Review grants'],['benchmarks','Benchmarks'],['sources','Sources'],['regions','Regions'],['support','Support'],['audit','Audit'],['subs','Subscriptions'],['jobs','Jobs'],['config','Config']];
var current='grants';
function login(){
  app.innerHTML='<form id="lg" class="support"><label>Operator token<input id="tk" type="password" autocomplete="off" required minlength="24"></label><button class="btn primary">Open console</button><p id="st"></p></form>';
  document.getElementById('lg').onsubmit=async function(e){e.preventDefault();try{sessionStorage.setItem(KEY,document.getElementById('tk').value.trim())}catch(_){}
    try{await api('GET','/admin/jobs');render()}catch(err){try{sessionStorage.removeItem(KEY)}catch(_){}msg(document.getElementById('st'),err.message,false)}};
}
function render(){
  app.innerHTML='<nav style="display:flex;gap:8px;flex-wrap:wrap;margin:18px 0">'+TABS.map(function(t){return '<button class="btn '+(t[0]===current?'primary':'ghost')+'" data-tab="'+t[0]+'">'+t[1]+'</button>'}).join('')+
    '<button class="btn ghost" id="out">Sign out</button></nav><div id="pane"><p>Loading…</p></div>';
  app.querySelectorAll('[data-tab]').forEach(function(b){b.onclick=function(){current=b.getAttribute('data-tab');render()}});
  document.getElementById('out').onclick=function(){try{sessionStorage.removeItem(KEY)}catch(_){}login()};
  var pane=document.getElementById('pane');
  (VIEWS[current])(pane).catch(function(err){pane.innerHTML='<p class="err">'+esc(err.message)+'</p>'});
}
var VIEWS={
  grants:async function(p){
    var rows=await api('GET','/admin/review-grants');
    p.innerHTML='<h2>Review access</h2><p class="meta">Time-limited access for a store reviewer or test account (at most 30 days). The account must exist first.</p>'+
      '<form id="f" class="support"><label>Account email<input name="email" type="email" required></label><label>Days (1–30)<input name="days" type="number" min="1" max="30" value="14" required></label><label>Reason<input name="reason" required></label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="verify" style="min-height:0"> Also confirm the email address</label><button class="btn primary">Grant access</button><p id="st"></p></form>'+
      table(rows,[['email','Email'],['reason','Reason'],['expires_at','Expires'],['revoked_at','Revoked'],[function(r){return r.revoked_at?'':'<button class="btn ghost" data-revoke="'+esc(r.id)+'">Revoke</button>'},'']]);
    p.querySelector('#f').onsubmit=async function(e){e.preventDefault();var f=new FormData(this);try{await api('POST','/admin/review-grants',{email:f.get('email'),days:Number(f.get('days')),reason:f.get('reason'),verify_email:f.get('verify')==='on'});render()}catch(err){msg(p.querySelector('#st'),err.message,false)}};
    p.querySelectorAll('[data-revoke]').forEach(function(b){b.onclick=async function(){if(!confirm('Revoke this access now?'))return;await api('POST','/admin/review-grants/'+b.getAttribute('data-revoke')+'/revoke',{});render()}});
  },
  benchmarks:async function(p){
    var batches=await api('GET','/admin/benchmarks/batches');
    p.innerHTML='<h2>Benchmark rates</h2><p class="meta">Import a CSV as a draft batch, validate every row, then publish. Publishing retires the previous rates for the same item, region and currency. Never publish a rate without a licensed source.</p>'+
      '<form id="imp" class="support"><label>CSV (item_code, country_code, region_code, currency, unit, net_unit_price, tax_rate, spec_json, effective_date, valid_until, source_id, includes_json)<textarea name="csv" required></textarea></label><label>Batch label<input name="label" value="CSV import"></label><button class="btn primary">Import as drafts</button><p id="st"></p></form>'+
      '<h3 style="margin-top:26px">Batches</h3>'+table(batches,[['label','Label'],['status','Status'],['row_count','Rates'],['validated_at','Validated'],['published_at','Published'],[function(b){
        var a='<button class="btn ghost" data-view="'+esc(b.id)+'">Rates</button> ';
        if(b.status==='draft'||b.status==='validated')a+='<button class="btn ghost" data-validate="'+esc(b.id)+'">Validate</button> ';
        if(b.status==='validated')a+='<button class="btn primary" data-publish="'+esc(b.id)+'">Publish</button> ';
        if(b.status==='published')a+='<button class="btn ghost" data-rollback="'+esc(b.id)+'">Roll back</button>';
        return a},'']])+'<div id="detail"></div>';
    var st=p.querySelector('#st');
    p.querySelector('#imp').onsubmit=async function(e){e.preventDefault();var f=new FormData(this);try{var r=await api('POST','/admin/benchmarks/import',{csv:f.get('csv'),label:f.get('label')});msg(st,r.imported+' drafts imported.',true);render()}
      catch(err){var rows=(err.body&&err.body.error&&err.body.error.rows)||[];st.className='err';st.innerHTML=esc(err.message)+(rows.length?'<ul>'+rows.slice(0,50).map(function(x){return '<li>Row '+x.row+' · '+esc(x.field)+': '+esc(x.message)+'</li>'}).join('')+'</ul>':'')}};
    p.querySelectorAll('[data-validate]').forEach(function(b){b.onclick=async function(){var r=await api('POST','/admin/benchmarks/validate',{batch_id:b.getAttribute('data-validate')});if(r.valid){render()}else{p.querySelector('#detail').innerHTML='<h3>Problems</h3><ul>'+r.errors.map(function(x){return '<li class="err">Row '+x.row+' · '+esc(x.field)+': '+esc(x.message)+'</li>'}).join('')+'</ul>'}}});
    p.querySelectorAll('[data-publish]').forEach(function(b){b.onclick=async function(){if(!confirm('Publish this batch to every user in its regions?'))return;try{var r=await api('POST','/admin/benchmarks/publish',{batch_id:b.getAttribute('data-publish')});alert('Published '+r.published+', retired '+r.retired+'.');render()}catch(err){alert(err.message)}}});
    p.querySelectorAll('[data-rollback]').forEach(function(b){b.onclick=async function(){if(!confirm('Roll back this batch and restore the rates it replaced?'))return;await api('POST','/admin/benchmarks/rollback',{batch_id:b.getAttribute('data-rollback')});render()}});
    p.querySelectorAll('[data-view]').forEach(function(b){b.onclick=async function(){var rows=await api('GET','/admin/benchmarks?batch_id='+b.getAttribute('data-view'));p.querySelector('#detail').innerHTML='<h3>Rates</h3>'+table(rows,[['item_code','Item'],['country_code','Country'],['region_code','Region'],['currency','Cur'],['unit','Unit'],['net_unit_price','Net'],['tax_rate','Tax %'],['effective_date','From'],['valid_until','Until'],['source_name','Source'],['status','Status']])}});
  },
  sources:async function(p){
    var rows=await api('GET','/admin/sources');
    p.innerHTML='<h2>Rate sources</h2><p class="meta">Public web visibility is not permission to republish. Record the licence and mark a source publishable only when you hold the rights.</p>'+
      '<form id="f" class="support"><label>Source name<input name="source_name" required></label><label>Citation URL<input name="citation_url" type="url"></label><label>Obtained on<input name="obtained_at" type="date" required></label><label>Licence note<textarea name="licence_note" required></textarea></label><label style="display:flex;gap:8px;align-items:center;font-weight:500"><input type="checkbox" name="publishable" style="min-height:0"> We may republish these rates</label><button class="btn primary">Add source</button><p id="st"></p></form>'+
      table(rows,[['source_name','Name'],['obtained_at','Obtained'],['licence_note','Licence'],[function(r){return r.publishable?'Yes':'No'},'Publishable'],['id','Id']]);
    p.querySelector('#f').onsubmit=async function(e){e.preventDefault();var f=new FormData(this);try{await api('POST','/admin/sources',{source_name:f.get('source_name'),citation_url:f.get('citation_url')||null,obtained_at:f.get('obtained_at'),licence_note:f.get('licence_note'),publishable:f.get('publishable')==='on'});render()}catch(err){msg(p.querySelector('#st'),err.message,false)}};
  },
  regions:async function(p){
    var rows=await api('GET','/admin/regions');
    p.innerHTML='<h2>Regions</h2><p class="meta">List a region only once it has at least one validated, published source.</p>'+
      '<form id="f" class="support"><label>Country (2 letters)<input name="country_code" maxlength="2" required></label><label>Code<input name="code" required></label><label>Name<input name="name" required></label><button class="btn primary">Add region</button><p id="st"></p></form>'+
      table(rows,[['country_code','Country'],['code','Code'],['name','Name'],[function(r){return r.active?'Active':'Hidden'},'State'],[function(r){return '<button class="btn ghost" data-toggle="'+esc(r.id)+'" data-active="'+(r.active?'1':'0')+'">'+(r.active?'Hide':'Show')+'</button>'},'']]);
    p.querySelector('#f').onsubmit=async function(e){e.preventDefault();var f=new FormData(this);try{await api('POST','/admin/regions',{country_code:f.get('country_code'),code:f.get('code'),name:f.get('name')});render()}catch(err){msg(p.querySelector('#st'),err.message,false)}};
    p.querySelectorAll('[data-toggle]').forEach(function(b){b.onclick=async function(){await api('PATCH','/admin/regions/'+b.getAttribute('data-toggle'),{active:b.getAttribute('data-active')!=='1'});render()}});
  },
  support:async function(p){
    var rows=await api('GET','/admin/support');
    p.innerHTML='<h2>Support requests</h2>'+table(rows,[['created_at','Received'],['topic','Topic'],['email','Email'],['subject','Subject'],['message','Message'],['status','Status'],[function(r){return '<select data-status="'+esc(r.id)+'" data-version="'+r.version+'"><option'+(r.status==='open'?' selected':'')+'>open</option><option'+(r.status==='answered'?' selected':'')+'>answered</option><option'+(r.status==='closed'?' selected':'')+'>closed</option></select>'},'Set']]);
    p.querySelectorAll('[data-status]').forEach(function(s){s.onchange=async function(){try{await api('PATCH','/admin/support/'+s.getAttribute('data-status'),{status:s.value,expected_version:Number(s.getAttribute('data-version'))})}catch(err){alert(err.message)}render()}});
  },
  audit:async function(p){
    p.innerHTML='<h2>Audit</h2><form id="f" style="display:flex;gap:10px;flex-wrap:wrap;margin:14px 0"><input name="owner" placeholder="Owner user id"><input name="action" placeholder="Action prefix, e.g. cost."><select name="actor"><option value="">Any actor</option><option>user</option><option>admin</option><option>system</option></select><input name="from" type="date"><button class="btn primary">Search</button></form><div id="res"></div>';
    async function run(q){var rows=await api('GET','/admin/audit?'+q);p.querySelector('#res').innerHTML=table(rows,[['created_at','When'],['actor_type','Actor'],['action','Action'],['entity_type','Entity'],['summary','Summary'],['owner_user_id','Owner']])}
    p.querySelector('#f').onsubmit=function(e){e.preventDefault();var f=new FormData(this),q=new URLSearchParams();['owner','action','actor','from'].forEach(function(k){if(f.get(k))q.set(k,f.get(k))});run(q.toString())};
    run('');
  },
  subs:async function(p){
    p.innerHTML='<h2>Subscription diagnostics</h2><p class="meta">Entitlement state only. Project contents are never shown here.</p><form id="f" style="display:flex;gap:10px;margin:14px 0"><input name="uid" placeholder="User id" required style="flex:1"><button class="btn primary">Look up</button><button class="btn ghost" id="rc" type="button">Reconcile</button></form><pre id="res" style="white-space:pre-wrap;font-size:13px;background:var(--surface);padding:14px;border-radius:14px;border:1px solid var(--line)"></pre>';
    var f=p.querySelector('#f'),res=p.querySelector('#res');
    f.onsubmit=async function(e){e.preventDefault();try{res.textContent=JSON.stringify(await api('GET','/admin/subscriptions/'+encodeURIComponent(new FormData(f).get('uid'))),null,2)}catch(err){res.textContent=err.message}};
    p.querySelector('#rc').onclick=async function(){try{res.textContent=JSON.stringify(await api('POST','/admin/subscriptions/'+encodeURIComponent(new FormData(f).get('uid'))+'/reconcile',{}),null,2)}catch(err){res.textContent=err.message}};
  },
  jobs:async function(p){
    var d=await api('GET','/admin/jobs');
    p.innerHTML='<h2>Job health</h2>'+table(Object.keys(d.counts||{}).map(function(k){return {k:k.replace(/_/g,' '),v:d.counts[k]}}),[['k','Measure'],['v','Count']])+'<h3 style="margin-top:22px">Recent failures</h3>'+table(d.recent_failures,[['at','When'],['kind','Kind'],['error','Error'],['id','Id']]);
  },
  config:async function(p){
    var d=await api('GET','/admin/config');
    p.innerHTML='<h2>Configuration</h2><p class="meta">Never put secrets here. Default limits: '+esc(JSON.stringify(d.defaults.limits))+'</p>'+
      '<form id="f" class="support"><label>Key<input name="key" required placeholder="limits"></label><label>Value (JSON)<textarea name="value" required>{"ai_requests_per_30_days": 30}</textarea></label><label>Visibility<select name="visibility"><option>private</option><option>public</option></select></label><button class="btn primary">Save</button><p id="st"></p></form>'+
      table(d.entries,[['key','Key'],['value','Value'],['visibility','Visibility'],['version','Version'],['updated_at','Updated']]);
    p.querySelector('#f').onsubmit=async function(e){e.preventDefault();var f=new FormData(this),v;try{v=JSON.parse(f.get('value'))}catch(_){msg(p.querySelector('#st'),'Value must be JSON.',false);return}
      try{await api('PATCH','/admin/config',{key:f.get('key'),value:v,visibility:f.get('visibility')});render()}catch(err){msg(p.querySelector('#st'),err.message,false)}};
  }
};
if(token()){api('GET','/admin/jobs').then(render,login)}else login();
})();
`;
