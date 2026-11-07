'use strict';
// Render the real wallpaper and encode a looping day/night preview.
// Build machine only: Playwright Chromium, gifski and ffprobe are required.
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {spawnSync}=require('node:child_process');
const browserOptions=require('./browser.cjs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const directory=path.join(root,'.cache/preview-frames');

async function main() {
  const localEncoder=path.join(root,'.cache/gifski/win/gifski.exe');
  const encoder=process.env.GIFSKI || (fs.existsSync(localEncoder)?localEncoder:'gifski');
  const probe=spawnSync(encoder,['--version'],{encoding:'utf8'});
  if(probe.status!==0) throw new Error('gifski not found. Set GIFSKI to its executable.');
  fs.mkdirSync(directory,{recursive:true});
  for(const file of fs.readdirSync(directory)) {
    if(/^\d{3}\.png$/.test(file)) fs.unlinkSync(path.join(directory,file));
  }
  const browser=await chromium.launch(browserOptions);
  const fps=15, frames=180, width=1280, height=720;
  try {
    const page=await browser.newPage({viewport:{width,height}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(pathToFileURL(path.join(root,'src/index.html')).href+'?paused=1&quality=high&fireflies=24&hour=13');
    await page.waitForFunction(()=>window.tlouWallpaper?.getStats().ready);
    for(let i=0;i<frames;i++) {
      const seconds=i/fps;
      let hour=13;
      if(seconds>=3 && seconds<5) hour=(13+(seconds-3)*6)%24;
      else if(seconds>=5 && seconds<10) hour=1;
      else if(seconds>=10) hour=(1+(seconds-10)*6)%24;
      const png=await page.evaluate(({hour,time})=>{
        tlouWallpaper.configure({timeMode:'manual',hour,fireflies:24});
        tlouWallpaper.seek(time);
        return document.getElementById('scene').toDataURL('image/png').split(',')[1];
      },{hour,time:19+seconds});
      fs.writeFileSync(path.join(directory,String(i).padStart(3,'0')+'.png'),Buffer.from(png,'base64'));
    }
    if(errors.length) throw new Error(errors.join('\n'));
    // Prove that the selected night scene actually includes visible fireflies.
    const glow=await page.evaluate(()=>{
      const canvas=document.getElementById('scene');
      const sample=document.createElement('canvas');sample.width=canvas.width;sample.height=canvas.height;
      const context=sample.getContext('2d');
      function brightness(count) {
        tlouWallpaper.configure({hour:1,fireflies:count});tlouWallpaper.seek(25);
        context.drawImage(canvas,0,0);
        const data=context.getImageData(0,0,canvas.width,canvas.height).data;
        let sum=0;for(let i=0;i<data.length;i+=4) sum+=data[i]+data[i+1]+data[i+2];
        return sum;
      }
      return [brightness(0),brightness(24)];
    });
    if(glow[1]<=glow[0]) throw new Error('Night preview must contain visible fireflies.');
  } finally {await browser.close();}
  // gifski uses temporal dithering and delta frames to preserve detail while
  // avoiding the huge output of independent full-frame GIF palettes.
  const inputs=Array.from({length:frames},(_,i)=>path.join(directory,String(i).padStart(3,'0')+'.png'));
  const result=spawnSync(encoder,['--quiet','--fps',String(fps),'--width',String(width),'--height',String(height),
    '--quality','90','--motion-quality','90','--lossy-quality','95','--repeat','0',
    '--output',path.join(root,'docs/preview.gif'),...inputs],{encoding:'utf8',timeout:180000});
  if(result.status!==0) throw new Error(result.stderr || result.error);
  const inspection=spawnSync(process.env.FFPROBE || 'ffprobe',['-v','error','-select_streams','v:0',
    '-show_entries','stream=width,height,nb_frames,duration','-of','json',path.join(root,'docs/preview.gif')],{encoding:'utf8'});
  if(inspection.status!==0) throw new Error('ffprobe is required to verify the encoded preview.');
  const stream=JSON.parse(inspection.stdout).streams[0];
  if(stream.width!==width || stream.height!==height || Number(stream.nb_frames)!==frames
      || Math.abs(Number(stream.duration)-frames/fps)>.1) throw new Error('Encoded preview has unexpected dimensions, duration or frame count.');
  console.log(`Preview: ${frames} frames, ${fps} fps, ${width}x${height}, day/night with 24 fireflies`);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
