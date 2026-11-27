type KeyboardLock = {lock(codes:string[]):Promise<void>;unlock():void};

export class Input {
  readonly down = new Set<string>();
  private pressed = new Set<string>();
  private controller=new AbortController();
  dx=0;
  dy=0;
  fire=false;
  aim=false;
  shot=false;
  altShot=false;
  get locked() { return document.pointerLockElement===this.canvas; }
  private voluntary=false;
  private fullscreenWanted=false;
  private fullscreenGeneration=0;
  private keyboardLocked=false;
  private readonly keyboard=(navigator as Navigator & {keyboard?:KeyboardLock}).keyboard;
  get capturesEscape() { return this.keyboardLocked && document.fullscreenElement===document.documentElement; }
  /* 滚轮只在锁定时累计，按 40px 折算一格（触控板一次滑动会连发好几个事件） */
  private wheel=0;

  constructor(readonly canvas:HTMLCanvasElement, changed:(locked:boolean, voluntary:boolean)=>void,
    interrupted:()=>void, denied:()=>void) {
    const {signal}=this.controller;
    document.addEventListener('pointerlockchange',() => {
      const locked=this.locked;
      /* 是不是我们自己放开的（开面板 / 进暂停）：这种丢锁不该提示玩家 */
      const voluntary=this.voluntary;
      this.voluntary=false;
      if (!locked) this.clear();
      changed(locked,voluntary);
    },{signal});
    document.addEventListener('pointerlockerror',denied,{signal});
    document.addEventListener('fullscreenchange',async()=>{
      const root=document.documentElement;
      const generation=++this.fullscreenGeneration;
      if (document.fullscreenElement!==root) {
        const wasRequested=this.fullscreenWanted;
        this.fullscreenWanted=false;
        this.unlockKeyboard();
        if (wasRequested) {this.release();interrupted();}
        return;
      }
      if (!this.fullscreenWanted) return;
      try {
        await this.keyboard!.lock(['Escape']);
        if (generation===this.fullscreenGeneration && this.fullscreenWanted) this.keyboardLocked=true;
      } catch {
        if (generation===this.fullscreenGeneration && this.fullscreenWanted)
          await document.exitFullscreen().catch(()=>{});
      }
    },{signal});
    document.addEventListener('mousemove',event => {
      if (!this.locked) return;
      this.dx+=event.movementX; this.dy+=event.movementY;
    },{signal});
    document.addEventListener('mousedown',event => {
      if (!this.locked) return;
      if (event.button===0) { this.fire=true;this.shot=true; }
      if (event.button===2) { this.aim=true; this.altShot=true; }
    },{signal});
    document.addEventListener('mouseup',event => {
      if (event.button===0) this.fire=false;
      if (event.button===2) this.aim=false;
    },{signal});
    document.addEventListener('wheel',event => {
      if (!this.locked) return;
      event.preventDefault();
      this.wheel+=event.deltaY;
    },{signal,passive:false});
    document.addEventListener('keydown',event => {
      if (!this.locked) return;
      if (['Tab','Space','ControlLeft','ControlRight'].includes(event.code)) event.preventDefault();
      this.down.add(event.code);
      if (!event.repeat) this.pressed.add(event.code);
    },{signal});
    document.addEventListener('keyup',event => this.down.delete(event.code),{signal});
    canvas.addEventListener('contextmenu',event => event.preventDefault(),{signal});
    document.addEventListener('contextmenu',event => {
      if (this.locked) event.preventDefault();
    },{signal});
    window.addEventListener('blur',() => {
      this.release();
      interrupted();
    },{signal});
  }

  lock(onError?:()=>void) {
    try {
      const request=this.canvas.requestPointerLock();
      if (request) void request.catch(() => onError?.());
    } catch { onError?.(); }
  }

  enterFullscreen() {
    const root=document.documentElement;
    if (!this.keyboard?.lock || !root.requestFullscreen || !document.fullscreenEnabled || document.fullscreenElement) return;
    this.fullscreenWanted=true;
    try {
      void root.requestFullscreen().then(()=>{
        if (!this.fullscreenWanted && document.fullscreenElement===root)
          return document.exitFullscreen();
      }).catch(()=>{this.fullscreenWanted=false;});
    } catch {this.fullscreenWanted=false;}
  }

  private unlockKeyboard() {
    this.keyboardLocked=false;
    this.keyboard?.unlock();
  }

  endSession() {
    const exit=this.fullscreenWanted || this.keyboardLocked;
    this.fullscreenWanted=false;
    this.fullscreenGeneration++;
    this.unlockKeyboard();
    this.release();
    if (exit && document.fullscreenElement===document.documentElement)
      void document.exitFullscreen().catch(()=>{});
  }

  release() {
    this.clear();
    if (document.pointerLockElement===this.canvas) {
      this.voluntary=true;
      document.exitPointerLock();
    }
  }

  pop(code:string) { return this.pressed.delete(code); }

  /* 滚轮方向：-1 上 / +1 下，不够一格就继续攒着 */
  popWheel() {
    if (Math.abs(this.wheel)<40) return 0;
    const dir=this.wheel>0 ? 1 : -1;
    this.wheel=0;
    return dir;
  }

  clear() {
    this.down.clear(); this.pressed.clear();
    this.dx=this.dy=0; this.aim=this.fire=this.shot=this.altShot=false; this.wheel=0;
  }

  dispose() {
    this.endSession();
    this.controller.abort();
  }
}
