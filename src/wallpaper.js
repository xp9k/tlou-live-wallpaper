/* TLOU - Live Wallpaper. Dependency-free WebGL cinemagraph renderer.
   Coordinates in the artwork and all masks are normalized, top-left origin.
   Architecture is static. Only explicitly painted material regions deform. */
(() => {
  'use strict';
  const canvas = document.getElementById('scene');
  const still = document.getElementById('still');
  const params = new URLSearchParams(location.search);
  const numberParam = (name, fallback, lo, hi) => {
    const value = params.get(name);
    return value !== null && Number.isFinite(Number(value))
      ? Math.min(hi, Math.max(lo, Number(value))) : fallback;
  };
  const {defaults,particleCounts} = window.TLOUScene;
  const settings = {
    wind: numberParam('wind', defaults.wind, 0, 2),
    light: numberParam('light', defaults.light, 0.5, 1.5),
    dust: numberParam('dust', defaults.dust, 0, 2),
    quality: ['eco', 'high', 'ultra'].includes(params.get('quality')) ? params.get('quality') : defaults.quality,
    fps: numberParam('fps', defaults.fps, 15, 120),
    // An explicit ?hour= selects manual time of day; otherwise follow the clock.
    timeMode: params.has('hour') || params.get('timeMode') === 'manual' ? 'manual' : defaults.timeMode,
    hour: numberParam('hour', defaults.hour, 0, 24),
    fireflies: Math.round(numberParam('fireflies', defaults.fireflies, 0, 64))
  };
  const currentHour = () => {
    if (settings.timeMode === 'manual') return settings.hour;
    const now = new Date();
    return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = params.get('paused') === '1';
  let hostPaused = false;
  let time = numberParam('time', defaults.time, 0, 86400);
  let gl, sceneProgram, dustProgram, fireflyProgram, sceneBuffer, dustBuffer, resources;
  let ready = false, lost = false, destroyed = false, raf = 0, previous = 0;
  let frameCount = 0, measuredFps = 0, statStart = 0, statFrames = 0;
  let adaptiveScale = 1, slowWindows = 0;
  const disposers = [];
  const textures = [];
  const listen = (target, type, fn, options) => {
    target.addEventListener(type, fn, options);
    disposers.push(() => target.removeEventListener(type, fn, options));
  };
  const running = () => ready && !lost && !destroyed && !userPaused && !hostPaused &&
    !document.hidden && !reduced.matches;
  const {vertices,fragment,dustVertex,dustFragment,fireflyVertex,fireflyFragment,materialMaps,preparePlate,particleSeeds,pixelLimits,ranges} = window.TLOUScene;
  function shader(type, source) {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(s); gl.deleteShader(s);
      throw new Error(message);
    }
    return s;
  }
  function program(v, f, uniformNames) {
    const p = gl.createProgram();
    const vs = shader(gl.VERTEX_SHADER, v), fs = shader(gl.FRAGMENT_SHADER, f);
    gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(message);
    }
    return { p, uniforms: Object.fromEntries(uniformNames.map(n => [n, gl.getUniformLocation(p, n)])) };
  }
  function texture(source, unit) {
    const tex = gl.createTexture();
    textures.push(tex);
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  function initialize() {
    sceneProgram=program(vertices,fragment,['uImage','uMasks','uIllumination','uCover','uOffset','uResolution','uTime','uWind','uLight','uHour']);
    dustProgram=program(dustVertex,dustFragment,['uTime','uWind','uScale','uCover','uOffset','uDust','uHour']);
    fireflyProgram=program(fireflyVertex,fireflyFragment,['uTime','uScale','uCover','uOffset','uHour']);
    sceneBuffer=gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER,sceneBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    sceneProgram.attribute=gl.getAttribLocation(sceneProgram.p,'aPosition');
    dustProgram.attribute=gl.getAttribLocation(dustProgram.p,'aSeed');
    fireflyProgram.attribute=gl.getAttribLocation(fireflyProgram.p,'aSeed');
    const particles=particleSeeds();
    dustBuffer=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,dustBuffer);
    gl.bufferData(gl.ARRAY_BUFFER,particles,gl.STATIC_DRAW);
    texture(still,0); texture(resources.masks,1); texture(resources.illumination,2);
    gl.useProgram(sceneProgram.p);
    gl.uniform1i(sceneProgram.uniforms.uImage,0);
    gl.uniform1i(sceneProgram.uniforms.uMasks,1);
    gl.uniform1i(sceneProgram.uniforms.uIllumination,2);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
    gl.clearColor(.03,.035,.02,1);
    ready=true; lost=false;
    resize();
    document.documentElement.classList.remove('context-lost');
    document.documentElement.classList.add('ready');
    schedule();
  }
  function resize() {
    if(!ready || lost || destroyed) return;
    const limits=pixelLimits;
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const pixels=innerWidth*innerHeight*dpr*dpr;
    const scale=dpr*Math.min(1,Math.sqrt(limits[settings.quality]/pixels))*adaptiveScale;
    const w=Math.max(1,Math.round(innerWidth*scale)),h=Math.max(1,Math.round(innerHeight*scale));
    if(canvas.width!==w || canvas.height!==h) {canvas.width=w;canvas.height=h;}
    gl.viewport(0,0,w,h);
    draw();
  }
  function cover() {
    const imageAspect=still.naturalWidth/still.naturalHeight;
    const screenAspect=canvas.width/canvas.height;
    const cx=Math.min(1,screenAspect/imageAspect),cy=Math.min(1,imageAspect/screenAspect);
    return {scale:[cx,cy],offset:[(1-cx)*.66,(1-cy)*.5]};
  }
  function draw() {
    if(!ready || lost || destroyed) return;
    const crop=cover();
    const hour=currentHour();
    gl.disable(gl.BLEND);
    gl.useProgram(sceneProgram.p);
    gl.bindBuffer(gl.ARRAY_BUFFER,sceneBuffer);
    gl.enableVertexAttribArray(sceneProgram.attribute);
    gl.vertexAttribPointer(sceneProgram.attribute,2,gl.FLOAT,false,0,0);
    const u=sceneProgram.uniforms;
    gl.uniform2fv(u.uCover,crop.scale); gl.uniform2fv(u.uOffset,crop.offset);
    gl.uniform2f(u.uResolution,canvas.width,canvas.height);
    gl.uniform1f(u.uTime,time); gl.uniform1f(u.uWind,settings.wind);
    gl.uniform1f(u.uLight,settings.light);
    gl.uniform1f(u.uHour,hour);
    gl.drawArrays(gl.TRIANGLES,0,3);
    gl.disableVertexAttribArray(sceneProgram.attribute);
    if(settings.dust>0) {
      gl.useProgram(dustProgram.p);
      gl.bindBuffer(gl.ARRAY_BUFFER,dustBuffer);
      gl.enableVertexAttribArray(dustProgram.attribute);
      gl.vertexAttribPointer(dustProgram.attribute,4,gl.FLOAT,false,0,0);
      const d=dustProgram.uniforms;
      gl.uniform2fv(d.uCover,crop.scale);gl.uniform2fv(d.uOffset,crop.offset);
      gl.uniform1f(d.uTime,time);gl.uniform1f(d.uWind,settings.wind);
      gl.uniform1f(d.uScale,canvas.height/1080);gl.uniform1f(d.uDust,settings.dust);
      gl.uniform1f(d.uHour,hour);
      gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS,0,particleCounts[settings.quality]);
      gl.disableVertexAttribArray(dustProgram.attribute);gl.disable(gl.BLEND);
    }
    if(settings.fireflies>0) {
      gl.useProgram(fireflyProgram.p);
      gl.bindBuffer(gl.ARRAY_BUFFER,dustBuffer);
      gl.enableVertexAttribArray(fireflyProgram.attribute);
      gl.vertexAttribPointer(fireflyProgram.attribute,4,gl.FLOAT,false,0,0);
      const f=fireflyProgram.uniforms;
      gl.uniform2fv(f.uCover,crop.scale);gl.uniform2fv(f.uOffset,crop.offset);
      gl.uniform1f(f.uTime,time);gl.uniform1f(f.uScale,canvas.height/1080);gl.uniform1f(f.uHour,hour);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS,0,settings.fireflies);
      gl.disableVertexAttribArray(fireflyProgram.attribute);gl.disable(gl.BLEND);
    }
    frameCount++;
  }
  function tick(now) {
    raf=0;
    if(!running()) {previous=0;return;}
    if(!previous) previous=now;
    const elapsed=now-previous;
    const cap=settings.quality==='eco'?Math.min(30,settings.fps):settings.fps;
    if(elapsed>=1000/cap-.6) {
      time+=Math.min(elapsed/1000,.1);previous=now;
      draw();
      statFrames++;
      if(!statStart) statStart=now;
      if(now-statStart>3000) {
        measuredFps=statFrames*1000/(now-statStart);
        if(measuredFps<cap*.72 && settings.quality==='high') slowWindows++; else slowWindows=0;
        if(slowWindows>=3 && settings.quality==='high' && adaptiveScale>.65) {
          adaptiveScale=Math.max(.65,adaptiveScale*.85);slowWindows=0;resize();
        }
        statFrames=0;statStart=now;
      }
    }
    raf=requestAnimationFrame(tick);
  }
  function schedule() {
    if(raf) cancelAnimationFrame(raf);
    raf=0;previous=0;statStart=0;statFrames=0;
    if(running()) raf=requestAnimationFrame(tick);else draw();
  }
  function setPaused(value) {userPaused=Boolean(value);schedule();}
  function configure(values) {
    for(const key of ['wind','dust','light','fps','hour','fireflies']) {
      if(Number.isFinite(Number(values[key]))) {
        settings[key]=Math.max(ranges[key][0],Math.min(ranges[key][1],Number(values[key])));
      }
    }
    settings.fireflies=Math.round(settings.fireflies);
    if(['auto','manual'].includes(values.timeMode)) settings.timeMode=values.timeMode;
    if(['eco','high','ultra'].includes(values.quality)) {
      settings.quality=values.quality;adaptiveScale=1;
    }
    resize();schedule();
  }
  async function fullscreen() {
    try {
      if(document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch(error) {console.warn('Fullscreen is unavailable:',error.message);}
  }
  function destroy() {
    destroyed=true;ready=false;
    cancelAnimationFrame(raf);raf=0;
    disposers.splice(0).forEach(dispose=>dispose());
    if(gl && !lost) {
      textures.forEach(tex=>gl.deleteTexture(tex));
      gl.deleteBuffer(sceneBuffer);gl.deleteBuffer(dustBuffer);
      if(sceneProgram) gl.deleteProgram(sceneProgram.p);
      if(dustProgram) gl.deleteProgram(dustProgram.p);
      if(fireflyProgram) gl.deleteProgram(fireflyProgram.p);
    }
    document.documentElement.classList.remove('ready');
  }
  window.tlouWallpaper=Object.freeze({
    pause:setPaused,configure,fullscreen,destroy,
    seek(seconds) {if(Number.isFinite(seconds)) {time=Math.max(0,seconds);draw();}},
    getStats() {return {ready,lost,paused:!running(),time,frames:frameCount,fps:Math.round(measuredFps),
      resolution:[canvas.width,canvas.height],image:[still.naturalWidth,still.naturalHeight],
      quality:settings.quality,adaptiveScale,hour:currentHour(),settings:{...settings},particles:particleCounts[settings.quality],webgl:gl?'WebGL 1.0':null};}
  });
  // Lively sliders use integer percentages and minutes; dropdowns send indices.
  window.livelyPropertyListener=(name,value)=>{
    if(name==='paused') {setPaused(value===true);return;}
    const choices={quality:['eco','high','ultra'],timeMode:['auto','manual']};
    if(Object.hasOwn(choices,name)) {
      if(Number.isInteger(value) && choices[name][value]!==undefined) configure({[name]:choices[name][value]});
      return;
    }
    if(!['wind','light','dust','fps','hour','fireflies'].includes(name) ||
      typeof value!=='number' || !Number.isFinite(value)) return;
    const divisor=name==='hour'?60:['wind','light','dust'].includes(name)?100:1;
    configure({[name]:value/divisor});
  };
  window.wallpaperPropertyListener={
    setPaused(value) {hostPaused=Boolean(value);schedule();},
    applyUserProperties(properties) {
      const values={};
      for(const key of ['wind','dust','light','quality','fps','timeMode','hour','fireflies']) {
        if(properties[key]) values[key]=properties[key].value;
      }
      configure(values);
    }
  };
  listen(document,'visibilitychange',schedule);
  // While paused, a still frame keeps following the clock once a minute.
  const clock=setInterval(()=>{if(settings.timeMode==='auto' && !running() && !document.hidden) draw();},60000);
  disposers.push(()=>clearInterval(clock));
  listen(window,'resize',resize,{passive:true});
  listen(reduced,'change',schedule);
  listen(window,'keydown',event=>{
    if(event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if(event.code==='Space') {event.preventDefault();setPaused(!userPaused);}
    if(event.code==='KeyF') {event.preventDefault();fullscreen();}
  });
  listen(canvas,'dblclick',fullscreen);
  listen(canvas,'webglcontextlost',event=>{
    event.preventDefault();lost=true;ready=false;cancelAnimationFrame(raf);raf=0;
    document.documentElement.classList.add('context-lost');
  });
  listen(canvas,'webglcontextrestored',()=>{
    if(destroyed) return;
    textures.length=0;
    try {initialize();} catch(error) {console.error('WebGL restore:',error);}
  });
  // A data-URL asset also works under file:// in wallpaper hosts and regular browsers.
  still.onload=()=>{
    try {
      if(params.get('static')==='1') return;
      gl=canvas.getContext('webgl',{alpha:false,antialias:false,depth:false,stencil:false,
        premultipliedAlpha:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
      if(!gl) return; // The clean photographic fallback is already visible.
      resources=materialMaps(still);
      initialize();
    } catch(error) {console.error('Wallpaper initialization:',error);}
    finally {delete window.TLOU_IMAGE;}
  };
  still.onerror=()=>console.error('Unable to load the local wallpaper image.');
  preparePlate().then(plate => {
    still.src = plate.toDataURL ? plate.toDataURL('image/png') : plate.src;
  }).catch(error => console.error('4K plate composition:',error));
})();
