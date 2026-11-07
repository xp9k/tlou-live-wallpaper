'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');
const {zipSync} = require('fflate');
const browserOptions = require('./browser.cjs');
const {chromium} = require('playwright');
const scene = require('../src/scene.js');
const root = path.resolve(__dirname,'..');
const out = path.join(root,'dist');
const id = 'org.tlou.stillalive';
const version = require('../package.json').version;
const staging = path.join(root,'.cache/release');
function write(file,content) {
  fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,content);
}
function findQsb() {
  if(process.env.QSB) return process.env.QSB;
  const python = spawnSync('python',['-c','import pathlib, PySide6; print(pathlib.Path(PySide6.__file__).parent / "qsb.exe")'],{encoding:'utf8'});
  const candidate = python.stdout?.trim();
  if(candidate && fs.existsSync(candidate)) return candidate;
  for(const candidate of ['qsb','qsb6','/usr/lib/qt6/bin/qsb','/usr/lib64/qt6/bin/qsb']) {
    if(spawnSync(candidate,['--version'],{encoding:'utf8',timeout:5000}).status===0) return candidate;
  }
  throw new Error('Qt 6 qsb not found. Set QSB to the Qt Shader Tools executable (build machine only).');
}
const block = `layout(std140, binding=0) uniform buf {
  mat4 qt_Matrix;
  float qt_Opacity;
  vec2 uCover;
  vec2 uOffset;
  vec2 uResolution;
  float uTime;
  float uWind;
  float uLight;
  float uScale;
  float uDust;
  float uParticleCount;
  float uSeedCount;
  float uHour;
};\n`;
function stripDeclarations(shader) {
  return shader.replace(/^\s*(precision|uniform|varying|attribute)\s+[^;]+;/gm,'').trim();
}
function qtShaders() {
  const fragment = stripDeclarations(scene.fragment)
    .replace('vec2(vUV.x, 1. - vUV.y)','vUV')
    .replaceAll('texture2D(', 'texture(')
    .replace('gl_FragColor = vec4(max(vec3(0.), color + dither), 1.);',
      'fragColor = vec4(max(vec3(0.), color + dither), 1.) * qt_Opacity;');
  const dustFragment = stripDeclarations(scene.dustFragment)
    .replace('gl_PointCoord','vPointCoord')
    .replace('gl_FragColor = vec4(vec3(.85, .85, .74), a * vAlpha * uDust);',
      'float alpha = a * vAlpha * uDust * qt_Opacity;\n      fragColor = vec4(vec3(.85, .85, .74) * alpha, alpha);');
  // The firefly glow is already premultiplied.
  const fireflyFragment = stripDeclarations(scene.fireflyFragment)
    .replace('gl_PointCoord','vPointCoord')
    .replace('gl_FragColor = glow;','fragColor = glow * qt_Opacity;');
  return {
    'scene.frag': `#version 440\nlayout(location=0) in vec2 qt_TexCoord0;\n#define vUV qt_TexCoord0\nlayout(location=0) out vec4 fragColor;\n${block}
layout(binding=1) uniform sampler2D uImage;
layout(binding=2) uniform sampler2D uMasks;
layout(binding=3) uniform sampler2D uIllumination;
${fragment}\n`,
    'dust.vert': particleVertex(scene.dustVertex),
    'dust.frag': particleFragment(dustFragment),
    'firefly.vert': particleVertex(scene.fireflyVertex),
    'firefly.frag': particleFragment(fireflyFragment)
  };
}
function particleFragment(body) {
  return `#version 440
layout(location=0) in vec2 vPointCoord;
layout(location=1) in float vAlpha;
layout(location=2) in float vDepth;
layout(location=0) out vec4 fragColor;
${block}
${body}\n`;
}
// Points rendered as a GridMesh: four mesh columns per particle (count in
// uParticleCount). The outside columns collapse to the edge's midpoint, so
// triangles connecting adjacent particles have zero area.
function particleVertex(source) {
  const motion = stripDeclarations(source)
    .replace('void main() {','void particle(vec4 aSeed, out vec4 position, out float pointSize) {')
    .replace('gl_Position =','position =').replace('gl_PointSize =','pointSize =');
  return `#version 440
layout(location=0) in vec4 qt_Vertex;
layout(location=1) in vec2 qt_MultiTexCoord0;
layout(location=0) out vec2 vPointCoord;
layout(location=1) out float vAlpha;
layout(location=2) out float vDepth;
${block}
layout(binding=4) uniform sampler2D uSeeds;
${motion}
void main() {
  float column = floor(qt_MultiTexCoord0.x * (uParticleCount * 4. - 1.) + .5);
  float index = floor(column / 4.);
  float corner = mod(column, 4.);
  vec4 position;
  float pointSize;
  float seedWidth = min(2048., uSeedCount);
  float seedRows = ceil(uSeedCount / seedWidth) * 2.;
  vec2 seedUV = vec2((mod(index, seedWidth) + .5) / seedWidth,
    (floor(index / seedWidth) * 2. + .5) / seedRows);
  vec3 seedRGB = texture(uSeeds, seedUV).rgb;
  float seedW = texture(uSeeds, seedUV + vec2(0., 1. / seedRows)).r;
  particle(vec4(seedRGB, seedW), position, pointSize);
  vec2 local = vec2(corner < 1.5 ? -.5 : .5,
    (corner < .5 || corner > 2.5) ? 0. : qt_MultiTexCoord0.y - .5);
  vPointCoord = local + .5;
  vec2 center = vec2(position.x * .5 + .5, .5 - position.y * .5) * uResolution;
  gl_Position = qt_Matrix * vec4(center + local * pointSize, 0., 1.);
}\n`;
}
async function exportTextures(destination) {
  const browser = await chromium.launch(browserOptions);
  try {
    const page = await browser.newPage();
    await page.route('**/wallpaper.js', route=>route.fulfill({body:'',contentType:'text/javascript'}));
    await page.goto(pathToFileURL(path.join(root,'src/index.html')).href+'?static=1');
    // Prepare the native textures using the source scene's Canvas filters.
    const result = await page.evaluate(async()=>{
      const plate=await TLOUScene.preparePlate();
      const image=new Image();
      image.src=plate.toDataURL ? plate.toDataURL('image/png') : plate.src;
      await image.decode();
      const maps=TLOUScene.materialMaps(image);
      const seeds=TLOUScene.particleSeeds();
      const canvas=document.createElement('canvas');
      const count=seeds.length/4;
      canvas.width=Math.min(2048,count);canvas.height=Math.ceil(count/canvas.width)*2;
      const ctx=canvas.getContext('2d');
      // Store seeds in RGB + alpha without premultiplication loss: alpha is held
      // opaque and the fourth seed is stored in a second row's red channel.
      const data=ctx.createImageData(canvas.width,canvas.height);
      for(let i=0;i<count;i++) {
        const pixel=(Math.floor(i/canvas.width)*canvas.width*2+i%canvas.width)*4;
        for(let c=0;c<3;c++) data.data[pixel+c]=Math.round(seeds[i*4+c]*255);
        data.data[pixel+3]=255;
        data.data[pixel+canvas.width*4]=Math.round(seeds[i*4+3]*255);
        data.data[pixel+canvas.width*4+3]=255;
      }
      ctx.putImageData(data,0,0);
      return {plate:image.src,masks:maps.masks.toDataURL('image/png'),
        illumination:maps.illumination.toDataURL('image/png'),seeds:canvas.toDataURL('image/png')};
    });
    for(const [name,data] of Object.entries(result)) write(path.join(destination,`${name}.png`),Buffer.from(data.split(',')[1],'base64'));
  } finally { await browser.close(); }
}
async function main() {
  if(process.argv.length>2) throw new Error('Usage: node build/build.cjs');
  const revision=sceneRevision();
  const qsb=findQsb();
  // Recreate staging so files removed from the sources never leak into a package.
  fs.rmSync(staging,{recursive:true,force:true});
  const destination=path.join(staging,'native',id);
  fs.cpSync(path.join(root,'plasma'),destination,{recursive:true});
  const contents=path.join(destination,'contents');
  write(path.join(contents,'ui/SceneConfig.js'),`.pragma library\nvar defaults = ${JSON.stringify(scene.defaults)};\nvar particleCounts = ${JSON.stringify(scene.particleCounts)};\nvar pixelLimits = ${JSON.stringify(scene.pixelLimits)};\n`);
  const entries=Object.entries(scene.defaults).filter(([name])=>name!=='time').map(([name,value])=>
    `    <entry name="${name}" type="${typeof value==='string'?'String':'Double'}"><default>${value}</default></entry>`);
  write(path.join(contents,'config/main.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0"><kcfgfile name=""/><group name="General">\n${entries.join('\n')}\n    <entry name="paused" type="Bool"><default>false</default></entry>\n    <entry name="autoPause" type="Bool"><default>true</default></entry>\n</group></kcfg>\n`);
  await exportTextures(path.join(contents,'images'));
  // GLSL sources stay in the cache; the package ships only compiled .qsb files.
  for(const [name,shader] of Object.entries(qtShaders())) {
    const source=path.join(staging,'shaders',name);write(source,shader);
    const target=path.join(contents,'shaders',name+'.qsb');fs.mkdirSync(path.dirname(target),{recursive:true});
    const result=spawnSync(qsb,['--qsbversion','64','--glsl','100 es,120,150','--hlsl','50','--msl','12','-o',target,source],{encoding:'utf8',timeout:30000});
    if(result.status!==0) throw new Error(`qsb ${name}: ${result.stderr || result.error}`);
  }
  write(path.join(staging,'scene-revision.json'),JSON.stringify({revision},null,2));

  const plasma5=path.join(staging,'mos12',id);
  require('./plasma5.cjs').preparePlasma5(destination,plasma5,qtShaders());
  for(const target of ['mos12','mos13']) {
    const sourceName=`tlou-wallpaper-${version}`;
    const sourceParent=path.join(staging,'sources',target);
    const sourceDirectory=path.join(sourceParent,sourceName);
    fs.mkdirSync(sourceDirectory,{recursive:true});
    fs.cpSync(target==='mos12'?plasma5:destination,path.join(sourceDirectory,id),{recursive:true});
    fs.copyFileSync(path.join(root,`docs/${target}.md`),path.join(sourceDirectory,`README.${target}.md`));
    fs.copyFileSync(path.join(root,'docs/settings.png'),path.join(sourceDirectory,'settings.png'));
    const sourceArchive=path.join(root,`.cache/rpm/${target}/SOURCES`,sourceName+'.tar.gz');
    fs.mkdirSync(path.dirname(sourceArchive),{recursive:true});
    const tar=spawnSync('tar',['-czf',sourceArchive,'-C',sourceParent,sourceName],{encoding:'utf8',timeout:30000});
    if(tar.status!==0) throw new Error(`Source archive: ${tar.stderr || tar.error}`);
  }

  const windows=archiveEntries(path.join(root,'src'));
  windows['LivelyInfo.json']=fs.readFileSync(path.join(root,'packaging/LivelyInfo.json'));
  const properties={};
  const dropdown=(name,text,items,values)=>{
    properties[name]={type:'dropdown',text,items,value:values.indexOf(scene.defaults[name])};
  };
  const slider=(name,text,scale=1)=>{
    properties[name]={type:'slider',text,min:Math.round(scene.ranges[name][0]*scale),
      max:Math.round(scene.ranges[name][1]*scale),step:1,value:Math.round(scene.defaults[name]*scale)};
  };
  dropdown('timeMode','Время суток',['По часам компьютера','Вручную'],['auto','manual']);
  slider('hour','Ручное время суток (минуты от полуночи)',60);
  slider('fireflies','Светлячки ночью');
  slider('wind','Сила ветра (%)',100);
  slider('light','Яркость (%)',100);
  slider('dust','Количество пыли (%)',100);
  dropdown('quality','Качество',['Экономичное','Высокое','Ультра'],['eco','high','ultra']);
  slider('fps','Частота кадров (FPS)');
  properties.paused={type:'checkbox',text:'Пауза анимации',value:false};
  windows['LivelyProperties.json']=Buffer.from(JSON.stringify(properties,null,2)+'\n');
  windows['README.txt']=fs.readFileSync(path.join(root,'docs/windows.md'));
  windows['thumbnail.jpg']=fs.readFileSync(path.join(root,'docs/screenshot.jpg'));
  windows['preview.gif']=fs.readFileSync(path.join(root,'docs/preview.gif'));
  fs.rmSync(out,{recursive:true,force:true});
  write(path.join(out,`tlou-wallpaper-win-${version}.zip`),zipSync(windows,{level:6}));
  console.log(`Windows theme: dist/tlou-wallpaper-win-${version}.zip`);
  console.log('Native package and RPM source archive prepared under .cache/');
}
function archiveEntries(directory,prefix='') {
  const files={};
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name), name=prefix+entry.name;
    if(entry.isDirectory()) Object.assign(files,archiveEntries(file,name+'/'));
    else files[name]=fs.readFileSync(file);
  }
  return files;
}
function sceneRevision() {
  const sources=['src/scene.js',...fs.readdirSync(path.join(root,'src/assets')).sort().map(n=>'src/assets/'+n)];
  const hash=createHash('sha256');
  for(const source of sources) hash.update(fs.readFileSync(path.join(root,source)));
  return hash.digest('hex');
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={qtShaders,sceneRevision};
