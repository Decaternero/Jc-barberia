const express=require('express');
const session=require('express-session');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const app=express();
const PORT=process.env.PORT||10000;
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_KEY=process.env.SUPABASE_ANON_KEY||'';
const USERS=[
  {u:'admin',p:process.env.ADMIN_PASSWORD||'admin123',role:'admin',name:'Administrador'},
  {u:'barbero',p:process.env.BARBER_PASSWORD||'barbero123',role:'barbero',name:'Barbero'}
];
app.set('trust proxy',1);
app.use(express.json({limit:'6mb'}));
app.use(session({
  secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),
  resave:false,
  saveUninitialized:false,
  proxy:true,
  cookie:{httpOnly:true,sameSite:'lax',secure:true,maxAge:43200000}
}));
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:'No autenticado'});next()}
async function sb(pathname,options={}){
  if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error('Supabase no configurado');
  const r=await fetch(SUPABASE_URL+'/rest/v1/'+pathname,{
    ...options,
    headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json',...(options.headers||{})}
  });
  const text=await r.text();
  let body;
  try{body=text?JSON.parse(text):null}catch{body=text}
  if(!r.ok){const err=new Error('Supabase '+r.status);err.body=body;throw err}
  return body
}
app.get('/health',(req,res)=>res.json({ok:true,storage:!!(SUPABASE_URL&&SUPABASE_KEY)}));
app.post('/api/login',(req,res)=>{
  const {u,p}=req.body||{};
  const x=USERS.find(a=>a.u===String(u||'').trim()&&a.p===String(p||''));
  if(!x)return res.status(401).json({error:'Credenciales inválidas'});
  req.session.user={u:x.u,role:x.role,name:x.name};
  req.session.save(err=>{
    if(err)return res.status(500).json({error:'No se pudo iniciar sesión'});
    res.json(req.session.user)
  })
});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>req.session.user?res.json(req.session.user):res.status(401).json({error:'No autenticado'}));
app.get('/api/db',auth,async(req,res)=>{
  try{
    const rows=await sb('app_state?id=eq.1&select=data,updated_at');
    res.json(rows&&rows[0]?rows[0]:{data:{},updated_at:null})
  }catch(e){
    console.error('DB GET',e.body||e);
    res.status(500).json({error:'Error de base de datos'})
  }
});
app.post('/api/db',auth,async(req,res)=>{
  try{
    await sb('app_state?id=eq.1',{
      method:'PATCH',
      headers:{Prefer:'return=minimal'},
      body:JSON.stringify({data:req.body,updated_at:new Date().toISOString()})
    });
    res.json({ok:true})
  }catch(e){
    console.error('DB POST',e.body||e);
    res.status(500).json({error:'Error de base de datos'})
  }
});
function cloudify(html){
  html=html.replace(
    'const USERS=[{u:"admin",p:"admin123",role:"admin",name:"Administrador"},{u:"barbero",p:"barbero123",role:"barbero",name:"Barbero"}];',
    'const USERS=[];'
  );
  html=html.replace(
    'let db=load(),me=null,currentView="dashboard";',
    'let db=load(),me=null,currentView="dashboard";let cloudSyncTimer=null,cloudApplying=false,cloudLastSnapshot="",cloudSyncBusy=false,cloudSavePending=false,cloudSaveBusy=false;'
  );
  const oldLoad='function load(){try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}}\\nlet saving=false;\\nfunction save(){if(saving)return false;saving=true;try{localStorage.setItem(KEY,JSON.stringify(db));return true}finally{saving=false}}';
  const newLoad='function load(){try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}}\nfunction save(){localStorage.setItem(KEY,JSON.stringify(db));if(me&&!cloudApplying){cloudSavePending=true;cloudSave()}}\nasync function cloudGet(){const r=await fetch("/api/db",{credentials:"include",cache:"no-store"});if(!r.ok)throw new Error("db");return r.json()}\nasync function cloudSave(){if(cloudSaveBusy)return;cloudSaveBusy=true;try{while(cloudSavePending){cloudSavePending=false;const snapshot=JSON.stringify(db);if(snapshot===cloudLastSnapshot)continue;const r=await fetch("/api/db",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:snapshot});if(!r.ok)throw new Error("db save");cloudLastSnapshot=snapshot}}catch(e){console.error(e);cloudSavePending=true}finally{cloudSaveBusy=false}}\nasync function syncFromCloud(){if(cloudSyncBusy||cloudApplying||cloudSaveBusy||cloudSavePending)return;cloudSyncBusy=true;try{const c=await cloudGet(),d=c.data;if(d&&typeof d==="object"&&Object.keys(d).length){const incoming=JSON.stringify(d);if(incoming!==cloudLastSnapshot&&incoming!==JSON.stringify(db)){cloudApplying=true;db=d;localStorage.setItem(KEY,JSON.stringify(db));cloudLastSnapshot=incoming;cloudApplying=false;render(currentView)}}}catch(e){console.error(e)}finally{cloudSyncBusy=false}}\nfunction startCloudSync(){clearInterval(cloudSyncTimer);syncFromCloud();cloudSyncTimer=setInterval(syncFromCloud,1000)}';
  html=html.replace(oldLoad,newLoad);
  return html;
}
const authScript='<script>window.login=async function(){const u=document.getElementById("lu").value.trim(),p=document.getElementById("lp").value;try{const r=await fetch("/api/login",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({u,p})});const x=await r.json();if(!r.ok)throw new Error(x.error||"Credenciales inválidas");me=x;sessionStorage.setItem("JC_USER",JSON.stringify(x));document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("user").textContent=x.name+" · "+x.role;renderAll();startCloudSync()}catch(e){document.getElementById("le").textContent=e.message}};window.addEventListener("load",async function(){try{const r=await fetch("/api/me",{credentials:"include",cache:"no-store"});if(r.ok){me=await r.json();sessionStorage.setItem("JC_USER",JSON.stringify(me));document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("user").textContent=me.name+" · "+me.role;renderAll();startCloudSync()}}catch(e){console.error(e)}});</script>';

app.get('/',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    const html=cloudify(fs.readFileSync(p,'utf8'))+authScript;
    res.type('html').send(html)
  }catch(e){
    console.error(e);
    res.status(500).send('Error cargando JC Barbería')
  }
});
app.get('/JC_Barberia_Actualizada_Productos_Stock.html',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    res.type('html').send(cloudify(fs.readFileSync(p,'utf8')))
  }catch(e){res.status(500).send('Error cargando JC Barbería')}
});
app.use(express.static(path.join(__dirname)));
app.listen(PORT,()=>console.log('JC Barbería en puerto '+PORT));