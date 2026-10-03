const express=require('express');
const session=require('express-session');
const path=require('path');
const fs=require('fs');
const crypto=require('crypto');
const {Pool}=require('pg');

const app=express();
const PORT=process.env.PORT||10000;
const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_URL ? {rejectUnauthorized:false}:false,
  max:5,
  idleTimeoutMillis:30000
});

const USERS=[
  {u:'admin',p:process.env.ADMIN_PASSWORD||'admin123',role:'admin',name:'Administrador'},
  {u:'barbero',p:process.env.BARBER_PASSWORD||'barbero123',role:'barbero',name:'Barbero'}
];

app.set('trust proxy',1);
app.use(express.json({limit:'10mb'}));
app.use(session({
  secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),
  resave:false,
  saveUninitialized:false,
  proxy:true,
  cookie:{httpOnly:true,sameSite:'lax',secure:true,maxAge:43200000}
}));

function auth(req,res,next){
  if(!req.session.user)return res.status(401).json({error:'No autenticado'});
  next();
}

async function initDb(){
  if(!process.env.DATABASE_URL){
    console.warn('DATABASE_URL no configurada');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state(
      id INTEGER PRIMARY KEY CHECK(id=1),
      data JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO app_state(id,data)
    VALUES(1,'{}'::jsonb)
    ON CONFLICT(id) DO NOTHING
  `);
  console.log('PostgreSQL conectado y app_state lista');
}

app.get('/health',async(req,res)=>{
  try{
    if(!process.env.DATABASE_URL)return res.status(500).json({ok:false,storage:false,error:'DATABASE_URL no configurada'});
    await pool.query('SELECT 1');
    res.json({ok:true,storage:'postgres'});
  }catch(e){
    console.error('HEALTH',e);
    res.status(500).json({ok:false,storage:false,error:'Base de datos no disponible'});
  }
});

app.post('/api/login',(req,res)=>{
  const {u,p}=req.body||{};
  const x=USERS.find(a=>a.u===String(u||'').trim()&&a.p===String(p||''));
  if(!x)return res.status(401).json({error:'Credenciales inválidas'});
  req.session.user={u:x.u,role:x.role,name:x.name};
  req.session.save(err=>{
    if(err)return res.status(500).json({error:'No se pudo iniciar sesión'});
    res.json(req.session.user);
  });
});

app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>req.session.user?res.json(req.session.user):res.status(401).json({error:'No autenticado'}));

app.get('/api/db',auth,async(req,res)=>{
  try{
    const r=await pool.query('SELECT data,updated_at FROM app_state WHERE id=1');
    res.json(r.rows[0]||{data:{},updated_at:null});
  }catch(e){
    console.error('DB GET',e);
    res.status(500).json({error:'Error de base de datos'});
  }
});

app.post('/api/db',auth,async(req,res)=>{
  try{
    const data=req.body;
    if(!data||typeof data!=='object'||Array.isArray(data))
      return res.status(400).json({error:'Datos inválidos'});
    await pool.query(
      'INSERT INTO app_state(id,data,updated_at) VALUES(1,$1::jsonb,NOW()) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()',
      [JSON.stringify(data)]
    );
    res.json({ok:true});
  }catch(e){
    console.error('DB POST',e);
    res.status(500).json({error:'Error de base de datos'});
  }
});

function cloudify(html){
  const start=html.indexOf('<script>');
  const end=html.lastIndexOf('</script>');
  if(start<0||end<start)return html;

  let script=html.slice(start+8,end);

  script=script.replace(
    /const USERS=\[\{u:"admin",p:"admin123",role:"admin",name:"Administrador"\},\{u:"barbero",p:"barbero123",role:"barbero",name:"Barbero"\}\];/,
    'const USERS=[];'
  );

  script=script.replace(
    /function load\(\)\{try\{return JSON\.parse\(localStorage\.getItem\(KEY\)\)\|\|fresh\(\)\}catch\(e\)\{return fresh\(\)\}\}\nlet saving=false;\nfunction save\(\)\{if\(saving\)return false;saving=true;try\{localStorage\.setItem\(KEY,JSON\.stringify\(db\)\);return true\}finally\{saving=false\}\}/,
`function load(){try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}}
let saving=false,cloudSaving=false,cloudPending=false,cloudTimer=null,cloudApplying=false,cloudLast="";
function save(){
  localStorage.setItem(KEY,JSON.stringify(db));
  if(me&&!cloudApplying){cloudPending=true;cloudSave();}
  return true;
}
async function cloudGet(){
  const r=await fetch("/api/db",{credentials:"include",cache:"no-store"});
  if(!r.ok)throw new Error("No se pudo leer la base de datos");
  return r.json();
}
async function cloudSave(){
  if(cloudSaving)return;
  cloudSaving=true;
  try{
    while(cloudPending){
      cloudPending=false;
      const snapshot=JSON.stringify(db);
      if(snapshot===cloudLast)continue;
      const r=await fetch("/api/db",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:snapshot});
      if(!r.ok)throw new Error("No se pudo guardar la base de datos");
      cloudLast=snapshot;
    }
  }catch(e){
    console.error("Cloud save",e);
    cloudPending=true;
  }finally{cloudSaving=false;}
}
async function syncFromCloud(){
  if(!me||cloudApplying||cloudSaving||cloudPending)return;
  try{
    const remote=await cloudGet();
    const incoming=JSON.stringify(remote.data||{});
    if(!incoming||incoming==="{}")return;
    const local=JSON.stringify(db);
    if(incoming!==cloudLast&&incoming!==local){
      cloudApplying=true;
      db=remote.data;
      localStorage.setItem(KEY,incoming);
      cloudLast=incoming;
      cloudApplying=false;
      renderAll();
    }else if(incoming===local){
      cloudLast=incoming;
    }
  }catch(e){console.error("Cloud sync",e);}
}
function startCloudSync(){
  clearInterval(cloudTimer);
  syncFromCloud();
  cloudTimer=setInterval(syncFromCloud,1500);
}`
  );

  script=script.replace(
    /function login\(\)\{[\s\S]*?\n\}/,
`async function login(){
  const u=val("lu").trim(),p=val("lp");
  document.getElementById("le").textContent="Ingresando...";
  try{
    const r=await fetch("/api/login",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({u,p})});
    const x=await r.json();
    if(!r.ok)throw new Error(x.error||"Credenciales inválidas");
    me=x;
    document.getElementById("login").style.display="none";
    document.getElementById("app").style.display="block";
    document.getElementById("user").textContent=x.name+" · "+x.role;
    try{
      const remote=await cloudGet();
      if(remote.data&&Object.keys(remote.data).length){
        db=remote.data;
        localStorage.setItem(KEY,JSON.stringify(db));
        cloudLast=JSON.stringify(db);
      }else{
        cloudLast="";
        await cloudSave();
      }
    }catch(e){
      document.getElementById("le").textContent="No se pudo conectar con la base de datos";
      return;
    }
    renderAll();
    startCloudSync();
  }catch(e){
    document.getElementById("le").textContent=e.message||"No se pudo iniciar sesión";
  }
}`
  );

  script=script.replace(
    /sessionStorage\.removeItem\("JC_USER"\);\nme=null;\ndocument\.getElementById\("login"\)\.style\.display="grid";document\.getElementById\("app"\)\.style\.display="none";/,
    ''
  );

  const cloudBoot=`
<script>
window.addEventListener("load",async()=>{
  try{
    const r=await fetch("/api/me",{credentials:"include",cache:"no-store"});
    if(!r.ok)return;
    me=await r.json();
    const remote=await cloudGet();
    if(remote.data&&Object.keys(remote.data).length){
      db=remote.data;
      localStorage.setItem(KEY,JSON.stringify(db));
      cloudLast=JSON.stringify(db);
    }
    document.getElementById("login").style.display="none";
    document.getElementById("app").style.display="block";
    document.getElementById("user").textContent=me.name+" · "+me.role;
    renderAll();
    startCloudSync();
  }catch(e){console.error("Cloud boot",e);}
});
</script>`;

  return html.slice(0,start+8)+script+'</script>'+cloudBoot+html.slice(end+9);
}

app.get('/',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    res.type('html').send(cloudify(fs.readFileSync(p,'utf8')));
  }catch(e){console.error(e);res.status(500).send('Error cargando JC Barbería');}
});

app.get('/JC_Barberia_Actualizada_Productos_Stock.html',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    res.type('html').send(cloudify(fs.readFileSync(p,'utf8')));
  }catch(e){res.status(500).send('Error cargando JC Barbería');}
});

app.use(express.static(path.join(__dirname)));

initDb().then(()=>{
  app.listen(PORT,'0.0.0.0',()=>console.log('JC Barbería en puerto '+PORT));
}).catch(e=>{
  console.error('No se pudo inicializar PostgreSQL',e);
  app.listen(PORT,'0.0.0.0',()=>console.log('JC Barbería iniciado sin DB; revise DATABASE_URL'));
});
