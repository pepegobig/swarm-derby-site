#!/usr/bin/env node
// Dependency-free Node 18 validator. Shares the browser's schema rules.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('game.html', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.split('// THEME VALIDATION START')[1].split('// THEME VALIDATION END')[0] + '\nthis.validateTheme=validateTheme;this.validateThemeIndex=validateThemeIndex;', context);
let failures = 0;
function fail(message) { console.error(message); failures++; }
function dimensions(b) {
  if (b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && b.length >= 33) return [b.readUInt32BE(16),b.readUInt32BE(20), b[25] === 6 || b[25] === 4 || b.includes(Buffer.from('tRNS'))];
  if (b.toString('ascii',0,4) === 'RIFF' && b.toString('ascii',8,12) === 'WEBP') {
    const type = b.toString('ascii',12,16);
    if (type === 'VP8X') return [1+b.readUIntLE(24,3),1+b.readUIntLE(27,3),!!(b[20]&16)];
    if (type === 'VP8L') { const v=b.readUInt32LE(21); return [(v&16383)+1,((v>>>14)&16383)+1,!!(v&0x10000000)]; }
    if (type === 'VP8 ') return [b.readUInt16LE(26)&16383,b.readUInt16LE(28)&16383,false];
  }
  throw Error('invalid PNG/WebP header');
}
function pack(dir) {
  const before=failures;
  try {
    const data=JSON.parse(fs.readFileSync(path.join(dir,'theme.json'),'utf8'));
    const {errors,assets}=context.validateTheme(data,path.basename(dir));
    errors.forEach(e=>fail(dir+': '+e));
    const names=new Set(['theme.json',...assets.map(a=>a.name)]);
    let total=0;
    for (const entry of fs.readdirSync(dir,{withFileTypes:true})) {
      const p=path.join(dir,entry.name);
      if (!entry.isFile()) { fail(p+': only ordinary files allowed'); continue; }
      total+=fs.statSync(p).size;
      if (!names.has(entry.name)) fail(p+': file not named in theme.json');
    }
    if(total>1.2*1024*1024) fail(dir+': folder exceeds 1.2 MB');
    for(const a of new Map(assets.map(a=>[a.name,a])).values()) {
      const p=path.join(dir,a.name);
      if(!fs.existsSync(p)) { fail(p+': missing sprite'); continue; }
      const b=fs.readFileSync(p);
      if(b.length>300*1024) fail(p+': image exceeds 300 KB');
      try { const [w,h,alpha]=dimensions(b); if(w!==a.w||h!==a.h) fail(p+`: wrong image size ${w}×${h}; expected ${a.w}×${a.h}`); if(a.transparent&&!alpha) fail(p+': PNG must be transparent'); } catch(e) { fail(p+': '+e.message); }
    }
  } catch(e) { fail(dir+': '+e.message); }
  if(failures===before) console.log(dir+': OK');
}
const arg=process.argv[2];
if(arg==='--all') {
  try {const index=context.validateThemeIndex(JSON.parse(fs.readFileSync('themes/index.json','utf8'))); for(const id of new Set([index.default,...Object.values(index.days)])) pack(path.join('themes',id));} catch(e) {fail(e.message);}
} else if(arg) pack(arg); else fail('usage: node dev/validate-theme.mjs themes/<id> | --all');
process.exitCode=failures?1:0;
