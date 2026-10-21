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
  const oldLoad='function load(){try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}}\nlet saving=false;\nfunction save(){if(saving)return false;saving=true;try{localStorage.setItem(KEY,JSON.stringify(db));return true}finally{saving=false}}';
  const newLoad='function load(){try{return JSON.parse(localStorage.getItem(KEY))||fresh()}catch(e){return fresh()}}\nfunction save(){localStorage.setItem(KEY,JSON.stringify(db));if(me&&!cloudApplying){cloudSavePending=true;cloudSave()}}\nasync function cloudGet(){const r=await fetch("/api/db",{credentials:"include",cache:"no-store"});if(!r.ok)throw new Error("db");return r.json()}\nasync function cloudSave(){if(cloudSaveBusy)return;cloudSaveBusy=true;try{while(cloudSavePending){cloudSavePending=false;const snapshot=JSON.stringify(db);if(snapshot===cloudLastSnapshot)continue;const r=await fetch("/api/db",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:snapshot});if(!r.ok)throw new Error("db save");cloudLastSnapshot=snapshot}}catch(e){console.error(e);cloudSavePending=true}finally{cloudSaveBusy=false}}\nasync function syncFromCloud(){if(cloudSyncBusy||cloudApplying||cloudSaveBusy||cloudSavePending)return;cloudSyncBusy=true;try{const c=await cloudGet(),d=c.data;if(d&&typeof d==="object"&&Object.keys(d).length){const incoming=JSON.stringify(d);if(incoming!==cloudLastSnapshot&&incoming!==JSON.stringify(db)){cloudApplying=true;db=d;localStorage.setItem(KEY,JSON.stringify(db));cloudLastSnapshot=incoming;cloudApplying=false;render(currentView)}}}catch(e){console.error(e)}finally{cloudSyncBusy=false}}\nfunction startCloudSync(){clearInterval(cloudSyncTimer);syncFromCloud();cloudSyncTimer=setInterval(syncFromCloud,1000)}';
  html=html.replace(oldLoad,newLoad);
  return html;
}
const receiptScript="<script>\n(function(){\n function num(s){var a=(db.sales||[]).slice().sort(function(x,y){return String(x.date||\"\").localeCompare(String(y.date||\"\"))||String(x.id||\"\").localeCompare(String(y.id||\"\"))});return String(a.findIndex(function(x){return x.id===s.id})+1).padStart(6,\"0\")}\n function markup(s){\n  var client=(s.clientQuick||\"\").trim()||(s.clientId?((db.clients.find(function(c){return c.id===s.clientId})||{}).name||\"Cliente\"):\"Cliente ocasional\");\n  return '<div class=\"jc-ticket\"><div class=\"jc-center jc-title\">JC BARBERÍA</div><div class=\"jc-center\">COMPROBANTE DE SERVICIO</div><div class=\"jc-rule\"></div><div><b>N.º:</b> '+num(s)+'</div><div><b>Fecha:</b> '+e(s.date||today())+'</div><div><b>Hora:</b> '+e(s.createdAt||\"\")+'</div><div><b>Cliente:</b> '+e(client)+'</div><div><b>Atendió:</b> '+e(bname(s.barberId))+'</div><div class=\"jc-rule\"></div><div class=\"jc-line\"><span>'+e(s.detail||\"Servicio\")+(s.kind===\"product\"&&s.qty>1?\" x\"+s.qty:\"\")+'</span><span>'+money(s.total)+'</span></div><div class=\"jc-rule\"></div><div class=\"jc-line jc-total\"><span>TOTAL</span><span>'+money(s.total)+'</span></div><div class=\"jc-line\"><span>Pago</span><span>'+e(s.pay||\"—\")+'</span></div><div class=\"jc-rule\"></div><div class=\"jc-center\">¡Gracias por tu preferencia!</div><div class=\"jc-center\">Te esperamos pronto.</div><div class=\"jc-center jc-muted\" style=\"margin-top:8px\">Comprobante interno, no válido como comprobante electrónico SUNAT.</div></div>';\n }\n window.jcReceipt=function(id){var s=(db.sales||[]).find(function(x){return x.id===id});if(!s||s.annulled)return alert(\"No se puede generar boleta para una venta anulada.\");openModal(\"Vista previa de boleta\",markup(s)+'<div class=\"toolbar\" style=\"margin-top:12px\"><button onclick=\"jcPrintReceipt(&quot;'+s.id+'&quot;)\">🖨️ Imprimir / Guardar PDF</button><button class=\"secondary\" onclick=\"closeModal()\">No imprimir · Cerrar</button></div><p class=\"muted\">Puedes cerrar sin imprimir. La venta no se registra otra vez.</p>')};\n window.jcPrintReceipt=function(id){var s=(db.sales||[]).find(function(x){return x.id===id});if(!s||s.annulled)return alert(\"No se puede imprimir una venta anulada.\");var w=window.open(\"\",\"_blank\",\"width=420,height=700\");if(!w)return alert(\"Permite ventanas emergentes para imprimir la boleta.\");w.document.open();w.document.write('<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Boleta JC Barbería</title><style>*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#111;margin:0;padding:10px}.jc-ticket{width:100%;max-width:300px;margin:0 auto}.jc-center{text-align:center;margin:4px 0}.jc-title{font-size:20px;font-weight:900;letter-spacing:1px}.jc-rule{border-top:1px dashed #222;margin:9px 0}.jc-line{display:flex;justify-content:space-between;gap:10px;margin:6px 0}.jc-total{font-size:16px;font-weight:900}.jc-muted{font-size:9px;color:#555}.actions{text-align:center;margin:15px 0}@media print{body{padding:0}.actions{display:none}@page{margin:3mm;size:80mm auto}}</style></head><body>'+markup(s)+'<div class=\"actions\"><button onclick=\"window.print()\">Imprimir / Guardar PDF</button><button onclick=\"window.close()\">No imprimir · Cerrar</button><p>Elige tu impresora o “Guardar como PDF”.</p></div></body></html>');w.document.close();w.focus()};\n var original=window.sales;if(typeof original===\"function\"){window.sales=function(){original();try{var month=window.salesMonth||today().slice(0,7),list=(db.sales||[]).filter(function(s){return String(s.date||\"\").startsWith(month)}).slice().reverse(),rows=document.querySelectorAll(\"#ventas tbody tr\");rows.forEach(function(row,i){var s=list[i],cells=row.querySelectorAll(\"td\");if(!s||s.annulled||!cells.length||row.querySelector(\".jc-receipt-btn\"))return;var btn=document.createElement(\"button\");btn.className=\"small secondary jc-receipt-btn\";btn.textContent=\"🧾 Boleta\";btn.style.margin=\"2px\";btn.onclick=function(){jcReceipt(s.id)};cells[cells.length-1].appendChild(btn)})}catch(err){console.error(\"JC boletas\",err)}}}\n var style=document.createElement(\"style\");style.textContent=\".jc-ticket{background:#fff;color:#111;padding:16px;border-radius:8px;font:12px Arial,sans-serif;max-width:320px;margin:0 auto}.jc-center{text-align:center;margin:4px 0}.jc-title{font-size:20px;font-weight:900;letter-spacing:1px}.jc-rule{border-top:1px dashed #222;margin:9px 0}.jc-line{display:flex;justify-content:space-between;gap:10px;margin:6px 0}.jc-total{font-size:16px;font-weight:900}.jc-muted{font-size:9px;color:#555}\";document.head.appendChild(style);\n})();\n</script>";
const authScript='<script>window.login=async function(){const u=document.getElementById("lu").value.trim(),p=document.getElementById("lp").value;try{const r=await fetch("/api/login",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({u,p})});const x=await r.json();if(!r.ok)throw new Error(x.error||"Credenciales inválidas");me=x;sessionStorage.setItem("JC_USER",JSON.stringify(x));document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("user").textContent=x.name+" · "+x.role;renderAll();startCloudSync()}catch(e){document.getElementById("le").textContent=e.message}};window.addEventListener("load",async function(){try{const r=await fetch("/api/me",{credentials:"include",cache:"no-store"});if(r.ok){me=await r.json();sessionStorage.setItem("JC_USER",JSON.stringify(me));document.getElementById("login").style.display="none";document.getElementById("app").style.display="block";document.getElementById("user").textContent=me.name+" · "+me.role;renderAll();startCloudSync()}}catch(e){console.error(e)}});</script>';

app.get('/',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    const html=cloudify(fs.readFileSync(p,'utf8')).replace('</body>',receiptScript+'</body>')+authScript;
    res.type('html').send(html)
  }catch(e){
    console.error(e);
    res.status(500).send('Error cargando JC Barbería')
  }
});
app.get('/JC_Barberia_Actualizada_Productos_Stock.html',(req,res)=>{
  try{
    const p=path.join(__dirname,'JC_Barberia_Actualizada_Productos_Stock.html');
    res.type('html').send(cloudify(fs.readFileSync(p,'utf8')).replace('</body>',receiptScript+'</body>'))
  }catch(e){res.status(500).send('Error cargando JC Barbería')}
});
app.use(express.static(path.join(__dirname)));
app.listen(PORT,()=>console.log('JC Barbería en puerto '+PORT));