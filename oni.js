// 鬼ごっこ（リアルタイム版ミニゲーム）の画面と進行。
// 自分の位置は自分の端末で動かして1秒に約8回送り、他の人の位置は少し遅らせてなめらかに見せる。
// 捕まった・拾った・出口・時間切れの判定は、ホストの端末だけが行う。
import {ref,set,update,onValue,isLocal} from './fb.js';
import * as RT from './onirt.js';
import MET from './onimeta.js';
const {N,EXIT,TIME,ODDS}=RT;
const esc=t=>String(t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr=v=>Array.isArray(v)?v:v&&typeof v==='object'?Object.values(v):[];
const r2=v=>Math.round(v*100)/100;
// A（ビールを持つ男の人）は子ども向けでは使わない
const CHR=['B','F','M','Y','S'],RUN=['run1','run2','run2b','run3','run4'];
// 名前ごとのキャラ（絵の割り当て）。ここにない名前は、入った順に割り当てる
const NAME_CHR={'ぱぱ':'M','まま':'F','ユナモン':'S','あーちゃん':'B'};
const ST=0.0105,SEND_MS=120,LAG_MS=130,BOOST_MS=RT.BOOST_T*1000,FREEZE_MS=RT.FREEZE_T*1000;
export function attachOni({db,roomId,uid,players,hostUid,message,root:given,auto=false}){
 const K=globalThis.__nqClock||{now:()=>performance.now(),setInterval:(f,ms)=>setInterval(f,ms),clearInterval:i=>clearInterval(i),setTimeout:(f,ms)=>setTimeout(f,ms),clearTimeout:i=>clearTimeout(i)};
 const root=given||document.getElementById('tenGame'),host=uid===hostUid,base=`oni/${roomId}`;
 const dom=!globalThis.__nqOniHeadless&&typeof root?.querySelector==='function'&&typeof document!=='undefined';
 const sorted=[...players].sort((a,b)=>Number(a.slot)-Number(b.slot)),uids=sorted.map(p=>p.uid);
 const names=Object.fromEntries(players.map(p=>[p.uid,p.name])),slotOf=Object.fromEntries(players.map(p=>[p.uid,Number(p.slot)]));
 const npcSet=new Set(isLocal?uids.filter(u=>u.startsWith('npc')):[]);
 const nm=u=>names[u]||'確認中';
 const charOf=(id,i)=>NAME_CHR[nm(id)]||CHR[(slotOf[id]??i)%CHR.length];
 let autoG=null,state=null,choice=null,dead=false,lastPhase=null,lastG=null,phaseAt=0,stops=[],timers=[],raf=0,loopId=0;
 const T=(fn,ms)=>{const t=K.setTimeout(()=>{if(!dead)fn();},ms);timers.push(t);return t;};
 // ---- 位置 ----
 const buf={},starts=()=>state?RT.startsFor(uids,state.oni):{};
 const mine={x:3.5,y:6.5,inited:false,sentAt:-1e9,sx:-1,sy:-1,vx:0,vy:0};
 const joy={x:0,y:0,active:false,ox:0,oy:0},keys={};
 let playStart=0,endShown=false,lastCatchAt=-1e9,prevSt={},auto_lm=null,loopLast=0;
 const walls=()=>arr(state?.w).map(arr);
 const role=()=>state?.oni===uid?'oni':'run';
 function posOf(id,delay=LAG_MS){
  if(id===uid)return [mine.x,mine.y];
  const b=buf[id];
  if(!b||!b.length){const s=starts()[id];return s?[s[0],s[1]]:null;}
  const t=K.now()-delay;
  for(let i=b.length-1;i>=0;i--)if(b[i].t<=t){const a=b[i],c=b[i+1];if(!c)return [a.x,a.y];const k=(t-a.t)/Math.max(1,c.t-a.t);return [a.x+(c.x-a.x)*k,a.y+(c.y-a.y)*k];}
  return [b[0].x,b[0].y];
 }
 const latest=id=>{if(id===uid)return [mine.x,mine.y];const b=buf[id];return b?.length?[b[b.length-1].x,b[b.length-1].y]:(starts()[id]||null);};
 // ---- ホスト：ゲームの準備と進行 ----
 let model=null,hostSim=0,advancing=false,hostKey=null,pub={},lastNpcPub=0,simLast=0;
 function freshState(g){
  const oni=RT.pickOni(uids),st0=RT.startsFor(uids,oni),w=RT.makeWalls(Math.random,st0);
  return {g,phase:'choose',oni,buff:'none',w,st:Object.fromEntries(uids.map(u=>[u,u===oni?'oni':'run'])),lg:[]};
 }
 const pushState=patch=>update(ref(db,base+'/state'),patch).catch(()=>message('ゲームの状態を送れませんでした。'));
 async function hostStart(){
  await update(ref(db,base),{state:freshState(1)}).catch(()=>message('ゲーム接続ルールの反映が必要です。'));
 }
 async function again(){
  const g=(state?.g||0)+1;
  await set(ref(db,base+'/choice'),null).catch(()=>{});
  await set(ref(db,base+'/net'),null).catch(()=>{});
  await set(ref(db,base+'/pos'),null).catch(()=>{});
  await set(ref(db,base+'/state'),freshState(g)).catch(()=>message('もう一度を始められませんでした。'));
 }
 function goCount(){
  const s=state;if(!s)return;
  const w=arr(s.w).map(arr);
  model=RT.createModel({walls:w,uids,oni:s.oni,buff:s.buff,starts:RT.startsFor(uids,s.oni),npcs:[...npcSet]});
  const patch={phase:'count',buff:s.buff};
  const posPatch={};for(const e of Object.values(model.ents))if(e.npc)posPatch[e.id]={x:r2(e.x),y:r2(e.y)};
  const go=()=>{pushState(patch).then(()=>T(startSim,2400));};
  if(Object.keys(posPatch).length)update(ref(db,base+'/pos'),posPatch).catch(()=>{}).then(go);else go();
 }
 function startSim(){
  if(dead||!model)return;
  model.t=0;model.wait=model.buff==='rocket'?0:RT.WAIT;pub={hold:model.wait>0?'wait':null,st:JSON.stringify(Object.fromEntries(uids.map(u=>[u,u===model.oniId?'oni':'run']))),lg:'[]',fz:0};
  pushState({phase:'play',hold:model.wait>0?'wait':null});
  simLast=K.now();lastNpcPub=0;
  hostSim=K.setInterval(simStep,33);
 }
 function simStep(){
  if(dead||!model||model.over||state?.phase!=='play')return;
  const now=K.now(),dt=Math.min(0.1,(now-simLast)/1000);simLast=now;
  for(const e of Object.values(model.ents)){if(e.npc)continue;const p=latest(e.id);if(p){e.x=p[0];e.y=p[1];}}
  RT.advanceClock(model,dt);RT.stepNpcs(model,dt);RT.judge(model,names);
  const patch={};
  const hold=model.hold||null;if(hold!==pub.hold){patch.hold=hold;pub.hold=hold;}
  const st=JSON.stringify(Object.fromEntries(Object.values(model.ents).map(e=>[e.id,e.st])));
  if(st!==pub.st){for(const e of Object.values(model.ents))patch['st/'+e.id]=e.st;pub.st=st;}
  if(model.fz&&!pub.fz){pub.fz=1;patch.fz={u:model.fz.u,k:Date.now()};}
  const lg=JSON.stringify(model.log);if(lg!==pub.lg){patch.lg=[...model.log];pub.lg=lg;}
  if(model.over){patch.phase='end';patch.why=model.why;K.clearInterval(hostSim);hostSim=0;}
  if(Object.keys(patch).length)pushState(patch);
  if(now-lastNpcPub>=SEND_MS||model.over){lastNpcPub=now;const pp={};for(const e of Object.values(model.ents))if((e.npc||e.role==='ally')&&(e.role!=='run'||e.st==='run'))pp[e.id]={x:r2(e.x),y:r2(e.y)};if(Object.keys(pp).length)update(ref(db,base+'/pos'),pp).catch(()=>{});}
 }
 let autoSpinG=null;
 function hostTick(){
  if(dead||!host||!state||advancing)return;
  const s=state;
  if(s.phase==='choose'){
   if(!choice){if(autoSpinG!==s.g){autoSpinG=s.g;T(()=>{if(!choice&&state?.phase==='choose')set(ref(db,base+'/choice'),'spin').catch(()=>{});},7000);}return;}
   advancing=true;
   const kind=RT.rollRoulette();pushState({rolled:kind,buff:kind,phase:'rolled'}).then(()=>T(goCount,4200));
  }
 }
 // ---- 自分の動き ----
 const holdNow=()=>state?.hold||null;
 let boostUntil=0,netUsed=0,netShowUntil=0,lastNetAt=0,fzUid=null,fzUntil=0,lastFzK=0;
 const boosting=()=>K.now()<boostUntil,frozenNow=id=>id===fzUid&&K.now()<fzUntil;
 const netAllowed=()=>1+(state?.buff==='net2'?1:0);
 function canMove(){
  if(!state||state.phase!=='play')return false;
  if(role()==='oni')return !holdNow();
  return state.st?.[uid]==='run'&&!frozenNow(uid);
 }
 function sendPos(force=false){
  const now=K.now();
  if(!force&&now-mine.sentAt<SEND_MS)return;
  const x=r2(mine.x),y=r2(mine.y);
  if(!force&&x===mine.sx&&y===mine.sy&&now-mine.sentAt<1500)return;
  mine.sentAt=now;mine.sx=x;mine.sy=y;
  set(ref(db,`${base}/pos/${uid}`),{x,y}).catch(()=>{});
 }
 function autopilot(dt){
  const s=state,w=walls();
  if(!auto_lm||auto_lm.g!==s.g){const st0=RT.startsFor(uids,s.oni);auto_lm=RT.createModel({walls:w,uids,oni:s.oni,buff:s.buff,starts:st0,rand:Math.random});auto_lm.g=s.g;}
  const m=auto_lm;m.buff=s.buff;m.hold=holdNow();
  for(const id of Object.keys(m.ents)){const p=latest(id);if(p){m.ents[id].x=p[0];m.ents[id].y=p[1];}m.ents[id].st=s.st?.[id]||m.ents[id].st;}
  const e=m.ents[uid];e.x=mine.x;e.y=mine.y;
  if(role()==='oni')RT.steerChaser(m,e,dt,RT.speedFor('oni',s.buff,uids.length,boosting()));else RT.steerRunner(m,e,dt);
  mine.x=e.x;mine.y=e.y;
 }
 function frame(dt){
  if(!state)return;
  if(!mine.inited&&state.w){const s=starts()[uid];if(s){mine.x=s[0];mine.y=s[1];mine.inited=true;}}
  if(state.phase==='count'&&!mine.sentCount){mine.sentCount=true;sendPos(true);}
  if(state.phase==='play'&&canMove()){
   if(auto)autopilot(dt);
   else{
    let vx=joy.x,vy=joy.y;
    if(keys.ArrowLeft||keys.a)vx-=1;if(keys.ArrowRight||keys.d)vx+=1;if(keys.ArrowUp||keys.w)vy-=1;if(keys.ArrowDown||keys.s)vy+=1;
    const m=Math.hypot(vx,vy);if(m>1){vx/=m;vy/=m;}
    const sp=RT.speedFor(role(),state.buff,uids.length,boosting())*dt;RT.moveBody(walls(),mine,vx*sp,vy*sp);
   }
   sendPos();
  }
 }
 // ---- 描画 ----
 let cv=null,ATL=null;
 function spr(c,name,x,y,fl,tilt,sc=1){const m=MET[name];if(!m||!ATL?.complete)return;const k=ST*sc,dw=m[2]*k,dh=m[3]*k;c.save();c.translate(x,y+0.46);if(tilt)c.rotate(tilt);c.scale(fl,1);c.drawImage(ATL,m[0],m[1],m[2],m[3],-dw/2,-dh+4*k,dw,dh);c.restore();}
 const face={};
 function person(c,id,x,y,i,kind){
  const t=K.now()/1000,f0=face[id]||(face[id]={lx:x,ly:y,mv:-9,f:1}),dx=x-f0.lx;
  if(Math.hypot(dx,y-f0.ly)>0.002){f0.mv=t;if(Math.abs(dx)>0.001)f0.f=dx>0?1:-1;}
  f0.lx=x;f0.ly=y;const walking=t-f0.mv<0.15,f=f0.f,bob=walking?Math.abs(Math.sin(t*14))*0.04:Math.sin(t*3+i)*0.01,tilt=walking?Math.sin(t*14)*0.05:0;
  const st=state.st?.[id];
  c.fillStyle='#0007';c.beginPath();c.ellipse(x,y+0.47,kind==='boss'?.3:kind==='ko'?.2:.2,.07,0,0,7);c.fill();
  if(kind==='boss'){const frz=K.now()<netShowUntil,hit=K.now()-lastCatchAt<700;spr(c,frz?'oni_freeze':hit?'oni_catch':walking?'oni_run'+(1+Math.floor(t*10)%4):'oni_idle',x,y-(frz?0:bob),f,frz?0:tilt);}
  else{const ch=charOf(id,i),s=st==='caught'?'caught':st==='exit'?'win':walking?RUN[Math.floor(t*10)%5]:'idle';spr(c,ch+'_'+s,x,y-(s==='caught'?0:bob),f,s==='caught'?0:tilt);}
 }
 function draw(){
  if(!cv||!state)return;
  const dpr=Math.min(2,devicePixelRatio||1),W=cv.clientWidth;if(!W)return;if(cv.width!==Math.round(W*dpr)){cv.width=Math.round(W*dpr);cv.height=Math.round(W*dpr);}
  const c=cv.getContext('2d');c.setTransform(dpr*W/N,0,0,dpr*W/N,0,0);c.clearRect(0,0,N,N);
  c.fillStyle='#120e0a';c.fillRect(0,0,N,N);c.fillStyle='#ffffff08';for(let i=0;i<N*3;i++)c.fillRect(0,i/3,N,0.012);
  for(const w of walls()){c.save();c.shadowColor='#000b';c.shadowBlur=10;c.shadowOffsetY=0.05;c.fillStyle='#4a3b30';c.beginPath();c.roundRect(w[0],w[1],w[2],w[3],0.12);c.fill();c.restore();
   const gr=c.createLinearGradient(0,w[1],0,w[1]+w[3]);gr.addColorStop(0,'#6b5645');gr.addColorStop(1,'#3c2f26');c.fillStyle=gr;c.beginPath();c.roundRect(w[0]+.03,w[1]+.03,w[2]-.06,w[3]-.1,0.1);c.fill();
   c.strokeStyle='#ffffff18';c.lineWidth=0.025;c.beginPath();c.roundRect(w[0]+.06,w[1]+.06,w[2]-.12,w[3]-.16,0.08);c.stroke();}
  {const dx=EXIT[0]+.5;c.fillStyle='#12302c';c.fillRect(dx-.8,0,1.6,.9);c.strokeStyle='#3fd0c0';c.lineWidth=0.06;c.strokeRect(dx-.77,.03,1.54,.84);c.textAlign='center';c.textBaseline='middle';c.font='0.6px sans-serif';c.fillStyle='#fff';c.fillText('🚪',dx,.48);}
  const ids=[...uids];
  const hideOni=state.phase==='choose'&&K.now()<lotteryUntil;
  const ents=ids.map((id,i)=>({id,i,p:posOf(id)})).filter(e=>e.p&&!(hideOni&&e.id===state.oni)).sort((a,b)=>a.p[1]-b.p[1]);
  const playing=state.phase==='play'||state.phase==='count'||state.phase==='choose'||state.phase==='rolled'||state.phase==='end';
  for(const e of ents){
   if(!playing)break;
   const [x,y]=e.p,isAlly=false,boss=e.id===state.oni;
   const out=state.st?.[e.id]==='caught';c.globalAlpha=out?.8:1;
   if(boss){c.shadowColor=K.now()<netShowUntil?'#4fc3ff':'#ff5a47';c.shadowBlur=14;}else if(e.id===uid){c.shadowColor='#f3b73f';c.shadowBlur=12;}
   if(frozenNow(e.id)){c.shadowColor='#5bd6ff';c.shadowBlur=20;}
   person(c,e.id,x,y,isAlly?Number(e.id.slice(1)):e.i,isAlly?'ko':boss?'boss':'run');c.shadowBlur=0;
   if(!isAlly){c.textAlign='center';c.textBaseline='middle';c.font='0.2px sans-serif';c.fillStyle=e.id===uid?'#f3b73f':'#fff';c.lineWidth=0.05;c.strokeStyle='#000c';const label=e.id===uid?'あなた':nm(e.id);const ly=Math.min(y+0.55,N-0.12);c.strokeText(label,x,ly);c.fillText(label,x,ly);}
   c.globalAlpha=1;}
  if(joy.active&&state.phase==='play'){c.setTransform(dpr,0,0,dpr,0,0);c.beginPath();c.arc(joy.ox,joy.oy,34,0,7);c.strokeStyle='#f3b73f88';c.lineWidth=2;c.stroke();c.beginPath();c.arc(joy.ox+joy.x*34,joy.oy+joy.y*34,16,0,7);c.fillStyle='#f3b73faa';c.fill();}
  if(state.phase==='play'&&state.hold==='wait'){c.setTransform(dpr*W/N,0,0,dpr*W/N,0,0);c.fillStyle='#000a';c.fillRect(0,2.8,N,1.4);c.fillStyle='#fff';c.font='0.46px sans-serif';c.textAlign='center';c.fillText(role()==='oni'?'鬼は少し待って！':'鬼が目を閉じている…',N/2,3.5);}
  if(state.phase==='play'&&K.now()<netShowUntil){c.setTransform(dpr*W/N,0,0,dpr*W/N,0,0);c.fillStyle='#10324acc';c.fillRect(0,2.7,N,0.8);c.fillStyle='#fff';c.font='0.4px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🕸 投網ブースト！ 鬼が2倍の速さ！',N/2,3.1);}
  if(state.phase==='play'&&fzUid&&K.now()<fzUntil){c.setTransform(dpr*W/N,0,0,dpr*W/N,0,0);c.fillStyle='#173a36cc';c.fillRect(0,3.6,N,0.8);c.fillStyle='#fff';c.font='0.4px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🥶 '+(fzUid===uid?'あなた':nm(fzUid))+'が こおった！',N/2,4.0);}
 }
 // ---- 画面（骨組みは1回だけ作り、盤面のcanvasは作り直さない） ----
 const AV=['⭐','🌙','🌈','🔥','🍀','🎲'];
 let shell=null,lotteryUntil=0,rollUntil=0,rollSeen=null,reelTimer=0,lotteryTimer=0,rollTimer=0,overlayText='';
 function build(){
  root.innerHTML='<div id="o-head"></div><div class="o-aw" id="o-aw"><canvas id="o-cv" aria-label="おにごっこの盤面"></canvas><div class="o-fin" id="o-over" hidden></div></div><div id="o-below"></div>';
  root.classList?.add('oni-root');
  cv=root.querySelector('#o-cv');
  ATL=new Image();ATL.src=new URL('./img/oni-sprites.webp',import.meta.url).href;
  const pt=e=>{const r=cv.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top];};
  cv.onpointerdown=e=>{try{cv.setPointerCapture(e.pointerId);}catch{}[joy.ox,joy.oy]=pt(e);joy.active=true;joy.x=joy.y=0;};
  cv.onpointermove=e=>{if(!joy.active)return;const [x,y]=pt(e);let dx=(x-joy.ox)/34,dy=(y-joy.oy)/34;const m=Math.hypot(dx,dy);if(m>1){dx/=m;dy/=m;joy.ox+=(x-joy.ox)-dx*34;joy.oy+=(y-joy.oy)-dy*34;}joy.x=Math.abs(dx)<.12?0:dx;joy.y=Math.abs(dy)<.12?0:dy;};
  const up=()=>{joy.active=false;joy.x=joy.y=0;};cv.onpointerup=up;cv.onpointercancel=up;
  shell=true;
 }
 const q=id=>root.querySelector('#'+id);
 function runnerChips(){
  const s=state;
  return uids.filter(u=>u!==s.oni).map(u=>{const st=s.st?.[u];return `<span class="o-chip">${AV[(slotOf[u]||0)%6]} ${esc(nm(u))} ${st==='exit'?'🚪':st==='caught'?'💀':'🏃'}</span>`;}).join('');
 }
 function buffChips(){
  const r=ODDS.find(x=>x[0]===state.buff);return r&&state.buff!=='none'?`<span class="o-chip">${r[2]}</span>`:'';
 }
 function resultsHtml(){
  const s=state,rn=uids.filter(u=>u!==s.oni),ex=rn.filter(u=>s.st?.[u]==='exit').length,ca=rn.filter(u=>s.st?.[u]==='caught').length;
  const rows=uids.map((u,i)=>{
   const st=s.st?.[u],isOni=u===s.oni,ch=charOf(u,i);
   const pic=isOni?(ex===0?'oni_win':'oni_idle'):st==='exit'?ch+'_win':st==='caught'?ch+'_caught':ch+'_idle',m=MET[pic];
   const [badge,label,cls]=isOni?['ONI','おに','b-oni']:st==='exit'?['ESCAPED','だっしゅつ成功','b-ok']:st==='caught'?['CAUGHT','つかまった','b-ng']:['TIME OVER','出口に とどかず','b-ng'];
   const av=m?`<i class="o-av" style="background-position:${-m[0]/2}px ${-m[1]/2}px"></i>`:'';
   return `<div class="o-rr">${av}<div class="o-rn"><b>${esc(nm(u))}${u===uid?'（あなた）':''}</b><span class="o-bd ${cls}">${badge}</span><small>${label}</small></div><div class="o-rb">${isOni?(ex===0?'🏆':''):st==='exit'?'🎉':''}</div></div>`;}).join('');
  const verdict=ex===0?'👹 おにの勝ち！':ca===0?'🎉 全員 だっしゅつ！':`🎉 ${ex}人 だっしゅつ！`;
  return `<div class="o-resh"><div class="o-rt1">RESULT</div><div class="o-rt2">${verdict}</div><div class="o-rt3">だっしゅつ <b>${ex}</b>／つかまった <b>${ca}</b>／逃げる人 ${rn.length}人</div></div><div class="o-panel">${rows}</div>${host?'<button id="o-again">もういちど（鬼を ルーレットで きめる）</button>':'<p class="o-say">ホストが つぎを はじめるのを まっています。</p>'}<button id="o-home" class="o-ghost">さいしょの がめんに もどる</button>`;
 }
 let lastKey='';
 function render(){
  if(dead||!dom)return;
  if(!shell)build();
  const s=state;
  if(!s){q('o-below').innerHTML=`<p class="o-say">${host?'ミニゲームを準備しています…':'ホストの準備を待っています…'}</p>`;return;}
  const amOni=s.oni===uid,showEnd=s.phase==='end'&&endShown,lot=s.phase==='choose'&&K.now()<lotteryUntil;
  q('o-aw').hidden=showEnd;
  const head=showEnd?'':`<div class="o-top"><b class="o-time">⏱ <span id="o-sec">${Math.ceil(TIME)}</span>秒</b><span class="o-chip oni">👹 鬼：${lot?'？？？':esc(nm(s.oni))+(amOni?'（あなた）':'')}</span></div><div class="o-timer"><i id="o-bar"></i></div><div class="o-hud">${buffChips()}${runnerChips()}</div>`;
  const over=q('o-over');let ov='';
  if(s.phase==='count')ov=`<div class="o-f1 o-cnt">${Math.max(1,3-Math.floor((K.now()-phaseAt)/800))}</div><div class="o-f2">${amOni?'あなたは鬼！ 追いかけよう':'出口🚪へ にげよう！'}</div>`;
  else if(s.phase==='end'&&!endShown)ov=`<div class="o-f1">FINISH!</div><div class="o-f2">${s.why==='time'?'TIME UP ・ 時間切れ':'ALL DONE ・ 全員決着'}</div>`;
  over.hidden=!ov;if(ov!==overlayText){over.innerHTML=ov;overlayText=ov;}
  let below='';
  if(s.phase==='choose'){
   if(K.now()<lotteryUntil){below=`<div class="o-panel"><h2>鬼を抽選中…</h2><div class="o-reel" id="o-reel">…</div></div>`;startReel(uids.map(nm),nm(s.oni),lotteryUntil);}
   else below=`<div class="o-panel"><h2>${amOni?'あなたは鬼！ パワーアップルーレットをまわそう':esc(nm(s.oni))+'が鬼！ パワーアップルーレットを まわしています…'}</h2>${amOni&&!choice?`<button id="o-spin" class="o-red">🎰 ルーレットをまわす</button>`:''}<ul class="o-rules">${ODDS.map(([,p,t,d])=>`<li><b>${p}%</b> ${t}：${d}</li>`).join('')}</ul></div>`;
  }else if(s.phase==='rolled'){
   if(rollSeen!==s.g){rollSeen=s.g;rollUntil=K.now()+1800;K.clearTimeout(rollTimer);rollTimer=K.setTimeout(()=>{if(!dead)render();},1850);}
   const r=ODDS.find(x=>x[0]===s.rolled)||ODDS[ODDS.length-1];
   below=`<div class="o-panel"><h2>ルーレット</h2>${K.now()<rollUntil?'<div class="o-reel" id="o-reel">…</div>':`<div class="o-reel hit">${r[2]}</div><p class="o-say">${r[3]}</p>`}</div>`;
   if(K.now()<rollUntil)startReel(ODDS.map(x=>x[2]),r[2],rollUntil);
  }else if(s.phase==='end'&&endShown)below=resultsHtml();
  else if(s.phase==='play'||s.phase==='count'){
   const st=s.st?.[uid];
   const say=s.phase==='count'?'':amOni?'画面をドラッグして追いかけよう。触れたら捕まえられる。投網ブーストは5秒だけ2倍の速さ！':st==='exit'?'あなたは出口に着いた。みんなを見守ろう。':st==='caught'?'つかまった… 結果を見守ろう。':'画面をドラッグして逃げよう。出口🚪へ！';
   const lg=arr(s.lg).map(l=>`<li>${esc(l)}</li>`).join('');
   below=`<p class="o-say">${say}</p>${amOni&&s.phase==='play'?'<button id="o-net" class="o-red">🕸 投網ブースト！</button>':''}<div class="o-panel"><h2>ログ</h2><ul class="o-log">${lg||'<li>まだ何も起きていません。</li>'}</ul></div>`;
  }
  const bk=below;if(bk!==lastKey){lastKey=bk;q('o-below').innerHTML=below;}
  q('o-head').innerHTML=head;
  q('o-spin')&&(q('o-spin').onclick=()=>choose('spin'));
  q('o-net')&&(q('o-net').onclick=useNet);
  q('o-again')&&(q('o-again').onclick=again);
  q('o-home')&&(q('o-home').onclick=()=>{location.href=location.pathname;});
 }
 function startReel(labels,target,until){
  K.clearInterval(reelTimer);let i=0;
  reelTimer=K.setInterval(()=>{const e=root.querySelector?.('#o-reel');if(!e||K.now()>=until){K.clearInterval(reelTimer);if(e)e.textContent=target;return;}e.textContent=labels[i++%labels.length];},90);
 }
 const choose=v=>set(ref(db,base+'/choice'),v).catch(()=>message('選べませんでした。もう一度押してください。'));
 const useNet=()=>{if(role()!=='oni'||state?.phase!=='play'||holdNow()||boosting()||netUsed>=netAllowed())return;netUsed++;boostUntil=K.now()+BOOST_MS;netShowUntil=boostUntil;set(ref(db,base+'/net'),{g:state.g,n:netUsed,at:Date.now()}).catch(()=>{});};
 function paintTimer(){
  if(!dom||!state)return;
  if(state.phase==='play'){const left=Math.max(0,TIME-(K.now()-playStart)/1000),b=root.querySelector('#o-bar'),s=root.querySelector('#o-sec');if(b)b.style.transform=`scaleX(${left/TIME})`;if(s)s.textContent=Math.ceil(left);
   const nb=root.querySelector('#o-net');if(nb){const rest=netAllowed()-netUsed;if(boosting()){nb.textContent=`🕸 ブースト中！ あと${Math.ceil((boostUntil-K.now())/1000)}びょう`;nb.disabled=true;}else if(rest>0&&!holdNow()){nb.textContent=`🕸 投網ブースト！（のこり${rest}回）`;nb.disabled=false;}else{nb.textContent=rest>0?'🕸 まだ うごけないよ':'🕸 つかいきった';nb.disabled=true;}}}
 }
 // ---- ループ ----
 function tick(now){
  if(dead)return;
  const dt=Math.min(0.05,(now-loopLast)/1000);loopLast=now;
  frame(dt);
  if(dom){draw();paintTimer();if(state?.phase==='count'||state?.phase==='end'){const o=root.querySelector('#o-over');if(o&&state.phase==='count'){const n=Math.max(1,3-Math.floor((K.now()-phaseAt)/800)),e=o.querySelector('.o-cnt');if(e&&e.textContent!==String(n))e.textContent=n;}}}
 }
 if(dom){const loop=t=>{if(dead)return;tick(t);raf=requestAnimationFrame(loop);};loopLast=performance.now();raf=requestAnimationFrame(loop);}
 else{loopLast=K.now();loopId=K.setInterval(()=>tick(K.now()),33);}
 const onKey=(e,v)=>{keys[e.key]=v;if(v&&state?.phase==='play'&&String(e.key).startsWith('Arrow'))e.preventDefault?.();};
 const kd=e=>onKey(e,true),ku=e=>onKey(e,false);
 if(dom){addEventListener('keydown',kd);addEventListener('keyup',ku);}
 // ---- 通信 ----
 stops.push(onValue(ref(db,base+'/state'),snap=>{
  const s=snap.val(),prev=state;state=s;
  if(s){
   const now=K.now();
   if(s.g!==lastG){lastG=s.g;lastPhase=null;mine.inited=false;mine.sentCount=false;netUsed=0;boostUntil=0;netShowUntil=0;lastNetAt=0;fzUid=null;fzUntil=0;lastFzK=0;lotteryUntil=now+3000;rollSeen=null;endShown=false;auto_lm=null;overlayText='';lastKey='';for(const k of Object.keys(buf))delete buf[k];prevSt={};advancing=false;K.clearTimeout(lotteryTimer);lotteryTimer=K.setTimeout(()=>{if(!dead){lastKey='';render();hostTick();}},3050);}
   if(s.fz&&s.fz.k!==lastFzK){lastFzK=s.fz.k;fzUid=s.fz.u;fzUntil=now+FREEZE_MS;}
   if(s.phase!==lastPhase){lastPhase=s.phase;phaseAt=now;advancing=false;if(s.phase==='play')playStart=now;
    if(s.phase==='end'){endShown=false;T(()=>{endShown=true;lastKey='';render();},2400);}}
   if(auto&&s.phase==='choose'&&s.oni===uid&&autoG!==s.g){autoG=s.g;T(()=>set(ref(db,base+'/choice'),'spin').catch(()=>{}),3500);}
   for(const [u,v] of Object.entries(s.st||{})){if(v==='caught'&&prevSt[u]!=='caught')lastCatchAt=now;prevSt[u]=v;}
  }
  render();
  if(host){if(!s)hostStart();else hostTick();}
 },()=>message('ミニゲームの状態を取得できませんでした。')));
 stops.push(onValue(ref(db,base+'/choice'),snap=>{choice=snap.val();lastKey='';render();hostTick();},()=>{}));
 stops.push(onValue(ref(db,base+'/net'),snap=>{const v=snap.val();if(v&&state&&v.g===state.g&&v.at!==lastNetAt){lastNetAt=v.at;if(uid!==state.oni)netShowUntil=K.now()+BOOST_MS;}},()=>{}));
 stops.push(onValue(ref(db,base+'/pos'),snap=>{
  const v=snap.val()||{},now=K.now();
  for(const [id,p] of Object.entries(v)){
   if(id===uid||!p||typeof p.x!=='number')continue;
   const b=buf[id]||(buf[id]=[]),l=b[b.length-1];
   if(!l||l.x!==p.x||l.y!==p.y){b.push({t:now,x:p.x,y:p.y});if(b.length>12)b.shift();}
  }
  for(const id of Object.keys(buf))if(!(id in v))delete buf[id];
 },()=>{}));
 const stop=()=>{dead=true;if(raf)cancelAnimationFrame(raf);if(loopId)K.clearInterval(loopId);if(hostSim)K.clearInterval(hostSim);K.clearInterval(reelTimer);K.clearTimeout(lotteryTimer);K.clearTimeout(rollTimer);timers.forEach(t=>K.clearTimeout(t));stops.forEach(f=>f());if(dom){removeEventListener('keydown',kd);removeEventListener('keyup',ku);root.replaceChildren?.();root.classList?.remove('oni-root');}};
 stop.again=again;return stop;
}
// ローカル練習ではNPCをホストの端末が動かすので、ここでは何もしない（room.js との互換用）。
export function attachOniBots(){return {stop(){}};}
