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
  locked=false;
  /* 滚轮只在锁定时累计，按 40px 折算一格（触控板一次滑动会连发好几个事件） */
  private wheel=0;

  constructor(readonly canvas:HTMLCanvasElement, changed:(locked:boolean)=>void) {
    const {signal}=this.controller;
    document.addEventListener('pointerlockchange',() => {
      this.locked=document.pointerLockElement===canvas;
      this.clear();
      changed(this.locked);
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
      this.clear();
      this.release();
    },{signal});
  }

  lock(onError:()=>void) {
    try {
      const request=this.canvas.requestPointerLock();
      if (request) void request.catch(onError);
    } catch { onError(); }
  }

  release() {
    this.clear();
    if (document.pointerLockElement===this.canvas) document.exitPointerLock();
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
    this.release();
    this.controller.abort();
  }
}
