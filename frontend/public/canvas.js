class PixelWorld {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    
    // Mouse tracking
    this.mouseX = this.width / 2;
    this.mouseY = this.height / 2;
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());

    // Time cycle (0 to 1, where 0 is midnight, 0.5 is noon)
    this.time = 0.5;
    
    // Environment
    this.stars = Array.from({ length: 150 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height * 0.6,
      size: Math.random() * 2 + 1,
      blink: Math.random() * Math.PI * 2
    }));
    this.particles = Array.from({ length: 50 }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      vx: (Math.random() - 0.5) * 0.5,
      vy: (Math.random() - 0.5) * 0.5 - 0.5,
      size: Math.random() * 2 + 1
    }));
    
    // Character State
    this.charState = 'onboarding_walk'; // onboarding_walk, onboarding_wave, working, checking_cursor
    this.appState = 'idle'; // idle, uploading, clipping, downloading, complete, error
    this.charX = -50;
    this.charY = this.height - 100;
    this.charFrame = 0;
    this.speechBubble = 0;

    this.lastFrame = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.buildings = this.generateSkyline();
    this.setupBackgroundCharacters();
    this.charY = this.height - 150;
  }

  generateSkyline() {
    const b = [];
    let x = 0;
    while (x < this.width) {
      const w = 40 + Math.random() * 60;
      const h = 100 + Math.random() * 300;
      b.push({ x, w, h, windows: Math.random() > 0.3 });
      x += w;
    }
    return b;
  }

  setupBackgroundCharacters() {
    if (!this.buildings || this.buildings.length === 0) return;

    const getB = (ratio) => {
      let target = this.width * ratio;
      return this.buildings.reduce((prev, curr) => 
        Math.abs(curr.x - target) < Math.abs(prev.x - target) ? curr : prev
      );
    }
    const bDj = getB(0.1);
    const bWin = getB(0.3);
    const bPainter = getB(0.6);
    const bTelescope = getB(0.85);
    const bCat = getB(0.5);

    this.bgChars = [
      { type: 'dj', x: bDj.x + bDj.w/2, y: this.height - bDj.h, frame: 0, notes: [] },
      { type: 'window', x: bWin.x + bWin.w/2, y: this.height - bWin.h + Math.min(bWin.h / 2, 80), frame: 0 },
      { type: 'skater', x: -50, y: this.height - 150, vx: 100, frame: 0 },
      { type: 'telescope', x: bTelescope.x + bTelescope.w/2, y: this.height - bTelescope.h, frame: 0 },
      { type: 'painter', x: bPainter.x, y: this.height - bPainter.h + 50, frame: 0 },
      { type: 'cat', x: bCat.x + bCat.w/2, y: this.height - bCat.h, frame: 0, state: 'sit', timer: 0, dir: 1 }
    ];
  }

  update(dt) {
    // Time cycle: 1 real minute = 1 full day
    this.time += dt / 60000;
    if (this.time > 1) this.time -= 1;

    // Particles
    for (let p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.y < 0) {
        p.y = this.height;
        p.x = Math.random() * this.width;
      }
    }

    // Character Logic
    this.charFrame += dt / 150;
    
    // Calculate cursor distance
    const distToCursor = Math.hypot(this.mouseX - this.charX, this.mouseY - this.charY);
    
    if (this.charState === 'onboarding_walk') {
      this.charX += dt * 0.1;
      if (this.charX > this.width / 2) {
        this.charState = 'onboarding_wave';
        this.speechBubble = 3000; // ms
      }
    } else if (this.charState === 'onboarding_wave') {
      this.speechBubble -= dt;
      if (this.speechBubble <= 0) {
        this.charState = 'working';
      }
    } else {
      if (distToCursor < 150) {
        this.charState = 'checking_cursor';
      } else {
        this.charState = 'working';
      }
    }

    // Update background characters
    if (this.bgChars) {
      for (let c of this.bgChars) {
        const dist = Math.hypot(this.mouseX - c.x, this.mouseY - c.y);
        c.distToCursor = dist;
        if (dist >= 150) {
          c.frame += dt / 150;
          if (c.type === 'dj') {
            if (Math.random() < 0.05) {
              c.notes.push({ x: c.x + (Math.random()-0.5)*20, y: c.y - 20, vy: -1, alpha: 1 });
            }
            c.notes.forEach(n => { n.y += n.vy; n.alpha -= 0.02; });
            c.notes = c.notes.filter(n => n.alpha > 0);
          } else if (c.type === 'skater') {
            c.x += (c.vx * dt) / 1000;
            if (c.x > this.width + 50) c.x = -50;
          } else if (c.type === 'cat') {
            c.timer -= dt;
            if (c.timer <= 0) {
              if (c.state === 'sit') {
                c.state = 'walk';
                c.timer = 2000; 
                c.dir = Math.random() > 0.5 ? 1 : -1;
              } else {
                c.state = 'sit';
                c.timer = 3000;
              }
            }
            if (c.state === 'walk') {
              c.x += (c.dir * 30 * dt) / 1000;
              const bCat = this.buildings.find(b => b.x <= c.x && b.x + b.w >= c.x);
              if (!bCat || c.x < bCat.x + 10 || c.x > bCat.x + bCat.w - 10) {
                c.dir *= -1;
              }
            }
          }
        }
      }
    }
  }

  draw() {
    // Background gradient based on time
    // 0 = midnight, 0.5 = noon
    const dayLight = Math.sin(this.time * Math.PI * 2) * 0.5 + 0.5;
    
    // Deep void black #04050a at night, slightly blue at day
    const r = Math.floor(4 + dayLight * 20);
    const g = Math.floor(5 + dayLight * 30);
    const b = Math.floor(10 + dayLight * 50);
    this.ctx.fillStyle = `rgb(${r},${g},${b})`;
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Stars
    if (dayLight < 0.3) {
      this.ctx.fillStyle = `rgba(255,255,255,${(0.3 - dayLight) * 3})`;
      for (let s of this.stars) {
        const blink = Math.sin(this.time * 100 + s.blink) * 0.5 + 0.5;
        this.ctx.globalAlpha = blink;
        this.ctx.fillRect(s.x, s.y, s.size, s.size);
      }
      this.ctx.globalAlpha = 1;
    }

    // Sun/Moon
    const cx = this.width/2;
    const cy = this.height;
    const angle = this.time * Math.PI * 2;
    const sunX = cx - Math.cos(angle) * (this.width/1.5);
    const sunY = cy + Math.sin(angle) * (this.height/1.2);
    
    this.ctx.fillStyle = '#ffed4a'; // Sun
    this.ctx.fillRect(sunX - 20, sunY - 20, 40, 40);

    const moonX = cx - Math.cos(angle + Math.PI) * (this.width/1.5);
    const moonY = cy + Math.sin(angle + Math.PI) * (this.height/1.2);
    this.ctx.fillStyle = '#e2e8f0'; // Moon
    this.ctx.fillRect(moonX - 15, moonY - 15, 30, 30);

    // Skyline
    const buildingBaseColor = `rgb(${Math.floor(dayLight*15)}, ${Math.floor(dayLight*20)}, ${Math.floor(dayLight*30)})`;
    this.ctx.fillStyle = buildingBaseColor;
    for (let bldg of this.buildings) {
      this.ctx.fillRect(bldg.x, this.height - bldg.h, bldg.w, bldg.h);
      if (bldg.windows && dayLight < 0.4) {
        this.ctx.fillStyle = 'rgba(255, 235, 100, 0.4)';
        for (let wy = this.height - bldg.h + 10; wy < this.height; wy += 20) {
          for (let wx = bldg.x + 5; wx < bldg.x + bldg.w - 10; wx += 15) {
            if (Math.random() > 0.8) continue; // some off
            this.ctx.fillRect(wx, wy, 5, 10);
          }
        }
        this.ctx.fillStyle = buildingBaseColor;
      }
    }

    // Draw background characters (some on buildings, before floor)
    if (this.bgChars) {
      for (let c of this.bgChars) {
        if (c.type !== 'skater') this.drawBgCharacter(c);
      }
    }

    // Floor
    this.ctx.fillStyle = `rgb(${r+5},${g+5},${b+10})`;
    this.ctx.fillRect(0, this.height - 150, this.width, 150);

    // Draw skater (on floor)
    if (this.bgChars) {
      for (let c of this.bgChars) {
        if (c.type === 'skater') this.drawBgCharacter(c);
      }
    }

    // Particles (ambient)
    this.ctx.fillStyle = 'rgba(91, 143, 255, 0.5)';
    for (let p of this.particles) {
      this.ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    // Character
    this.drawCharacter();
  }

  drawBgCharacter(c) {
    const scale = 2;
    const cx = c.x;
    const cy = c.y;
    const f = Math.floor(c.frame);
    const isAwake = c.distToCursor < 150;
    let eyeOffsetX = 0;
    if (isAwake) {
      eyeOffsetX = (this.mouseX > cx) ? 1 : -1;
    }

    const colors = {
      dj: { suit: '#ff5b5b', head: '#ffe0bd', legs: '#333' },
      window: { suit: '#5b8fff', head: '#ffe0bd', legs: '#333' },
      skater: { suit: '#5bff5b', head: '#ffe0bd', legs: '#5b8fff' },
      telescope: { suit: '#ffed4a', head: '#ffe0bd', legs: '#333' },
      painter: { suit: '#ff8bfa', head: '#ffe0bd', legs: '#333' }
    };

    if (c.type === 'cat') {
      this.ctx.fillStyle = '#ffb02e'; 
      if (isAwake) {
        this.ctx.fillRect(cx - 3*scale, cy - 5*scale, 6*scale, 5*scale); 
        this.ctx.fillRect(cx - 2*scale + eyeOffsetX*scale, cy - 8*scale, 4*scale, 4*scale); 
        this.ctx.fillStyle = '#000';
        this.ctx.fillRect(cx - scale + eyeOffsetX*scale, cy - 7*scale, scale, scale); 
      } else {
        if (c.state === 'sit') {
          this.ctx.fillRect(cx - 3*scale, cy - 5*scale, 6*scale, 5*scale); 
          this.ctx.fillRect(cx - 2*scale + c.dir*scale, cy - 8*scale, 4*scale, 4*scale); 
          const tailAngle = Math.sin(c.frame * 0.5) * 2;
          this.ctx.fillRect(cx - 4*scale, cy - 2*scale + tailAngle, 2*scale, 2*scale);
        } else {
          this.ctx.fillRect(cx - 4*scale, cy - 4*scale, 8*scale, 4*scale); 
          this.ctx.fillRect(cx + c.dir*4*scale - 2*scale, cy - 6*scale, 4*scale, 4*scale); 
          if (f % 2 === 0) {
            this.ctx.fillRect(cx - 3*scale, cy, scale, 2*scale);
            this.ctx.fillRect(cx + 2*scale, cy, scale, 2*scale);
          } else {
            this.ctx.fillRect(cx - 2*scale, cy, scale, 2*scale);
            this.ctx.fillRect(cx + scale, cy, scale, 2*scale);
          }
        }
      }
      if (isAwake) this.drawExclamation(cx, cy, scale);
      return;
    }

    const col = colors[c.type];
    
    if (c.type === 'window') {
      this.ctx.fillStyle = '#111';
      this.ctx.fillRect(cx - 10*scale, cy - 20*scale, 20*scale, 24*scale);
      this.ctx.fillStyle = 'rgba(255, 235, 100, 0.2)';
      this.ctx.fillRect(cx - 8*scale, cy - 18*scale, 16*scale, 20*scale);
    }
    if (c.type === 'painter') {
      this.ctx.fillStyle = '#555';
      this.ctx.fillRect(cx - 10*scale, cy, 20*scale, 2*scale);
      this.ctx.fillStyle = '#ff00ff'; 
      this.ctx.fillRect(cx - 10*scale, cy - 30*scale, 20*scale, 10*scale);
    }
    
    this.ctx.fillStyle = col.suit;
    if (c.type === 'skater' && !isAwake && f % 4 === 0) {
      this.ctx.fillRect(cx - 3*scale, cy - 6*scale, 6*scale, 6*scale);
    } else {
      this.ctx.fillRect(cx - 3*scale, cy - 8*scale, 6*scale, 8*scale);
    }
    
    this.ctx.fillStyle = col.head;
    if (c.type === 'skater' && !isAwake && f % 4 === 0) {
      this.ctx.fillRect(cx - 4*scale, cy - 14*scale, 8*scale, 8*scale);
    } else {
      this.ctx.fillRect(cx - 4*scale, cy - 16*scale, 8*scale, 8*scale);
    }

    this.ctx.fillStyle = '#000';
    let eyeY = (c.type === 'skater' && !isAwake && f % 4 === 0) ? -12*scale : -14*scale;
    this.ctx.fillRect(cx - 2*scale + eyeOffsetX*scale, cy + eyeY, 2*scale, 2*scale);
    this.ctx.fillRect(cx + 2*scale + eyeOffsetX*scale, cy + eyeY, 2*scale, 2*scale);

    this.ctx.fillStyle = col.legs;
    if (c.type === 'skater') {
      this.ctx.fillStyle = '#8b4513';
      this.ctx.fillRect(cx - 6*scale, cy + 4*scale, 12*scale, 2*scale); 
      this.ctx.fillStyle = '#aaa';
      this.ctx.fillRect(cx - 4*scale, cy + 6*scale, 2*scale, 2*scale); 
      this.ctx.fillRect(cx + 2*scale, cy + 6*scale, 2*scale, 2*scale); 
      
      this.ctx.fillStyle = col.legs;
      if (isAwake) {
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else {
        if (f % 4 === 0) {
          this.ctx.fillRect(cx - 3*scale, cy, 2*scale, 4*scale);
          this.ctx.fillRect(cx + 2*scale, cy, 2*scale, 4*scale);
        } else {
          this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
          this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
        }
      }
    } else if (c.type === 'dj') {
      this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
      this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      this.ctx.fillStyle = '#222';
      this.ctx.fillRect(cx - 8*scale, cy - 4*scale, 16*scale, 8*scale); 
      this.ctx.fillStyle = '#ffed4a'; 
      this.ctx.fillRect(cx - 6*scale, cy - 5*scale, 4*scale, scale);
      this.ctx.fillRect(cx + 2*scale, cy - 5*scale, 4*scale, scale);
      
      this.ctx.fillStyle = col.suit; 
      if (!isAwake) {
        const armY = (f % 2 === 0) ? -5*scale : -6*scale;
        this.ctx.fillRect(cx - 5*scale, cy + armY, 2*scale, 4*scale);
        this.ctx.fillRect(cx + 3*scale, cy + armY, 2*scale, 4*scale);
      }
      
      c.notes.forEach(n => {
        this.ctx.fillStyle = `rgba(255,255,255,${n.alpha})`;
        this.ctx.fillRect(n.x, n.y, 2*scale, 2*scale);
        this.ctx.fillRect(n.x + 2*scale, n.y - 2*scale, scale, 4*scale);
      });

    } else if (c.type === 'window') {
      this.ctx.fillStyle = '#5b8fff'; 
      this.ctx.fillRect(cx + 4*scale, cy - 6*scale, 4*scale, 6*scale);
      if (!isAwake && f % 8 < 2) {
        this.ctx.fillStyle = col.suit;
        this.ctx.fillRect(cx - 6*scale, cy - 14*scale, 2*scale, 6*scale); 
      } else if (!isAwake && f % 8 === 4) {
        this.ctx.fillStyle = '#fff';
        this.ctx.fillRect(cx - 5*scale, cy - 8*scale, 3*scale, 3*scale);
      }
      this.ctx.fillStyle = '#333';
      this.ctx.fillRect(cx - 10*scale, cy - 4*scale, 20*scale, 4*scale);
    } else if (c.type === 'telescope') {
      this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
      this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      this.ctx.fillStyle = '#888';
      const pan = isAwake ? 0 : Math.sin(c.frame * 0.1) * 2*scale;
      this.ctx.fillRect(cx + 4*scale + pan, cy - 10*scale, 10*scale, 2*scale); 
      this.ctx.fillRect(cx + 8*scale, cy - 8*scale, 2*scale, 8*scale); 
      
      if (!isAwake && f % 10 < 2) {
        this.ctx.fillStyle = col.suit;
        this.ctx.fillRect(cx - 6*scale, cy - 14*scale, 2*scale, 4*scale);
      }
    } else if (c.type === 'painter') {
      this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
      this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      
      if (!isAwake) {
        const paintY = Math.sin(c.frame * 0.5) * 4*scale;
        this.ctx.fillStyle = col.suit;
        this.ctx.fillRect(cx - 4*scale, cy - 14*scale + paintY, 2*scale, 4*scale); 
        this.ctx.fillStyle = '#ff00ff';
        this.ctx.fillRect(cx - 6*scale, cy - 15*scale + paintY, 2*scale, 2*scale); 
      }
    }

    if (isAwake) {
      this.drawExclamation(cx, cy, scale);
    }
  }

  drawExclamation(cx, cy, scale) {
    this.ctx.fillStyle = '#fff';
    this.ctx.fillRect(cx - 4*scale, cy - 24*scale, 8*scale, 6*scale);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(cx - scale, cy - 23*scale, 2*scale, 2*scale);
    this.ctx.fillRect(cx - scale, cy - 20*scale, 2*scale, scale);
  }

  drawCharacter() {
    const scale = 4;
    const cx = this.charX;
    const cy = this.charY;
    const f = Math.floor(this.charFrame) % 2; // Simple 2-frame animation
    
    this.ctx.fillStyle = '#a78bfa'; // Violet suit
    // Body
    this.ctx.fillRect(cx - 3*scale, cy - 8*scale, 6*scale, 8*scale);
    
    // Head
    this.ctx.fillStyle = '#f0f0ff';
    this.ctx.fillRect(cx - 4*scale, cy - 16*scale, 8*scale, 8*scale);

    // Eyes
    this.ctx.fillStyle = '#000';
    let eyeOffsetX = 0;
    
    if (this.charState === 'onboarding_walk') {
      eyeOffsetX = 1;
      // legs walking
      this.ctx.fillStyle = '#5b8fff';
      if (f === 0) {
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else {
        this.ctx.fillRect(cx - 3*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx, cy, 2*scale, 4*scale);
      }
    } else if (this.charState === 'checking_cursor') {
      // Look at cursor
      eyeOffsetX = (this.mouseX > cx) ? 2 : -2;
      this.ctx.fillStyle = '#5b8fff'; // legs idle
      this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
      this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
    } else {
      // Working state based on appState
      if (this.appState === 'idle') {
        // Just standing
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else if (this.appState === 'uploading') {
        // Carrying box
        this.ctx.fillStyle = '#ffed4a'; // Glowing box
        this.ctx.fillRect(cx + 4*scale, cy - 10*scale, 10*scale, 10*scale);
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else if (this.appState === 'clipping') {
        // Typing
        this.ctx.fillStyle = '#fff'; // Desk
        this.ctx.fillRect(cx + 4*scale, cy - 4*scale, 8*scale, 4*scale);
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else if (this.appState === 'downloading') {
        // Stacking
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else if (this.appState === 'complete') {
        // Arms up
        this.ctx.fillStyle = '#a78bfa';
        this.ctx.fillRect(cx - 6*scale, cy - 14*scale, 2*scale, 6*scale);
        this.ctx.fillRect(cx + 4*scale, cy - 14*scale, 2*scale, 6*scale);
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      } else if (this.appState === 'error') {
        // Scratch head
        this.ctx.fillStyle = '#a78bfa';
        this.ctx.fillRect(cx + 4*scale, cy - 16*scale, 2*scale, 6*scale);
        this.ctx.fillStyle = '#5b8fff';
        this.ctx.fillRect(cx - 2*scale, cy, 2*scale, 4*scale);
        this.ctx.fillRect(cx + scale, cy, 2*scale, 4*scale);
      }
    }

    // Draw eyes
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(cx - 2*scale + eyeOffsetX*scale, cy - 14*scale, 2*scale, 2*scale);
    this.ctx.fillRect(cx + 2*scale + eyeOffsetX*scale, cy - 14*scale, 2*scale, 2*scale);

    // Speech bubble
    if (this.charState === 'onboarding_wave') {
      this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
      this.ctx.fillRect(cx - 10*scale, cy - 28*scale, 30*scale, 10*scale);
      this.ctx.fillStyle = '#000';
      this.ctx.font = '12px "Space Grotesk"';
      this.ctx.fillText("let's get to work.", cx - 8*scale, cy - 21*scale);
    }
  }

  setAppState(state) {
    this.appState = state;
  }

  loop(timestamp) {
    const dt = timestamp - this.lastFrame;
    this.lastFrame = timestamp;
    this.update(dt);
    this.draw();
    requestAnimationFrame(this.loop);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.pixelWorld = new PixelWorld('voidCanvas');
});


