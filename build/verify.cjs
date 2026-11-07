'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {createHash}=require('node:crypto');
const {unzipSync}=require('fflate');
const browserOptions=require('./browser.cjs');
const {chromium}=require('playwright');
const scene=require('../src/scene.js');
const root=path.resolve(__dirname,'..');
async function main() {
  const native=path.join(root,'.cache/release/native/org.tlou.stillalive');
  const sources=['src/scene.js',...fs.readdirSync(path.join(root,'src/assets')).sort().map(n=>'src/assets/'+n)];
  const hash=createHash('sha256');for(const file of sources) hash.update(fs.readFileSync(path.join(root,file)));
  const revision=hash.digest('hex');
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'.cache/release/scene-revision.json'))).revision,revision,'Staging is older than the scene sources');
  // The Plasma package must contain exactly the runtime files.
  const nativeFiles=['contents/config/main.xml','contents/images/illumination.png','contents/images/masks.png',
    'contents/images/plate.png','contents/images/seeds.png','contents/shaders/dust.frag.qsb','contents/shaders/dust.vert.qsb',
    'contents/shaders/firefly.frag.qsb','contents/shaders/firefly.vert.qsb',
    'contents/shaders/scene.frag.qsb','contents/ui/Scene.qml','contents/ui/SceneConfig.js','contents/ui/config.qml',
    'contents/ui/main.qml','metadata.json'];
  assert.deepEqual(listFiles(native),nativeFiles);
  for(const name of nativeFiles) assert.ok(fs.statSync(path.join(native,name)).size,'Empty native entry: '+name);
  const plasma5=path.join(root,'.cache/release/mos12/org.tlou.stillalive');
  const plasma5Files=nativeFiles.filter(name=>!name.endsWith('.qsb'))
    .concat('contents/ui/ShaderSources.js').sort();
  assert.deepEqual(listFiles(plasma5),plasma5Files);
  for(const name of plasma5Files) assert.ok(fs.statSync(path.join(plasma5,name)).size,'Empty Plasma 5 entry: '+name);
  for(const name of nativeFiles.filter(name=>name.startsWith('contents/images/') || name.startsWith('contents/config/') || name.endsWith('SceneConfig.js'))) {
    assert.ok(fs.readFileSync(path.join(native,name)).equals(fs.readFileSync(path.join(plasma5,name))),'Shared native asset: '+name);
  }
  const plasma5Metadata=JSON.parse(fs.readFileSync(path.join(plasma5,'metadata.json')));
  assert.equal(plasma5Metadata.KPlugin.Version,require('../package.json').version);
  assert.equal(plasma5Metadata.KPlugin.Id,'org.tlou.stillalive');
  assert.equal(plasma5Metadata.KPlugin.Name,'TLOU - Live Wallpaper');
  assert.equal(plasma5Metadata['X-Plasma-API-Minimum-Version'],'5.27');
  const qt5Main=fs.readFileSync(path.join(plasma5,'contents/ui/main.qml'),'utf8');
  assert.doesNotMatch(qt5Main,/WallpaperItem|org\.kde\.plasma\.plasmoid|^import QtQuick$/m);
  assert.match(qt5Main,/id: root/);
  assert.doesNotMatch(fs.readFileSync(path.join(plasma5,'contents/ui/Scene.qml'),'utf8'),/\.qsb/);
  const qt5Shaders=require('./plasma5.cjs').shadersForQt5(require('./build.cjs').qtShaders());
  assert.equal(Object.keys(qt5Shaders).length,5);
  for(const shader of Object.values(qt5Shaders)) {
    assert.doesNotMatch(shader,/#version 440|layout\(|\btexture\(|\bgl_PointCoord\b/);
    assert.match(shader,/void main\(/);
  }
  const metadata=JSON.parse(fs.readFileSync(path.join(native,'metadata.json')));
  assert.equal(metadata.KPackageStructure,'Plasma/Wallpaper');
  assert.equal(metadata.KPlugin.Id,'org.tlou.stillalive');
  assert.equal(metadata.KPlugin.Name,'TLOU - Live Wallpaper');
  assert.equal(metadata.KPlugin.Version,require('../package.json').version,'Plasma metadata version must match package.json');
  assert.match(fs.readFileSync(path.join(native,'contents/config/main.xml'),'utf8'),/<entry name="autoPause" type="Bool"><default>true<\/default><\/entry>/);
  assert.match(fs.readFileSync(path.join(native,'contents/config/main.xml'),'utf8'),/<entry name="timeMode" type="String"><default>auto<\/default><\/entry>[\s\S]*<entry name="hour" type="Double"><default>13<\/default><\/entry>/);
  assert.match(fs.readFileSync(path.join(native,'contents/config/main.xml'),'utf8'),/<entry name="fireflies" type="Double"><default>24<\/default><\/entry>/);
  const version=require('../package.json').version;
  const bundle=unzipSync(fs.readFileSync(path.join(root,`dist/tlou-wallpaper-win-${version}.zip`)));
  const themeDirectory=path.join(root,'.cache/windows-theme');
  fs.rmSync(themeDirectory,{recursive:true,force:true});
  for(const [name,bytes] of Object.entries(bundle)) {
    const target=path.resolve(themeDirectory,name);
    assert.ok(target.startsWith(themeDirectory+path.sep),'Archive path must stay in theme directory');
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);
  }
  const info=JSON.parse(Buffer.from(bundle['LivelyInfo.json']).toString());
  assert.equal(info.Type,1);assert.equal(info.FileName,'index.html');assert.equal(info.IsAbsolutePath,false);
  assert.equal(info.Title,'TLOU - Live Wallpaper');
  assert.ok(Buffer.from(bundle['preview.gif']).equals(fs.readFileSync(path.join(root,'docs/preview.gif'))),'Windows theme must include the current animated preview');
  // The Lively theme must contain exactly the runtime files plus import metadata and the guide.
  const windowsFiles=['LivelyInfo.json','LivelyProperties.json','README.txt','assets/scene-fireflies.js','assets/scene-image-native.js',
    'index.html','preview.gif','scene.js','style.css','thumbnail.jpg','wallpaper.js'];
  assert.deepEqual(Object.keys(bundle).sort(),windowsFiles);
  assert.equal(info.Thumbnail,'thumbnail.jpg');assert.equal(info.Preview,'preview.gif');
  for(const file of windowsFiles) assert.ok(bundle[file].length,'Empty Windows entry: '+file);
  const properties=JSON.parse(Buffer.from(bundle['LivelyProperties.json']).toString());
  assert.deepEqual(Object.keys(properties).sort(),['dust','fireflies','fps','hour','light','paused','quality','timeMode','wind']);
  const browser=await chromium.launch(browserOptions);
  try {
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('console',msg=>{if(msg.type()==='error') errors.push(msg.text());});
    for(const entry of ['src/index.html','.cache/windows-theme/index.html']) {
      await page.goto(pathToFileURL(path.join(root,entry)).href+'?paused=1&time=19&hour=13');
      await page.waitForFunction(()=>window.tlouWallpaper?.getStats().ready);
      const stats=await page.evaluate(()=>tlouWallpaper.getStats());
      assert.equal(stats.paused,true);assert.equal(stats.particles,scene.particleCounts.ultra);
      assert.equal(stats.settings.timeMode,'manual');assert.equal(stats.hour,13);
      // Replay the actual menu payloads, including saved values after a fresh load.
      await page.evaluate(properties=>{
        for(const [name,property] of Object.entries(properties)) livelyPropertyListener(name,property.value);
      },properties);
      const initial=await page.evaluate(()=>tlouWallpaper.getStats());
      for(const name of Object.keys(properties).filter(name=>name!=='paused')) {
        assert.equal(initial.settings[name],scene.defaults[name],'Lively default: '+name);
      }
      const saved={timeMode:1,hour:1290,fireflies:40,wind:75,light:125,dust:50,quality:0,fps:24,paused:true};
      for(let load=0;load<2;load++) {
        if(load) {
          await page.reload();
          await page.waitForFunction(()=>window.tlouWallpaper?.getStats().ready);
        }
        await page.evaluate(values=>{
          for(const [name,value] of Object.entries(values)) livelyPropertyListener(name,value);
        },saved);
        const changed=await page.evaluate(()=>tlouWallpaper.getStats());
        assert.deepEqual(changed.settings,{wind:.75,light:1.25,dust:.5,quality:'eco',fps:24,timeMode:'manual',hour:21.5,fireflies:40});
        assert.equal(changed.hour,21.5);assert.equal(changed.paused,true);
      }
      await page.evaluate(properties=>{
        for(const [name,property] of Object.entries(properties)) livelyPropertyListener(name,property.value);
        livelyPropertyListener('quality',99);livelyPropertyListener('hour',null);
        livelyPropertyListener('unknown',10);
        tlouWallpaper.pause(true);tlouWallpaper.configure({timeMode:'manual',hour:13});
        tlouWallpaper.seek(19);
      },properties);
      assert.equal((await page.evaluate(()=>tlouWallpaper.getStats())).quality,scene.defaults.quality);
      // Night must be clearly darker than midday. Frames are read right after a synchronous draw.
      const brightness=await page.evaluate(()=>{
        const read=()=>{
          const c=document.createElement('canvas');c.width=64;c.height=36;
          const x=c.getContext('2d');x.drawImage(document.getElementById('scene'),0,0,64,36);
          const d=x.getImageData(0,0,64,36).data;let sum=0;
          for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
          return sum/(d.length/4*765);
        };
        const result={};
        for(const hour of [13,19,1]) {tlouWallpaper.configure({hour});result[hour]=read();}
        tlouWallpaper.configure({hour:13});return result;
      });
      assert.ok(brightness[13]>0.05 && brightness[1]<brightness[13]*.5,'Night must be darker than midday: '+JSON.stringify(brightness));
      // Fireflies glow in the window opening at night and are absent by day.
      const glow=await page.evaluate(()=>{
        const scene=document.getElementById('scene');
        const read=()=>{
          const w=scene.width,h=scene.height,c=document.createElement('canvas');c.width=w;c.height=h;
          const x=c.getContext('2d');x.drawImage(scene,0,0);
          const d=x.getImageData(Math.round(w*.5),0,Math.round(w*.3),Math.round(h*.8)).data;let sum=0;
          for(let i=0;i<d.length;i+=4) sum+=d[i]+d[i+1]+d[i+2];
          return sum;
        };
        const result={};
        for(const [hour,fireflies] of [[1,0],[1,64],[13,0],[13,64]]) {
          tlouWallpaper.configure({hour,fireflies});result[hour+'/'+fireflies]=read();
        }
        tlouWallpaper.configure({hour:13,fireflies:24});return result;
      });
      assert.ok(glow['1/64']>glow['1/0']*1.01,'Fireflies must glow at night: '+JSON.stringify(glow));
      assert.equal(glow['13/64'],glow['13/0'],'Fireflies must be invisible by day');
      await page.evaluate(()=>tlouWallpaper.configure({quality:'eco',wind:9,dust:-1}));
      const eco=await page.evaluate(()=>tlouWallpaper.getStats());
      assert.equal(eco.particles,scene.particleCounts.eco);assert.equal(eco.settings.wind,2);assert.equal(eco.settings.dust,0);
      await page.evaluate(()=>{tlouWallpaper.pause(false);wallpaperPropertyListener.setPaused(true);});
      assert.equal((await page.evaluate(()=>tlouWallpaper.getStats())).paused,true);
      await page.evaluate(()=>wallpaperPropertyListener.setPaused(false));
      await page.waitForFunction(()=>tlouWallpaper.getStats().time>19);
      await page.evaluate(()=>tlouWallpaper.pause(true));
      const time=await page.evaluate(()=>tlouWallpaper.getStats().time);
      await page.waitForTimeout(150);
      assert.equal((await page.evaluate(()=>tlouWallpaper.getStats())).time,time);
      await page.evaluate(()=>{tlouWallpaper.configure({quality:'ultra',wind:1,dust:0});tlouWallpaper.seek(19);});
      await page.screenshot({path:path.join(root,entry.startsWith('src/')?'.cache/scene-source.png':'.cache/scene-windows.png'),animations:'disabled'});
      await page.setViewportSize({width:720,height:1280});
      await page.waitForFunction(()=>tlouWallpaper.getStats().resolution[0]===720 && tlouWallpaper.getStats().resolution[1]===1280);
      assert.deepEqual((await page.evaluate(()=>tlouWallpaper.getStats())).resolution,[720,1280]);
      await page.setViewportSize({width:1280,height:720});
      await page.waitForFunction(()=>tlouWallpaper.getStats().resolution[0]===1280);
    }
    assert.ok(fs.readFileSync(path.join(root,'.cache/scene-source.png')).equals(fs.readFileSync(path.join(root,'.cache/scene-windows.png'))),'Windows archive must preserve source rendering');
    assert.deepEqual(errors,[]);

    console.log('PASS: exact package contents, native staging, Lively menu defaults, changes and saved-value replay, standalone Windows rendering, pause/resume, limits, quality and portrait resize');
  } finally {await browser.close();}
}
function listFiles(directory,prefix='') {
  return fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()
    ? listFiles(path.join(directory,entry.name),prefix+entry.name+'/') : [prefix+entry.name]).sort();
}
main().catch(error=>{console.error(error);process.exitCode=1;});
