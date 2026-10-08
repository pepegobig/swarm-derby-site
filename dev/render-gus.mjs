#!/usr/bin/env node
// Dev-only: npm install playwright, then node dev/render-gus.mjs.
// Rasterize the existing canvas functions; no generated artwork or runtime dependency.
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
const page=await browser.newPage();
const source=await fs.readFile(new URL('game.html',import.meta.url),'utf8');
const functions=['fieldGeom','drawSlugger','drawPitcherOnCenterMound','drawIMDGrandstands'];
function extract(name) { const start=source.indexOf('    function '+name+'('); const end=source.indexOf('\n    function ',start+1); let code=source.slice(start,end); if(name==='drawPitcherOnCenterMound') { const a=code.indexOf('      // Raised Clay'); const b=code.indexOf('      // Pitcher Daemon Hover'); code=code.slice(0,a)+code.slice(b); } if(name==='drawIMDGrandstands') { const a=code.indexOf('      // Giant Center Scoreboard'); code=code.slice(0,a)+'\n    }'; } return code; }
const code=functions.map(extract).join('\n');
await page.setContent('<canvas></canvas>');
await page.evaluate(code=>{
  Math.random = () => 0.5;
  window.render = new Function('kind','pose','angle',`let width=1600,height=640,frameCount=0,activeTheme=null,batterState=pose,batAngle=angle,mashPower=0,gameState='IDLE',pitchType='FASTBALL',turnsLeft=20;
  const STATES={MASHING:'MASHING'},WALL_COLS=14,WALL_ROWS=6,imdModules=[];
  const themeColor=(key,fallback)=>fallback;
  ${code}
  const c=document.querySelector('canvas'); c.width=kind==='batter'?128:kind==='pitcher'?96:1600;c.height=kind==='batter'?160:kind==='pitcher'?96:640;
  const x=c.getContext('2d');
  if(kind==='batter'){width=212;height=202;drawSlugger(x);}
  if(kind==='pitcher'){width=96;height=80;drawPitcherOnCenterMound(x);}
  if(kind==='stadium'){width=1080;height=660;x.scale(1600/width,640/(height*0.42));for(let r=0;r<WALL_ROWS;r++)for(let col=0;col<WALL_COLS;col++)imdModules.push({row:r,col,type:['oscilloscope','vumeter','led_grid','dial_bank','patch_jacks'][(r*5+col*11)%5],ledState:true,blinkSpeed:24,sinePhase:Math.PI,needleVal:0.5,needleTarget:0.5,panelId:'MD-'+(r*WALL_COLS+col).toString(16).toUpperCase()});drawIMDGrandstands(x);
  // Backdrop contains only racks; the live terminal is drawn by the game.
  }
  return c.toDataURL('image/png').split(',')[1];`);
},code);
await fs.mkdir('themes/gus',{recursive:true});
const sprites={};
for(const [pose,angle] of [['idle',0],['mash',0],['swing-1',-0.4],['swing-2',0.9],['swing-3',2.2],['celebrate',0],['sad',0]]) {
 const name=`batter-${pose}.png`;const data=await page.evaluate(([pose,angle])=>render('batter',pose.startsWith('swing')?'swing':pose,angle),[pose,angle]);await fs.writeFile('themes/gus/'+name,Buffer.from(data,'base64'));if(pose.startsWith('swing'))(sprites.swing ||= []).push(name);else sprites[pose]=name;
}
for(const [kind,name] of [['pitcher','pitcher.png']])await fs.writeFile('themes/gus/'+name,Buffer.from(await page.evaluate(kind=>render(kind,'idle',0),kind),'base64'));
const banter=['Daemon #42: Optical lock established. Fastball clocked at 101 MPH.', 'Daemon #09: Exit velocity registers anomaly on the stadium seismograph.', 'Daemon #42: My sinker has a 78% groundout probability. Step up.'];
const commentary={whiff:['Daemon #07: Batter swung in a different zip code. Sit down.',...banter],foul:['Daemon #42: That one landed outside the foul pole.',...banter],pop:['Daemon #42: Not enough bat speed for a bomb. Mash past the power line.',...banter],homer:["Daemon #42: GUS sends it {feet} feet. Counts toward today's leaderboard.",...banter],bomb:['Daemon #09: {feet} FT. The upper rack array is shaking.',...banter],slam:["Daemon #42: {feet} FT. That's a vault-cracker.",...banter]};
await fs.writeFile('themes/gus/theme.json',JSON.stringify({version:1,id:'gus',title:'DAILY DERBY',shoutout:null,winner:null,auctionDay:null,batter:{name:'GUS',number:'7',sprites},pitcher:{name:'DAEMON #42',sprite:'pitcher.png'},stadium:{name:'Swarm Derby',palette:{grass:'#166534',grassStripe:'#15803d',dirt:'#9c633a',lines:'#ffffff',wallTrim:'#1c4a36',sky:'#020617'}},weather:'clear',commentary},null,2)+'\n');
try { await fs.access('themes/index.json'); } catch { await fs.writeFile('themes/index.json',JSON.stringify({version:1,default:'gus',days:{}},null,2)+'\n'); }
await browser.close();
console.log('Rendered themes/gus');
