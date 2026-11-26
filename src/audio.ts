import type { WeaponId } from './data.ts';
import type { Point } from './sector.ts';

type Cue = 'step'|'metalStep'|'reload'|'pump'|'empty'|'hit'|'hurt'|'open'|'zip'|'lock'|'grab'|'ping'|'extract'|'buzz'|'echo'|'scav'
  |'knifeSwing'|'knifeThrust'|'knifeHit';
const sampleUrls=import.meta.glob<string>('./audio/*.wav',{eager:true,query:'?url',import:'default'});

export class Audio {
  private ctx?:AudioContext;
  private output?:GainNode;
  private ambient?:GainNode;
  private noise?:AudioBuffer;
  private samples=new Map<string,AudioBuffer>();
  private volume=.55;
  private listener:Point={x:0,z:0};
  private yaw=0;
  private ambientLevel=0;

  get sampleCount() { return this.samples.size; }

  wake() {
    try {
      if (!this.ctx) {
        const ctx=this.ctx=new AudioContext();
        const output=this.output=ctx.createGain();
        output.connect(ctx.destination);
        const noise=this.noise=ctx.createBuffer(1,ctx.sampleRate,ctx.sampleRate);
        const samples=noise.getChannelData(0);
        for (let i=0;i<samples.length;i++) samples[i]=Math.random()*2-1;
        const ambient=this.ambient=ctx.createGain();
        ambient.gain.value=.0;
        ambient.connect(output);
        const hum=ctx.createOscillator();
        hum.type='triangle';hum.frequency.value=49;hum.connect(ambient);hum.start();
        const staticSource=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), level=ctx.createGain();
        staticSource.buffer=noise;staticSource.loop=true;
        filter.type='lowpass';filter.frequency.value=205;
        level.gain.value=.54;
        staticSource.connect(filter).connect(level).connect(ambient);staticSource.start();
        output.gain.value=this.volume*.65;
        for (const [path,url] of Object.entries(sampleUrls)) {
          void fetch(url).then(response => {
            if (!response.ok) throw new Error('Sample unavailable');
            return response.arrayBuffer();
          }).then(bytes => ctx.decodeAudioData(bytes)).then(buffer => {
            this.samples.set(path.slice('./audio/'.length,-4),buffer);
          }).catch(() => {});
        }
      }
      void this.ctx.resume().catch(() => {});
    } catch {
      // Audio is optional when Web Audio is unavailable.
    }
  }

  setVolume(volume:number) {
    this.volume=volume;
    if (this.ctx && this.output) this.output.gain.setTargetAtTime(volume*.65,this.ctx.currentTime,.06);
  }

  ambience(playing:boolean,inside=false) {
    const level=playing ? (inside ? .054 : .035) : 0;
    if (!this.ctx || !this.ambient || level===this.ambientLevel) return;
    this.ambientLevel=level;
    this.ambient.gain.setTargetAtTime(level,this.ctx.currentTime,.22);
  }

  position(p:Point,yaw:number) {
    this.listener.x=p.x;this.listener.z=p.z;this.yaw=yaw;
  }

  private bus(source?:Point) {
    const ctx=this.ctx, output=this.output;
    if (!ctx || !output) return null;
    const gain=ctx.createGain();
    if (source) {
      const dx=source.x-this.listener.x,dz=source.z-this.listener.z;
      const distance=Math.hypot(dx,dz);
      gain.gain.value=1/(1+distance*.11);
      const pan=ctx.createStereoPanner();
      pan.pan.value=Math.max(-.9,Math.min(.9,(dx*Math.cos(this.yaw)-dz*Math.sin(this.yaw))/Math.max(3,distance)));
      gain.connect(pan).connect(output);
      return {ctx,gain,pan};
    }
    gain.connect(output);
    return {ctx,gain,pan:null};
  }

  private transient(time:number,freq:number,end:number,amount:number,noise:number,cut:number,source?:Point) {
    const bus=this.bus(source);
    if (!bus || !this.noise) return;
    const {ctx,gain,pan}=bus;
    const now=ctx.currentTime;
    const osc=ctx.createOscillator(), oscGain=ctx.createGain();
    osc.type='triangle'; osc.frequency.setValueAtTime(freq,now);
    osc.frequency.exponentialRampToValueAtTime(end,now+time);
    oscGain.gain.setValueAtTime(Math.max(.001,amount),now);
    oscGain.gain.exponentialRampToValueAtTime(.0001,now+time);
    osc.connect(oscGain).connect(gain);
    const src=ctx.createBufferSource(), filter=ctx.createBiquadFilter(), level=ctx.createGain();
    src.buffer=this.noise;filter.type='lowpass';filter.frequency.value=cut;
    level.gain.setValueAtTime(Math.max(.001,noise),now);
    level.gain.exponentialRampToValueAtTime(.0001,now+time);
    src.connect(filter).connect(level).connect(gain);
    osc.onended=() => {gain.disconnect();pan?.disconnect();};
    osc.start();osc.stop(now+time+.01);src.start(now,Math.random()*.7);src.stop(now+time);
  }

  private sample(ids:string[],volume:number,source?:Point,rate=1,limit=Infinity) {
    const buffer=this.samples.get(ids[Math.floor(Math.random()*ids.length)]);
    if (!buffer) return false;
    const bus=this.bus(source);
    if (!bus) return false;
    const {ctx,gain,pan}=bus;
    const clip=ctx.createBufferSource(), level=ctx.createGain();
    const started=ctx.currentTime;
    clip.buffer=buffer;
    clip.playbackRate.value=rate;
    level.gain.value=volume;
    if (limit<buffer.duration/rate) {
      level.gain.setValueAtTime(volume,started+Math.max(.02,limit-.09));
      level.gain.linearRampToValueAtTime(0,started+limit);
    }
    clip.connect(level).connect(gain);
    clip.onended=() => {gain.disconnect();pan?.disconnect();};
    clip.start();
    if (limit<buffer.duration/rate) clip.stop(started+limit+.01);
    return true;
  }

  gun(weapon:WeaponId,source?:Point) {
    if (weapon==='ar56' && this.sample(['shot_spear'],source ? .68 : .85,source,.96+Math.random()*.12,.33)) return;
    if (weapon==='k9') this.transient(.17,129,42,.44,.87,3100,source);
    else if (weapon==='ar56') this.transient(.19,158,45,.44,.97,4200,source);
    else this.transient(.29,103,32,.62,1.08,2200,source);
  }

  play(cue:Cue,source?:Point) {
    if (cue==='step' && this.sample(['step_stone_1','step_stone_2'],.47,source,.89+Math.random()*.23)) return;
    if (cue==='grab' && this.sample(['pickup_1','pickup_2'],.46,source)) return;
    if (cue==='hurt' && this.sample(['hurt_player_1','hurt_player_2'],.54,source)) return;
    if (cue==='echo' && this.sample(['echo_engage'],.55,source,.93+Math.random()*.13,.76)) return;
    if (cue==='zip' && this.sample(['search_zipper'],.55,source,1.3,.78)) return;
    if (cue==='lock' && this.sample(['search_lock'],.54,source)) return;
    if (cue==='extract' && this.sample(['extract'],.48)) return;
    const sound:Record<Cue,[number,number,number,number,number,number]>={
      step:[.13,71,31,.035,.2,510],metalStep:[.13,139,54,.073,.19,1500],
      reload:[.17,368,87,.10,.26,2800],pump:[.25,198,85,.12,.35,1900],empty:[.08,512,220,.18,.13,2600],
      hit:[.1,271,90,.12,.12,900],hurt:[.3,76,24,.24,.24,430],
      knifeSwing:[.12,370,146,.025,.24,2600],knifeThrust:[.16,218,82,.05,.31,1770],knifeHit:[.13,129,56,.16,.23,1020],
      open:[.24,180,40,.11,.25,1150],zip:[.25,260,36,.12,.20,1350],lock:[.29,230,71,.16,.24,1500],grab:[.14,388,232,.09,.14,1600],
      ping:[.31,880,640,.14,.05,2000],extract:[.58,471,915,.16,.07,1600],
      buzz:[.44,199,66,.1,.11,460],echo:[.38,162,53,.21,.20,670],scav:[.23,109,62,.071,.12,590],
    };
    this.transient(...sound[cue],source);
  }

  reload(id:WeaponId) {
    if (id==='ar56' && this.sample(['reload_6851'],.65,undefined,1.3,1.62)) return;
    this.play('reload');
  }

  dispose() { void this.ctx?.close().catch(() => {}); }
}
