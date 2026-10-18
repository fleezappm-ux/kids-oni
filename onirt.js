// おにごっこ 脱出（リアルタイム版）の共通ロジック。画面にも通信にも依存しない。
// 位置の単位は「マス」（盤面は N×N）。体は半径 RS の丸、ブロックは自由な位置・大きさの四角。
export const N=7,EXIT=[3,0],TIME=60,RS=0.3,CATCH=0.58,NS=0.25,NG=28,WAIT=2,FREEZE_AT=10,FREEZE_T=3,BOOST_T=5,BOOST_X=2;
// 逃げる人の足は 2.45マス/秒。鬼は参加人数が多いほど速い（2人1.1倍 / 3人1.2倍 / 4人1.3倍 / 5人以上1.4倍）
export const SP_RUN=2.45;
export const oniMult=n=>[1.1,1.2,1.3,1.4][Math.max(0,Math.min(3,n-2))];
// 鬼のパワーアップルーレット
export const ODDS=[['net2',20,'🕸 投網＋1','投網ブーストを2回つかえる'],['fast',25,'⚡ 韋駄天','鬼の足がずっと15%速い'],['big',20,'🤚 大きな手','つかまえる範囲が1.4倍'],['rocket',20,'🚀 ロケットスタート','最初の待ち時間がなくなる'],['freeze',10,'🥶 金縛り','10秒たつと、逃げる人のだれか1人が3秒とまる'],['none',5,'💨 ハズレ','効果なし']];
export const rollRoulette=(rand=Math.random)=>{const tot=ODDS.reduce((a,x)=>a+x[1],0);let r=rand()*tot;for(const x of ODDS){if(r<x[1])return x[0];r-=x[1];}return 'none';};
export const isFast=b=>b==='fast';
export const pickOni=(uids,rand=Math.random)=>uids[Math.floor(rand()*uids.length)];
const r2=v=>Math.round(v*100)/100;
// ---- 当たり判定 ----
export function blocked(walls,x,y){
 if(x<RS||y<RS||x>N-RS||y>N-RS)return true;
 for(const w of walls){const px=Math.max(w[0],Math.min(x,w[0]+w[2])),py=Math.max(w[1],Math.min(y,w[1]+w[3]));if((x-px)**2+(y-py)**2<RS*RS)return true;}
 return false;
}
export function moveBody(walls,e,dx,dy){const nx=e.x+dx,ny=e.y+dy;if(!blocked(walls,nx,e.y))e.x=nx;if(!blocked(walls,e.x,ny))e.y=ny;}
export const inExit=(x,y)=>Math.abs(x-(EXIT[0]+.5))<0.9&&y<0.9;
// ---- 道案内（0.25刻みの格子で最短距離を測る。NPCの動きと配置チェック用）----
export function navBuild(walls){const a=new Uint8Array(NG*NG);for(let j=0;j<NG;j++)for(let i=0;i<NG;i++)a[j*NG+i]=blocked(walls,(i+.5)*NS,(j+.5)*NS)?0:1;return a;}
export function nbfs(nav,x,y){
 const d=new Int16Array(NG*NG).fill(-1);let si=Math.min(NG-1,Math.max(0,Math.floor(x/NS))),sj=Math.min(NG-1,Math.max(0,Math.floor(y/NS)));
 if(!nav[sj*NG+si]){let b=1e9,bi=si,bj=sj;for(let j=0;j<NG;j++)for(let i=0;i<NG;i++)if(nav[j*NG+i]){const dd=(i-si)**2+(j-sj)**2;if(dd<b){b=dd;bi=i;bj=j;}}si=bi;sj=bj;}
 const q=[si+sj*NG];d[q[0]]=0;
 for(let h=0;h<q.length;h++){const c=q[h],ci=c%NG,cj=(c/NG)|0;
  for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const ni=ci+dx,nj=cj+dy;if(ni<0||nj<0||ni>=NG||nj>=NG)continue;const n=nj*NG+ni;if(!nav[n]||d[n]>=0)continue;if(dx&&dy&&(!nav[cj*NG+ni]||!nav[nj*NG+ci]))continue;d[n]=d[c]+1;q.push(n);}}
 return d;
}
export const distAt=(dist,x,y)=>{const i=Math.floor(x/NS),j=Math.floor(y/NS);if(i<0||j<0||i>=NG||j>=NG)return 99;const v=dist[j*NG+i];return v<0?99:v*NS;};
// ---- 配置 ----
export function startsFor(uids,oni){
 const runners=uids.filter(u=>u!==oni),xs=[[3],[1,5],[0,3,6],[0,2,4,6],[0,1,3,5,6]][Math.max(0,Math.min(4,runners.length-1))],out={[oni]:[3.5,3.5]};
 runners.forEach((u,i)=>{out[u]=[(xs[i]??3)+0.5,6.5];});return out;
}
const rectGap=(a,b)=>{const dx=Math.max(a[0]-(b[0]+b[2]),b[0]-(a[0]+a[2]),0),dy=Math.max(a[1]-(b[1]+b[3]),b[1]-(a[1]+a[3]),0);return Math.hypot(dx,dy);};
function genWalls(rand,keeps){
 const n=4+Math.floor(rand()*6),ws=[];let tries=0;
 while(ws.length<n&&tries++<400){
  const horiz=rand()<.5,w=horiz?0.9+rand()*1.5:0.55+rand()*0.7,h=horiz?0.55+rand()*0.7:0.9+rand()*1.5;
  const x=0.1+rand()*(N-w-0.2),y=0.1+rand()*(N-h-0.2),r=[r2(x),r2(y),r2(w),r2(h)];
  const gapB=Math.min(r[0],r[1],N-r[0]-r[2],N-r[1]-r[3]);if(gapB>0.02&&gapB<0.75)continue;
  if(keeps.some(k=>{const px=Math.max(r[0],Math.min(k.x,r[0]+r[2])),py=Math.max(r[1],Math.min(k.y,r[1]+r[3]));return Math.hypot(k.x-px,k.y-py)<k.r;}))continue;
  if(ws.some(o=>{const g=rectGap(r,o);return g>0.02&&g<0.8;}))continue;
  ws.push(r);}
 return ws;
}
// 全員のスタートから出口まで行けて、行けない袋小路が少ない配置が出るまで作り直す
export function makeWalls(rand,starts){
 const keeps=[{x:EXIT[0]+.5,y:.6,r:1.5},{x:3.5,y:3.5,r:1.0},...Object.values(starts).map(([x,y])=>({x,y,r:0.9}))];
 let ws=[];
 for(let t=0;t<300;t++){ws=genWalls(rand,keeps);const nav=navBuild(ws),d=nbfs(nav,EXIT[0]+.5,.5);
  const free=nav.reduce((a,v)=>a+v,0),reach=d.reduce((a,v)=>a+(v>=0?1:0),0);
  if(reach>=free*0.97&&Object.values(starts).every(([x,y])=>distAt(d,x,y)<90))return ws;}
 return [];
}
// ---- 速さ ----
export const speedFor=(role,buff,n=2,boost=false)=>role==='oni'?SP_RUN*oniMult(n)*(buff==='fast'?1.15:1)*(boost?BOOST_X:1):SP_RUN;
// ---- ゲーム進行モデル（ホストが持つ。テストでも同じものを使う）----
export function createModel({walls,uids,oni,buff,starts,npcs=[],rand=Math.random}){
 const nav=navBuild(walls),m={walls,nav,dist:nbfs(nav,EXIT[0]+.5,.5),rand,t:0,wait:buff==='rocket'?0:WAIT,hold:buff==='rocket'?null:'wait',buff,n:uids.length,oniId:oni,items:[],ents:{},log:[],over:false,why:null,fz:null,fzDone:false};
 const st=starts||startsFor(uids,oni);
 for(const u of uids){const [x,y]=st[u];m.ents[u]={id:u,x,y,role:u===oni?'oni':'run',st:u===oni?'oni':'run',npc:npcs.includes(u)};}
 return m;
}
export const chasers=m=>Object.values(m.ents).filter(e=>e.role==='oni'||e.role==='ally');
export const runnersOf=m=>Object.values(m.ents).filter(e=>e.role==='run');
export const aliveOf=m=>runnersOf(m).filter(e=>e.st==='run');
export function advanceClock(m,dt){
 m.t+=dt;m.wait=Math.max(0,m.wait-dt);
 // 金縛り：10秒たつと、逃げている人のだれか1人が3秒とまる（とまる本人の端末が止まる）
 if(m.buff==='freeze'&&!m.fzDone&&m.t>=FREEZE_AT){
  const alive=aliveOf(m);m.fzDone=true;
  if(alive.length){const v=alive[Math.floor(m.rand()*alive.length)];m.fz={u:v.id};m.log.unshift('🥶 金縛り！ 1人がとまった');}
 }
 m.hold=m.wait>0?'wait':null;
}
export function steerRunner(m,e,dt){
 const R=m.rand,threats=chasers(m);e.think=(e.think||0)-dt;
 if(e.think<=0){e.think=0.12+R()*0.1;let best=null,bs=1e9;const floor=m.items.filter(i=>!i.h&&!i.s),o=m.ents[m.oniId];
  for(let a=0;a<16;a++){const ang=a*Math.PI/8,vx=Math.cos(ang),vy=Math.sin(ang),px=e.x+vx*0.7,py=e.y+vy*0.7;
   if(blocked(m.walls,px,py))continue;
   let sc=distAt(m.dist,px,py)*1.1;if(sc>90)sc=40;
   for(const t of threats){const d=Math.hypot(px-t.x,py-t.y);if(d<3)sc+=(3-d)*7;}
   const near=floor.map(i=>Math.hypot(i.x-px,i.y-py)).sort((p,q)=>p-q)[0];if(near!==undefined&&near<2.2&&Math.hypot(o.x-px,o.y-py)>3)sc-=(2.2-near)*3;
   sc+=R()*0.8;if(sc<bs){bs=sc;best=[vx,vy];}}
  e.dir=best||[0,0];}
 const sp=speedFor('run',m.buff,m.n,false)*dt;moveBody(m.walls,e,e.dir[0]*sp,e.dir[1]*sp);
}
export function steerChaser(m,e,dt,sp){
 const R=m.rand;e.think=(e.think||0)-dt;
 if(e.think<=0){e.think=0.12+R()*0.08;const targets=aliveOf(m);e.dir=[0,0];
  if(targets.length){const tg=targets.sort((a,b)=>Math.hypot(a.x-e.x,a.y-e.y)-Math.hypot(b.x-e.x,b.y-e.y))[0],near=Math.hypot(tg.x-e.x,tg.y-e.y);
   if(near<1.3){e.dir=[(tg.x-e.x)/(near||1),(tg.y-e.y)/(near||1)];}
   else{const dm=nbfs(m.nav,tg.x,tg.y),ci=Math.floor(e.x/NS),cj=Math.floor(e.y/NS);let bc=null,bd=1e9;
    for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){const ni=ci+di,nj=cj+dj;if(ni<0||nj<0||ni>=NG||nj>=NG)continue;const v=dm[nj*NG+ni];if(v>=0&&v<bd){bd=v;bc=[(ni+.5)*NS,(nj+.5)*NS];}}
    if(bc){const mm=Math.hypot(bc[0]-e.x,bc[1]-e.y)||1;e.dir=[(bc[0]-e.x)/mm,(bc[1]-e.y)/mm];if(bd<=1)e.dir=[(tg.x-e.x)/(near||1),(tg.y-e.y)/(near||1)];}}}}
 const s=sp*dt;moveBody(m.walls,e,(e.dir?.[0]||0)*s,(e.dir?.[1]||0)*s);
}
// NPC（ボット・仲間・NPCの鬼）を1コマ動かす
export function stepNpcs(m,dt){
 for(const e of Object.values(m.ents)){
  if(!e.npc)continue;
  if(e.role==='run'){if(e.st==='run')steerRunner(m,e,dt);}
  else if(!m.hold)steerChaser(m,e,dt,speedFor('oni',m.buff,m.n,false));
 }
}
// 出口・捕まる・時間切れを判定する。ホストだけが呼ぶ。
export function judge(m,names={}){
 const nm=u=>names[u]||'誰か',reach=CATCH*(m.buff==='big'?1.4:1);
 for(const r of aliveOf(m)){
  if(inExit(r.x,r.y)){r.st='exit';m.log.unshift(`${nm(r.id)}が出口に着いた！`);}
 }
 for(const r of aliveOf(m))for(const c of chasers(m))if(Math.hypot(c.x-r.x,c.y-r.y)<reach){
  r.st='caught';m.oniCatchAt=m.t;m.log.unshift(`${nm(r.id)}が捕まった！`);break;}
 if(m.log.length>8)m.log.length=8;
 if(!m.over&&(m.t>=TIME||!aliveOf(m).length)){m.over=true;m.why=m.t>=TIME?'time':'done';}
}
