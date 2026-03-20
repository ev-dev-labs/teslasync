// TeslaSync — Tesla & EV themed background animation
(function () {
  var canvas = document.createElement('canvas');
  canvas.id = 'particles-bg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(canvas);
  var ctx = canvas.getContext('2d');
  var w, h, mouse = { x: -1e4, y: -1e4 };
  var items = { particles: [], cars: [], bolts: [], batteries: [], signals: [], speedLines: [], stations: [] };

  function isDark() { return document.documentElement.classList.contains('dark'); }
  function c(dark, light) { return isDark() ? dark : light; }

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    seed();
  }

  function seed() {
    var k; for (k in items) items[k].length = 0;
    var i;

    // Particles
    for (i = 0; i < 50; i++) items.particles.push({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*.4, vy: (Math.random()-.5)*.4,
      r: Math.random()*2+.8, ci: (Math.random()*4)|0, a: Math.random()*.4+.25
    });

    // Cars
    for (i = 0; i < 8; i++) items.cars.push({
      x: 40+Math.random()*(w-80), y: Math.random()*h,
      sp: .5+Math.random()*.9, sz: 16+Math.random()*12,
      ci: (Math.random()*4)|0, a: .45+Math.random()*.25, trail: []
    });

    // Bolts
    for (i = 0; i < 10; i++) items.bolts.push({
      x: Math.random()*w, y: Math.random()*h,
      vy: -.2-Math.random()*.3, sz: 18+Math.random()*16,
      ma: .35+Math.random()*.25, ph: Math.random()*6.28,
      ci: (Math.random()*2)|0
    });

    // Batteries
    for (i = 0; i < 8; i++) items.batteries.push({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*.2, vy: (Math.random()-.5)*.2,
      lv: .2+Math.random()*.8, a: .3+Math.random()*.2,
      bw: 35+Math.random()*18, bh: 14+Math.random()*8
    });

    // Signal waves
    for (i = 0; i < 8; i++) items.signals.push({
      x: Math.random()*w, y: Math.random()*h,
      r: Math.random()*40, mr: 55+Math.random()*45,
      sp: .5+Math.random()*.5, a: .35+Math.random()*.2,
      ci: (Math.random()*4)|0
    });

    // Speed lines
    for (i = 0; i < 15; i++) items.speedLines.push({
      x: Math.random()*w, y: Math.random()*h,
      sp: 2+Math.random()*4, ln: 40+Math.random()*70,
      a: .2+Math.random()*.25, ci: (Math.random()*4)|0
    });

    // Charge stations
    for (i = 0; i < 5; i++) items.stations.push({
      x: Math.random()*w, y: Math.random()*h,
      vx: (Math.random()-.5)*.08, vy: (Math.random()-.5)*.08,
      sz: 22+Math.random()*12, a: .25+Math.random()*.2, ph: Math.random()*6.28
    });
  }

  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  window.addEventListener('resize', resize);
  document.addEventListener('mousemove', function(e){ mouse.x=e.clientX; mouse.y=e.clientY; });

  var DC = ['#00f0ff','#10b981','#a855f7','#f59e0b'];
  var LC = ['#005f8a','#047857','#6d28d9','#b45309'];
  function col(ci) { return isDark() ? DC[ci] : LC[ci]; }

  seed();

  // --- Draw helpers ---

  function drawCar(x, y, sz, ci, a) {
    var clr = col(ci), s = sz;
    ctx.save(); ctx.globalAlpha = a;
    ctx.strokeStyle = clr; ctx.lineWidth = 1.8; ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x-s*.4, y-s); ctx.lineTo(x+s*.4, y-s);
    ctx.quadraticCurveTo(x+s*.58, y-s, x+s*.58, y-s*.8);
    ctx.lineTo(x+s*.62, y+s*.6);
    ctx.quadraticCurveTo(x+s*.62, y+s, x+s*.38, y+s);
    ctx.lineTo(x-s*.38, y+s);
    ctx.quadraticCurveTo(x-s*.62, y+s, x-s*.62, y+s*.6);
    ctx.lineTo(x-s*.58, y-s*.8);
    ctx.quadraticCurveTo(x-s*.58, y-s, x-s*.4, y-s);
    ctx.stroke();
    // Windshield
    ctx.beginPath();
    ctx.moveTo(x-s*.4, y-s*.48); ctx.lineTo(x-s*.3, y-s*.84);
    ctx.lineTo(x+s*.3, y-s*.84); ctx.lineTo(x+s*.4, y-s*.48); ctx.closePath();
    ctx.fillStyle = clr; ctx.globalAlpha = a*.5; ctx.fill();
    // Headlights (bright)
    ctx.globalAlpha = Math.min(a*2.5, 1); ctx.fillStyle = isDark() ? '#fff' : clr;
    ctx.shadowColor = clr; ctx.shadowBlur = 8;
    ctx.fillRect(x-s*.45, y-s*1.06, s*.3, s*.16);
    ctx.fillRect(x+s*.15, y-s*1.06, s*.3, s*.16);
    // Taillights
    ctx.shadowColor = '#ef4444'; ctx.fillStyle = '#ef4444';
    ctx.globalAlpha = a*1.5;
    ctx.fillRect(x-s*.45, y+s*.9, s*.3, s*.14);
    ctx.fillRect(x+s*.15, y+s*.9, s*.3, s*.14);
    ctx.restore();
  }

  function drawBolt(x, y, sz, ci, a) {
    var clr = col(ci), s = sz;
    ctx.save(); ctx.globalAlpha = a;
    ctx.fillStyle = clr; ctx.shadowColor = clr; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(x+s*.22, y-s*.5);
    ctx.lineTo(x-s*.06, y-s*.03); ctx.lineTo(x+s*.1, y-s*.03);
    ctx.lineTo(x-s*.22, y+s*.5);
    ctx.lineTo(x+s*.06, y+s*.03); ctx.lineTo(x-s*.1, y+s*.03);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawBattery(x, y, bw, bh, lv, a) {
    var dark = isDark();
    ctx.save(); ctx.globalAlpha = a;
    var bc = dark ? 'rgba(200,220,255,.6)' : 'rgba(0,0,0,.4)';
    ctx.strokeStyle = bc; ctx.lineWidth = 1.4; ctx.lineJoin = 'round';
    ctx.strokeRect(x, y, bw, bh);
    ctx.fillStyle = bc; ctx.fillRect(x+bw, y+bh*.18, bw*.13, bh*.64);
    var fc = lv>.6 ? (dark?'#10b981':'#047857') : lv>.3 ? (dark?'#f59e0b':'#b45309') : '#ef4444';
    ctx.fillStyle = fc; ctx.shadowColor = fc; ctx.shadowBlur = 6;
    ctx.globalAlpha = a*.95;
    ctx.fillRect(x+2, y+2, (bw-4)*lv, bh-4);
    ctx.shadowBlur = 0;
    ctx.globalAlpha = a; ctx.fillStyle = dark ? '#fff' : '#333';
    ctx.font = 'bold '+Math.max(bh*.55,8)+'px monospace'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(lv*100)+'%', x+bw/2, y+bh*.75);
    ctx.restore();
  }

  function drawStation(x, y, sz, a, pulse) {
    var dark = isDark(), clr = dark ? '#00f0ff' : '#005f8a', s = sz;
    ctx.save(); ctx.globalAlpha = a * (.7 + .3*Math.sin(pulse));
    ctx.strokeStyle = clr; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
    // Charger body
    ctx.strokeRect(x-s*.3, y-s*.4, s*.6, s*.8);
    // Screen
    ctx.fillStyle = clr; ctx.globalAlpha = a*.3;
    ctx.fillRect(x-s*.2, y-s*.3, s*.4, s*.3);
    // Cable
    ctx.globalAlpha = a * (.7 + .3*Math.sin(pulse));
    ctx.beginPath(); ctx.moveTo(x+s*.3, y); ctx.quadraticCurveTo(x+s*.7, y+s*.2, x+s*.5, y+s*.5);
    ctx.strokeStyle = clr; ctx.lineWidth = 1.2; ctx.stroke();
    // Plug
    ctx.beginPath(); ctx.arc(x+s*.5, y+s*.5, s*.08, 0, Math.PI*2);
    ctx.fillStyle = clr; ctx.globalAlpha = a; ctx.fill();
    // Bolt icon on screen
    ctx.globalAlpha = a*.8;
    drawBolt(x, y-s*.15, s*.25, 0, a*.6);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    canvas.style.opacity = '1';
    var t = Date.now()*.001, i, p, d;

    // --- Particles ---
    for (i = 0; i < items.particles.length; i++) {
      p = items.particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x<0) p.x=w; if (p.x>w) p.x=0; if (p.y<0) p.y=h; if (p.y>h) p.y=0;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28);
      ctx.fillStyle = col(p.ci); ctx.globalAlpha = p.a; ctx.fill();
      for (var j=i+1; j<items.particles.length; j++) {
        var q = items.particles[j];
        d = Math.hypot(p.x-q.x, p.y-q.y);
        if (d<110) {
          ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(q.x,q.y);
          ctx.strokeStyle = col(p.ci); ctx.globalAlpha = (1-d/110)*.15; ctx.lineWidth=.6; ctx.stroke();
        }
      }
      d = Math.hypot(p.x-mouse.x, p.y-mouse.y);
      if (d<160) {
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(mouse.x,mouse.y);
        ctx.strokeStyle = col(0); ctx.globalAlpha = (1-d/160)*.35; ctx.lineWidth=.8; ctx.stroke();
      }
    }

    // --- Speed Lines ---
    for (i=0; i<items.speedLines.length; i++) {
      p = items.speedLines[i];
      p.x += p.sp;
      if (p.x > w+p.ln) { p.x = -p.ln; p.y = Math.random()*h; }
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x-p.ln, p.y);
      var grad = ctx.createLinearGradient(p.x, p.y, p.x-p.ln, p.y);
      grad.addColorStop(0, col(p.ci)); grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad; ctx.globalAlpha = p.a; ctx.lineWidth = 1.2; ctx.stroke();
    }

    // --- Cars ---
    for (i=0; i<items.cars.length; i++) {
      p = items.cars[i];
      p.y -= p.sp;
      if (p.y < -p.sz*2.5) { p.y = h+p.sz*2.5; p.x = 40+Math.random()*(w-80); }
      p.trail.push({x:p.x, y:p.y});
      if (p.trail.length > 30) p.trail.shift();
      for (var k=1; k<p.trail.length; k++) {
        ctx.beginPath(); ctx.moveTo(p.trail[k-1].x, p.trail[k-1].y); ctx.lineTo(p.trail[k].x, p.trail[k].y);
        ctx.strokeStyle = col(p.ci); ctx.globalAlpha = (k/p.trail.length)*p.a*.4; ctx.lineWidth=1.2; ctx.stroke();
      }
      drawCar(p.x, p.y, p.sz, p.ci, p.a);
    }

    // --- Bolts ---
    for (i=0; i<items.bolts.length; i++) {
      p = items.bolts[i];
      p.y += p.vy;
      if (p.y < -50) { p.y = h+50; p.x = Math.random()*w; }
      var ba = p.ma * (.5 + .5*Math.sin(t*2.5 + p.ph));
      drawBolt(p.x, p.y, p.sz, p.ci, ba);
    }

    // --- Batteries ---
    for (i=0; i<items.batteries.length; i++) {
      p = items.batteries[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x<-60) p.x=w+60; if (p.x>w+60) p.x=-60;
      if (p.y<-60) p.y=h+60; if (p.y>h+60) p.y=-60;
      p.lv = .15 + .7*(.5+.5*Math.sin(t*.35+p.x*.004));
      drawBattery(p.x, p.y, p.bw, p.bh, p.lv, p.a);
    }

    // --- Signals ---
    for (i=0; i<items.signals.length; i++) {
      p = items.signals[i];
      p.r += p.sp;
      if (p.r > p.mr) { p.r=0; p.x=Math.random()*w; p.y=Math.random()*h; }
      for (var r=0; r<3; r++) {
        var rr = p.r - r*12;
        if (rr>0) {
          ctx.beginPath(); ctx.arc(p.x, p.y, rr, -Math.PI*.35, Math.PI*.35);
          ctx.strokeStyle = col(p.ci); ctx.globalAlpha = p.a*(1-rr/p.mr); ctx.lineWidth=1.8; ctx.stroke();
        }
      }
      ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 6.28);
      ctx.fillStyle = col(p.ci); ctx.globalAlpha = p.a; ctx.fill();
    }

    // --- Charge Stations ---
    for (i=0; i<items.stations.length; i++) {
      p = items.stations[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x<-40) p.x=w+40; if (p.x>w+40) p.x=-40;
      if (p.y<-40) p.y=h+40; if (p.y>h+40) p.y=-40;
      drawStation(p.x, p.y, p.sz, p.a, t*2+p.ph);
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();