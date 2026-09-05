const express=require('express');
const session=require('express-session');
const path=require('path');
const crypto=require('crypto');
const app=express();
const PORT=process.env.PORT||10000;
const SUPABASE_URL=(process.env.SUPABASE_URL||'').replace(/\/$/,'');
const SUPABASE_KEY=process.env.SUPABASE_ANON_KEY||'';
const USERS=[{u:'admin',p:process.env.ADMIN_PASSWORD||'admin123',role:'admin',name:'Administrador'},{u:'barbero',p:process.env.BARBER_PASSWORD||'barbero123',role:'barbero',name:'Barbero'}];
app.use(express.json({limit:'4mb'}));
app.use(session({secret:process.env.SESSION_SECRET||crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:43200000}}));
function auth(req,res,next){if(!req.session.user)return res.status(401).json({error:'No autenticado'});next()}
async function sb(pathname,options={}){if(!SUPABASE_URL||!SUPABASE_KEY)throw new Error('Supabase no configurado');const r=await fetch(SUPABASE_URL+'/rest/v1/'+pathname,{...options,headers:{apikey:SUPABASE_KEY,Authorization:'Bearer '+SUPABASE_KEY,'Content-Type':'application/json',...(options.headers||{})}});const text=await r.text();let body;try{body=text?JSON.parse(text):null}catch{body=text}if(!r.ok){const err=new Error('Supabase '+r.status);err.body=body;throw err}return body}
app.post('/api/login',(req,res)=>{const {u,p}=req.body||{};const x=USERS.find(a=>a.u===String(u||'').trim()&&a.p===String(p||''));if(!x)return res.status(401).json({error:'Credenciales inválidas'});req.session.user={u:x.u,role:x.role,name:x.name};res.json(req.session.user)});
app.post('/api/logout',(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get('/api/me',(req,res)=>req.session.user?res.json(req.session.user):res.status(401).json({error:'No autenticado'}));
app.get('/api/db',auth,async(req,res)=>{try{const rows=await sb('app_state?id=eq.1&select=data,updated_at');res.json(rows?.[0]||{data:{},updated_at:null})}catch(e){console.error(e.body||e);res.status(500).json({error:'Error de base de datos'})}});
app.post('/api/db',auth,async(req,res)=>{try{await sb('app_state?id=eq.1',{method:'PATCH',headers:{Prefer:'return=minimal'},body:JSON.stringify({data:req.body,updated_at:new Date().toISOString()})});res.json({ok:true})}catch(e){console.error(e.body||e);res.status(500).json({error:'Error de base de datos'})}});
app.get('/health',(req,res)=>res.json({ok:true,storage:!!(SUPABASE_URL&&SUPABASE_KEY)}));
app.use(express.static(path.join(__dirname)));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
app.listen(PORT,()=>console.log('JC Barbería en puerto '+PORT));
