/* Scene sources and build-time image preparation for the MOS 13 wallpaper. */
(function(root) {
'use strict';
  const defaults = Object.freeze({wind:1,light:1,dust:1.4,quality:'ultra',fps:60,timeMode:'auto',hour:13,fireflies:24,time:19});
  const particleCounts = Object.freeze({eco:1920,high:4800,ultra:4800});
  const pixelLimits = Object.freeze({eco:1440000,high:4200000,ultra:8294400});
  const ranges = Object.freeze({wind:[0,2],dust:[0,2],light:[.5,1.5],fps:[15,120],hour:[0,24],fireflies:[0,64]});
  // Time of day, hour 0..24 local time. x: daylight (0 night, 1 day),
  // y: golden hour. Summer day: sunrise 6:00, noon 13:00, sunset 20:00.
  const daylight = `
    vec2 daylight(float hour) {
      float d = hour - 6.;
      float sun = d >= 0. && d <= 14. ? sin(d / 14. * 3.14159265)
        : -sin(mod(d - 14., 24.) / 10. * 3.14159265);
      float day = smoothstep(-.35, .2, sun);
      float golden = smoothstep(-.3, .02, sun) * (1. - smoothstep(.04, .5, sun));
      return vec2(day, golden);
    }`;
  function particleSeeds() {
    let seed=42017;
    return Float32Array.from({length:Math.max(...Object.values(particleCounts))*4},()=>{
      seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;
    });
  }
  const vertices = `
    attribute vec2 aPosition;
    varying vec2 vUV;
    void main() {
      vUV = aPosition * .5 + .5;
      gl_Position = vec4(aPosition, 0., 1.);
    }`;
  const fragment = `
    precision highp float;
    varying vec2 vUV;
    uniform sampler2D uImage;
    uniform sampler2D uMasks;
    uniform sampler2D uIllumination;
    uniform vec2 uCover;
    uniform vec2 uOffset;
    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uWind;
    uniform float uLight;
    uniform float uHour;
    ${daylight}
    float lum(vec3 c) { return dot(c, vec3(.2126, .7152, .0722)); }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    void main() {
      vec2 uv = vec2(vUV.x, 1. - vUV.y) * uCover + uOffset;
      vec4 mask = texture2D(uMasks, uv);
      float t = uTime;
      float gust = .7 + .20 * sin(t * .29) + .10 * sin(t * .73 + 2.3);
      float breeze = sin(t * .82 - uv.y * 3.2);
      float billow = breeze + .34 * sin(t * 1.31 - uv.y * 5.1 + uv.x * 3.);
      // Cloth is held at the top. Large smooth folds; no watery high frequency ripples.
      float hang = .12 + .88 * pow(uv.y, 1.35);
      float curtain = mask.r;
      float rightCurtain = smoothstep(.7, .8, uv.x);
      vec2 cloth = vec2(
        billow * .0027 * hang * mix(1., -.78, rightCurtain),
        sin(t * .87 - uv.y * 2.8 + rightCurtain * 1.6) * .0007 * hang
      );
      // The sun-rotted loose ends respond independently, with a little more freedom.
      float fringe = smoothstep(.62, .97, uv.y);
      cloth.x += sin(t * 1.63 + uv.x * 79. - uv.y * 3.) * .00165 * fringe * fringe;
      cloth.y += cos(t * 1.36 + uv.x * 91.) * .00085 * fringe;
      vec2 delta = cloth * curtain;
      // Each vine segment has a coherent, slightly different sway.
      float leafPhase = uv.y * 14. + uv.x * 8.;
      float stem = sin(t * 1.05 + leafPhase) + .32 * sin(t * 1.87 + leafPhase * .6);
      vec2 leaf = vec2(stem * .00125, sin(t * 1.12 + leafPhase + .8) * .00085);
      delta += leaf * mask.g * (1. - curtain);
      vec2 sampleUV = clamp(uv + delta * uWind * gust, vec2(.001), vec2(.999));
      vec3 color = texture2D(uImage, sampleUV).rgb;

      // Reproject the low-frequency illumination, keeping the linen's weave.
      // This separates the moving leaf shadow from the moving cloth underneath.
      vec2 shadowDrift = vec2(
        sin(t * .79 + uv.y * 2.4) * .0028 + sin(t * 1.29) * .00065,
        cos(t * .64 + uv.x * 4.3) * .0017
      ) * gust * uWind;
      float illuminationHere = max(.055, texture2D(uIllumination, sampleUV).r);
      float illuminationMoved = max(.055, texture2D(uIllumination, sampleUV + shadowDrift).r);
      float ratio = clamp(illuminationMoved / illuminationHere, .77, 1.23);
      float receiver = curtain * smoothstep(.23, .56, uv.x) * (1. - fringe * .65);
      color *= mix(1., ratio, receiver * .82);

      // Small changes of transmitted light as the leaves turn toward the sun.
      // Keep the source leaf roughness and soft diffuse light; no synthetic gloss pulse.
      float clouds = .986 + .009 * sin(t * .14) + .005 * sin(t * .31 + 1.8);
      color *= mix(1., clouds, mask.b);

      // Very faint, occluded light shafts. Broad and soft, never opaque cones.
      vec2 ray = uv - vec2(.76, -.13);
      float slope = ray.x / max(.1, ray.y);
      float bands = pow(.5 + .5 * sin(slope * 37. + sin(t * .22) * .16), 12.);
      float beam = bands * exp(-pow((slope + .38) * 2.3, 2.));
      float air = smoothstep(.10, .44, uv.y) * (1. - smoothstep(.72, 1.05, uv.y));
      float occlusion = (1. - curtain * .94) * (1. - mask.g * .8);
      vec2 dl = daylight(uHour);
      color += vec3(.92, .90, .68) * beam * air * occlusion * .007 * dl.x * (1. + dl.y * 2.5);
      // Golden hour: warmer and slightly dimmer light.
      color *= mix(vec3(1.), vec3(1.08, .93, .74), dl.y);
      // Night: dim cold moonlight; the window stays the brightest area.
      vec3 moon = mix(vec3(lum(color)), color, .3) * vec3(.62, .74, 1.)
        * (.08 + .5 * illuminationHere * illuminationHere);
      color = mix(moon, color, dl.x);
      color *= uLight;

      // Sub-LSB dither prevents banding in the deep olive shadows.
      float dither = (hash(gl_FragCoord.xy) - .5) / 510.;
      gl_FragColor = vec4(max(vec3(0.), color + dither), 1.);
    }`;
  const dustVertex = `
    precision highp float;
    attribute vec4 aSeed;
    uniform float uTime;
    uniform float uWind;
    uniform float uScale;
    uniform vec2 uCover;
    uniform vec2 uOffset;
    uniform float uHour;
    varying float vAlpha;
    varying float vDepth;
    ${daylight}
    void main() {
      float t = uTime;
      float z = aSeed.z;
      // Three spatial scales share the same gentle airflow, without moving in lockstep.
      float side = 1. - step(.24, aSeed.w);
      float speed = .35 + z * z * 1.5 + side * .65;
      float rightCycle = fract(aSeed.x + t * .005 * speed * (.3 + uWind));
      float x = mix(fract(aSeed.x + t * .00065 * speed * (.3 + uWind)), .84 + rightCycle * .16, side);
      float y = fract(aSeed.y - t * (.00065 + z * .0016 + side * .0012));
      x += (sin(t * .21 + aSeed.w * 35.) * .010
          + sin(t * .47 + aSeed.y * 19.) * .0024) * uWind * speed;
      y += cos(t * .18 + aSeed.x * 24.) * .006 * speed;
      vec2 screen = (vec2(x, y) - uOffset) / uCover;
      gl_Position = vec4(screen.x * 2. - 1., 1. - screen.y * 2., 0., 1.);
      float nearLens = smoothstep(.96, 1., z);
      gl_PointSize = (.85 + z * 2.2 + nearLens * 5.5) * uScale;
      float shaft = exp(-pow((x - (.72 - y * .27)) / .21, 2.));
      float windowLight = exp(-pow((x - .68) / .22, 2.) - pow((y - .40) / .5, 2.));
      float light = .10 + .75 * shaft + .20 * windowLight + side * .42;
      float fade = smoothstep(.0, .12, y) * (1. - smoothstep(.88, 1., y))
                 * smoothstep(0., .04, x) * (1. - smoothstep(.985, 1.03, x));
      fade *= mix(1., smoothstep(0., .10, rightCycle) * (1. - smoothstep(.90, 1., rightCycle)), side);
      float turn = .64 + .36 * pow(.5 + .5 * sin(t * .48 + aSeed.w * 71.), 2.);
      vec2 dl = daylight(uHour);
      // Dust is only visible in light: faint at night, brighter in low golden sun.
      vAlpha = light * fade * turn * (.16 + z * .28) * (1. - nearLens * .46)
        * mix(.12, 1., dl.x) * (1. + dl.y * .35);
      vDepth = nearLens;
    }`;
  const dustFragment = `
    precision mediump float;
    uniform float uDust;
    varying float vAlpha;
    varying float vDepth;
    void main() {
      float r = length(gl_PointCoord - .5) * 2.;
      float a = exp(-r * r * mix(3.8, 2.6, vDepth)) * (1. - smoothstep(.55, 1., r));
      // Neutral ivory spores, with a soft out-of-focus fringe close to the lens.
      gl_FragColor = vec4(vec3(.85, .85, .74), a * vAlpha * uDust);
    }`;
  // Fireflies outside the window, visible from dusk to dawn. They reuse the
  // dust seeds, decorrelated, and drift slowly inside the window opening.
  const fireflyVertex = `
    precision highp float;
    attribute vec4 aSeed;
    uniform float uTime;
    uniform float uScale;
    uniform vec2 uCover;
    uniform vec2 uOffset;
    uniform float uHour;
    varying float vAlpha;
    varying float vDepth;
    ${daylight}
    void main() {
      vec4 s = fract(aSeed * vec4(7.31, 3.17, 5.43, 9.71) + aSeed.wxyz);
      float t = uTime;
      // Window opening in image coordinates, between the curtains.
      vec2 home = vec2(mix(.555, .735, s.x), mix(.05, .70, s.y));
      vec2 wander = vec2(
        sin(t * (.11 + s.z * .09) + s.w * 40.) * .028 + sin(t * (.27 + s.x * .10) + s.y * 17.) * .010,
        cos(t * (.09 + s.w * .08) + s.z * 31.) * .022 + sin(t * (.21 + s.y * .12) + s.x * 23.) * .009);
      vec2 screen = (home + wander - uOffset) / uCover;
      gl_Position = vec4(screen.x * 2. - 1., 1. - screen.y * 2., 0., 1.);
      // Farther fireflies are smaller and dimmer.
      float depth = s.z;
      gl_PointSize = (12. + depth * 26.) * uScale;
      // Slow glow pulses with dark pauses, each on its own rhythm.
      float phase = fract(t * (.07 + s.w * .07) + s.x * 7.);
      float blink = smoothstep(0., .18, phase) * (1. - smoothstep(.30, .55, phase));
      vAlpha = blink * (1. - daylight(uHour).x) * (.55 + .45 * depth);
      vDepth = depth;
    }`;
  const fireflyFragment = `
    precision mediump float;
    varying float vAlpha;
    varying float vDepth;
    void main() {
      float r = length(gl_PointCoord - .5) * 2.;
      float core = exp(-r * r * 60.);
      float halo = exp(-r * r * 3.2) * (1. - smoothstep(.55, 1., r));
      float a = (core + halo * .8) * vAlpha;
      vec3 color = mix(vec3(.72, .95, .35), vec3(1., 1., .75), core);
      // Premultiplied and nearly additive: a glow, not an opaque dot.
      vec4 glow = vec4(color * a, a * .25);
      gl_FragColor = glow;
    }`;
  function makeCanvas(width, height) {
    const c = document.createElement('canvas'); c.width = width; c.height = height; return c;
  }
  function polygon(ctx, points, color) {
    ctx.fillStyle = color; ctx.beginPath();
    points.forEach(([x,y], i) => i ? ctx.lineTo(x * ctx.canvas.width, y * ctx.canvas.height)
      : ctx.moveTo(x * ctx.canvas.width, y * ctx.canvas.height));
    ctx.closePath(); ctx.fill();
  }
  function materialMaps(image) {
    const w = 2048, h = Math.round(w * image.naturalHeight / image.naturalWidth);
    const source = makeCanvas(w,h), ctx = source.getContext('2d', { willReadFrequently:true });
    ctx.drawImage(image, 0, 0, w, h);
    const pixels = ctx.getImageData(0,0,w,h);
    const cloth = makeCanvas(w,h), c = cloth.getContext('2d');
    c.filter = 'blur(1.6px)';
    polygon(c, [[.377,0],[.534,0],[.532,.25],[.538,.52],[.542,.80],[.540,.92],[.532,.94],[.527,.966],[.516,.95],[.514,.986],[.506,.969],[.500,.996],[.486,.970],[.480,.940],[.469,1],[.454,.965],[.444,1],[.425,.983],[.419,1],[.374,1],[.370,.78],[.367,.46],[.371,.20]], '#fff');
    polygon(c, [[.795,0],[.891,0],[.897,.22],[.910,.50],[.919,.82],[.923,.90],[.915,.944],[.899,.938],[.893,.963],[.880,.949],[.870,.924],[.856,.957],[.839,.942],[.833,.90],[.824,.74],[.813,.42]], '#fff');
    const clothData = c.getImageData(0,0,w,h).data;
    const leaves = makeCanvas(w,h), l = leaves.getContext('2d');
    const leafData = l.createImageData(w,h);
    for (let i=0; i<pixels.data.length; i+=4) {
      const p = i/4, x=(p%w)/w, y=Math.floor(p/w)/h;
      const r=pixels.data[i]/255, g=pixels.data[i+1]/255, b=pixels.data[i+2]/255;
      const green = Math.max(0,Math.min(1,(g - r*.84 - b*.16 - .016)*18));
      const area = x>.530 && x<.835 && y<.94;
      const value = area ? green * (1 - clothData[i+3]/255) : 0;
      leafData.data[i]=leafData.data[i+1]=leafData.data[i+2]=Math.round(value*255);
      leafData.data[i+3]=255;
    }
    l.putImageData(leafData,0,0);
    // Expand the silhouette slightly to let its edge move, then soften the transition.
    const leafSoft = makeCanvas(w,h), ls=leafSoft.getContext('2d');
    ls.filter='blur(1.7px)'; ls.drawImage(leaves,0,0);
    const greenData=ls.getImageData(0,0,w,h).data;
    const masks = makeCanvas(w,h), m=masks.getContext('2d'), data=m.createImageData(w,h);
    for(let i=0;i<data.data.length;i+=4) {
      const x=((i/4)%w)/w;
      data.data[i]=clothData[i+3];
      data.data[i+1]=greenData[i];
      data.data[i+2]=Math.round(255*Math.max(0,Math.min(1,(x-.20)/.44)));
      data.data[i+3]=255;
    }
    m.putImageData(data,0,0);
    const illumination=makeCanvas(w,h), il=illumination.getContext('2d');
    il.filter='blur(3px) grayscale(1)'; il.drawImage(source,0,0);
    return {masks,illumination};
  }
  async function preparePlate() {
    const load = data => new Promise((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = data;
    });
    if (!window.TLOU_RETOUCH) return load(window.TLOU_IMAGE);
    const [original, retouch, rightClean, fireflies] = await Promise.all([
      load(window.TLOU_IMAGE), load(window.TLOU_RETOUCH),
      load(window.TLOU_RIGHT_CLEAN || window.TLOU_RETOUCH),
      window.TLOU_FIREFLIES ? load(window.TLOU_FIREFLIES) : Promise.resolve(null)
    ]);
    // Retouch only the wall regions; preserve the original 4K window and foliage.
    const w=original.naturalWidth, h=original.naturalHeight;
    const plate=makeCanvas(w,h), ctx=plate.getContext('2d');
    ctx.drawImage(original,0,0);
    const patch=makeCanvas(w,h), pc=patch.getContext('2d');
    pc.drawImage(retouch,0,0,w,h);
    const mask=makeCanvas(w,h), mc=mask.getContext('2d');
    mc.filter='blur('+(w*.006)+'px)';
    mc.fillStyle='#fff'; mc.fillRect(w*.012,h*.27,w*.22,h*.34);
    pc.globalCompositeOperation='destination-in';pc.drawImage(mask,0,0);
    ctx.drawImage(patch,0,0);
    if (window.TLOU_RIGHT_CLEAN) {
      // Remove airborne specks baked into the reference, on the far-right wall only.
      const sideLayer=makeCanvas(w,h), sc=sideLayer.getContext('2d');
      sc.drawImage(rightClean,0,0,w,h);
      sc.globalCompositeOperation='destination-in';
      const feather=sc.createLinearGradient(w*.922,0,w*.945,0);
      feather.addColorStop(0,'rgba(255,255,255,0)');
      feather.addColorStop(1,'rgba(255,255,255,1)');
      sc.fillStyle=feather;sc.fillRect(0,0,w,h);
      ctx.drawImage(sideLayer,0,0);
    }
    if (fireflies) {
      // Native-resolution wall crop at (120,420), 1280 square in the 4K plate.
      // Painting is baked into the stationary wall and shares the scene lighting.
      const size=1280, feather=96;
      const decal=makeCanvas(size,size), dc=decal.getContext('2d');
      dc.drawImage(fireflies,0,0,size,size);
      dc.globalCompositeOperation='destination-in';
      for (const horizontal of [true,false]) {
        const edge=dc.createLinearGradient(0,0,horizontal?size:0,horizontal?0:size);
        edge.addColorStop(0,'rgba(255,255,255,0)');
        edge.addColorStop(feather/size,'rgba(255,255,255,1)');
        edge.addColorStop(1-feather/size,'rgba(255,255,255,1)');
        edge.addColorStop(1,'rgba(255,255,255,0)');
        dc.fillStyle=edge; dc.fillRect(0,0,size,size);
      }
      ctx.drawImage(decal,w*120/3840,h*420/2160,w*size/3840,h*size/2160);
    }
    return plate;
  }

const scene = {defaults,ranges,particleCounts,pixelLimits,particleSeeds,vertices,fragment,dustVertex,dustFragment,fireflyVertex,fireflyFragment,materialMaps,preparePlate};
if(typeof module !== 'undefined') module.exports=scene; else root.TLOUScene=scene;
})(globalThis);
