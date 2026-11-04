import { useEffect, useRef, useState } from "react";

export type OrbMode = "idle" | "listen" | "think" | "speak" | "error";
// Organic membrane and spectral flow adapted from the supplied Alice reference.
const fragmentSource = `
  precision highp float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_flow;
  uniform float u_motion;
  uniform vec2 u_pointer;
  uniform vec4 u_modes;
  uniform float u_hover;
  uniform float u_click_age;
  uniform float u_click_strength;
  uniform vec3 u_bg;
  uniform float u_light;
  const float PI=3.14159265359;
  mat2 rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
  float hash(vec3 p){p=fract(p*0.3183099+vec3(.13,.27,.39));p*=19.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
  float noise(vec3 p){
    vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
  }
  vec3 spectral(float p){
    vec3 cyan=vec3(.15,.79,.90),blue=vec3(.20,.35,.97),violet=vec3(.66,.34,.96),rose=vec3(.96,.48,.75);
    vec3 c=mix(cyan,blue,smoothstep(-.9,.25,sin(p)));
    c=mix(c,violet,smoothstep(.08,.92,sin(p+1.8))*.8);
    return mix(c,rose,pow(.5+.5*sin(p-1.2),5.)*.46);
  }
  void main(){
    float t=u_time;
    float m=u_motion;
    float listen=u_modes.y,think=u_modes.z,speak=u_modes.w;
    vec2 uv=(2.*gl_FragCoord.xy-u_resolution)/min(u_resolution.x,u_resolution.y);
    vec2 center=vec2(m*(.060*sin(t*.93)+.025*sin(t*1.83+.3))+u_pointer.x*.15,m*(.054*sin(t*1.17)+.024*sin(t*2.04+.7))+u_pointer.y*.13);
    vec2 p=uv-center;
    float breathing=m*(.048*sin(t*2.20)+.020*sin(t*3.71+.8));
    float syllable=pow(.5+.5*sin(t*7.4+.9*sin(t*1.7)),2.)*(.45+.55*pow(.5+.5*sin(t*1.83),2.));
    float contact=-.14*exp(-u_click_age*15.)+.22*sin(u_click_age*9.8)*exp(-u_click_age*2.5);
    contact*=u_click_strength;
    float stretch=m*(.095*sin(t*1.91)+.030*sin(t*3.17+.4))+.065*listen*sin(t*3.7)+.10*speak*(syllable-.35);
    float rotation=.25*sin(t*.84)+.12*sin(t*1.6)+think*.19*sin(t*1.25);
    p=rot(rotation)*p;
    p*=vec2(exp(-stretch),exp(stretch));
    float size=.59*(1.+breathing+.025*listen-.065*think+.16*speak*syllable+contact);
    float bound=(1.+.185*m+.035*think+.055*u_hover)*exp(abs(stretch));
    vec2 margins=u_resolution/min(u_resolution.x,u_resolution.y)-abs(center)-vec2(.065);
    size=min(size,min(margins.x,margins.y)/bound);
    float a=atan(p.y,p.x);
    float membrane=1.+m*(.082*sin(3.*a-t*1.65)+.063*sin(2.*a+t*1.21+.8)+.030*sin(4.*a-t*2.31+.45*sin(t*.7)));
    membrane+=.035*think*sin(3.*a-t*2.9);
    membrane+=u_hover*.055*pow(max(dot(normalize(p+vec2(.00001)),normalize(u_pointer+vec2(.00001))),0.),4.);
    float radial=length(p)/size;
    float d=radial/membrane;
    float aa=2.4/min(u_resolution.x,u_resolution.y)/size;
    float mask=1.-smoothstep(1.-aa,1.+aa,d);
    vec2 q=p/(size*membrane);
    float z=sqrt(max(0.,1.-dot(q,q)));
    vec3 n=normalize(vec3(q,z+.0001));
    vec3 pearl=spectral(a+t*.44+1.4);
    float halo=exp(-pow(max(d-1.,0.)*6.0,1.25))*(.075+.012*sin(t*2.2));
    float farHalo=exp(-dot(p,p)*2.1)*.023;
    vec3 outside=u_bg+(pearl*halo+vec3(.30,.38,.82)*farHalo)*(1.-u_light*.80);
    outside-=vec3(.10,.07,.015)*(halo+farHalo)*u_light;
    float fog=noise(vec3(q*2.1,t*.37));
    vec3 darkBody=vec3(.012,.024,.067)+spectral(fog*4.9+t*.30)*(.09+.055*z);
    vec3 lightBody=vec3(.71,.77,.90)+spectral(fog*4.9+t*.30)*.08;
    vec3 body=mix(darkBody,lightBody,u_light);
    float flowTime=u_flow;
    for(int i=0;i<3;i++){
      float fi=float(i);
      vec3 v=vec3(q,z*(.52+fi*.22));
      v.xz=rot(flowTime*.88+fi*1.1)*v.xz;
      v.xy=rot(.62*sin(flowTime*.75)+flowTime*.23+fi*1.02-.5)*v.xy;
      vec3 warp=vec3(sin(v.y*2.7+flowTime+fi),sin(v.z*2.3-flowTime*.77+fi*2.),sin(v.x*2.1+flowTime*.58));
      v+=warp*.31;
      float f=v.y+.34*sin(v.x*2.7+flowTime*.8+fi*1.7)+.19*sin(v.z*3.4-flowTime*.7);
      float ribbon=exp(-f*f*(11.+fi*3.));
      float crest=exp(-pow(f-.105*sin(v.x*3.+flowTime),2.)*70.);
      float strands=pow(.5+.5*sin(f*38.+v.x*2.+flowTime*2.4),13.)*ribbon;
      float variation=.7+.3*noise(v*4.+vec3(flowTime*.4));
      vec3 hue=spectral(fi*1.85+v.x*1.1-v.y*.8+flowTime*.27);
      float strength=(.42*ribbon+.18*crest+.085*strands)*variation*(.66+.34*z);
      body+=hue*strength*(1.-u_light*.88);
      body-=((vec3(1.)-hue)*strength*.95)*u_light;
    }
    vec2 corePoint=vec2(.31*sin(flowTime*1.37),.26*cos(flowTime*1.11));
    float core=exp(-dot(q-corePoint,q-corePoint)*7.2);
    body+=vec3(.22,.51,.78)*core*(.20+.06*u_hover+.07*listen)*(1.-u_light*.65);
    for(int j=0;j<3;j++){
      float fj=float(j);
      vec2 seed=vec2(.43*cos(flowTime*(.78+fj*.16)+fj*2.1),.39*sin(flowTime*(.91+fj*.11)+fj*2.1));
      float glow=exp(-dot(q-seed,q-seed)*(28.+fj*8.));
      vec3 seedColor=spectral(fj*2.0+flowTime*.3);
      body+=seedColor*glow*.10*(1.-u_light*.6);
    }
    float fresnel=pow(1.-z,2.15);
    float rimLight=.28+.72*pow(.5+.5*sin(a-t*.85+1.6),2.);
    body=mix(body,pearl*(.56+.32*rimLight)+vec3(.08,.10,.12),fresnel*.77);
    float lip=exp(-pow((d-.986)*85.,2.));
    body+=pearl*lip*(.17+.3*rimLight)*(1.-u_light*.6);
    float spec=pow(max(dot(n,normalize(vec3(-.48,.69,1.1))),0.),39.);
    float softSpec=pow(max(dot(n,normalize(vec3(-.60,.83,1.7))),0.),7.);
    body+=vec3(.60,.73,.86)*spec*.34+vec3(.27,.32,.49)*softSpec*.08;
    float shimmer=exp(-pow(length(q-vec2(-.38,.58))-.18,2.)*140.)*exp(-dot(q-vec2(-.38,.58),q-vec2(-.38,.58))*8.);
    body+=vec3(.27,.42,.54)*shimmer*.15;
    body+=spectral(a+t*.12)*exp(-u_click_age*2.9)*u_click_strength*.09;
    body=mix(vec3(1.)-exp(-body*1.48),body,u_light*.65);
    vec3 color=mix(outside,body,mask);
    float ringRadius=1.+u_click_age*.56;
    float ripple=exp(-pow((d-ringRadius)*80.,2.))*exp(-u_click_age*2.7)*u_click_strength;
    color+=pearl*ripple*.12*(1.-u_light*.5);
    float grain=(hash(vec3(gl_FragCoord.xy,fract(t*.001)))-.5)/480.;
    float alpha=max(mask, max(halo*2.8, ripple*.3));
    gl_FragColor=vec4(clamp(color+grain,0.,1.),clamp(alpha,0.,1.));
  }`;

export function AgentLivingOrb({ mode }: { mode: OrbMode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentMode = useRef(mode);
  const [ready, setReady] = useState(false);
  currentMode.current = mode;

  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    const gl = surface.getContext("webgl", { alpha: true, premultipliedAlpha: false, depth: false, stencil: false, antialias: false, powerPreference: "low-power" });
    if (!gl) return;
    const shaders: WebGLShader[] = [];
    const program = gl.createProgram();
    const buffer = gl.createBuffer();
    if (!program || !buffer) return;
    let frame = 0, lost = false;
    const cleanup = () => {
      cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      shaders.forEach(shader => gl.deleteShader(shader));
    };
    try {
      for (const [type, source] of [
        [gl.VERTEX_SHADER, "attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.,1.);}"],
        [gl.FRAGMENT_SHADER, fragmentSource],
      ] as const) {
        const shader = gl.createShader(type);
        if (!shader) throw new Error("Shader unavailable");
        shaders.push(shader);
        gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("Shader compilation failed");
        gl.attachShader(program, shader);
      }
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Shader link failed");
    } catch { cleanup(); return; }
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = Object.fromEntries(["resolution", "time", "flow", "motion", "pointer", "modes", "hover", "click_age", "click_strength", "bg", "light"].map(name => [name, gl.getUniformLocation(program, "u_" + name)]));
    const parent = surface.closest("button")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let time = 0, flow = 0, last = 0, clickAge = 20, hover = 0;
    let targetX = 0, targetY = 0, x = 0, y = 0;
    let visible = true;
    const mix = [1, 0, 0, 0];
    const move = (event: PointerEvent) => {
      const rect = surface.getBoundingClientRect();
      targetX = Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (rect.width / 2)));
      targetY = Math.max(-1, Math.min(1, -(event.clientY - rect.top - rect.height / 2) / (rect.height / 2)));
      hover = 1;
    };
    const leave = () => { targetX = targetY = hover = 0; };
    const pulse = () => { clickAge = 0; };
    const contextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); setReady(false); };
    parent.addEventListener("pointermove", move);
    parent.addEventListener("pointerleave", leave);
    parent.addEventListener("pointerdown", pulse);
    surface.addEventListener("webglcontextlost", contextLost);
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; last = 0; });
    observer.observe(surface);
    const draw = (now: number) => {
      if (lost) return;
      frame = requestAnimationFrame(draw);
      if (document.hidden || !visible) { last = 0; return; }
      if (last && now - last < 1000 / 30) return;
      const dt = last ? Math.min((now - last) / 1000, .1) : 1 / 30;
      last = now;
      const index = currentMode.current === "listen" ? 1 : currentMode.current === "think" ? 2 : currentMode.current === "speak" ? 3 : 0;
      const smooth = 1 - Math.exp(-dt * 5);
      mix.forEach((value, i) => { mix[i] = value + ((i === index ? 1 : 0) - value) * smooth; });
      if (!reduced.matches) { time += dt; flow += dt * (1 + mix[2] * .9 + mix[3] * .28); }
      clickAge += dt; x += (targetX - x) * smooth; y += (targetY - y) * smooth;
      const size = Math.round(80 * Math.min(window.devicePixelRatio || 1, 2));
      if (surface.width !== size) { surface.width = surface.height = size; gl.viewport(0, 0, size, size); }
      gl.uniform2f(uniform.resolution, size, size);
      gl.uniform1f(uniform.time, reduced.matches ? 1.4 : time);
      gl.uniform1f(uniform.flow, reduced.matches ? .8 : flow);
      gl.uniform1f(uniform.motion, reduced.matches ? 0 : 1.15);
      gl.uniform2f(uniform.pointer, reduced.matches ? 0 : x, reduced.matches ? 0 : y);
      gl.uniform4f(uniform.modes, mix[0], mix[1], mix[2], mix[3]);
      gl.uniform1f(uniform.hover, reduced.matches ? 0 : hover);
      gl.uniform1f(uniform.click_age, reduced.matches ? 20 : clickAge);
      gl.uniform1f(uniform.click_strength, 1);
      gl.uniform3f(uniform.bg, 0, 0, 0); gl.uniform1f(uniform.light, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    setReady(true);
    frame = requestAnimationFrame(draw);
    return () => {
      cleanup(); observer.disconnect();
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
      parent.removeEventListener("pointerdown", pulse);
      surface.removeEventListener("webglcontextlost", contextLost);
    };
  }, []);

  return <span className="agent-living-orb" data-renderer={ready ? "webgl" : "css"} data-mode={mode} aria-hidden="true">
    <span className="agent-living-fallback"><i /><i /><i /></span>
    <canvas ref={canvas} className="agent-living-canvas" />
    <span className="agent-living-motes"><i /><i /><i /><i /></span>
  </span>;
}
