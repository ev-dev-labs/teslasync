// TeslaSync — Tesla & EV themed background animation
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'particles-bg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let w, h, mouse = { x: -1000, y: -1000 };
  const particles = [], cars = [], bolts = [], batteryBars = [], signals = [];

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; init(); }

  function init() {
    particles.length = 0; cars.length = 0; bolts.length = 0; batteryBars.length = 0; signals.length = 0;

    // Data particles
    for (let i = 0; i < 40; i++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
        r: Math.random() * 2 + 0.8,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: Math.random() * 0.3 + 0.2,
      });
    }

    // Cars — bigger, more visible, spawn on screen
    for (let i = 0; i < 6; i++) {
      cars.push({
        x: 60 + Math.random() * (w - 120),
        y: Math.random() * h,
        speed: 0.4 + Math.random() * 0.8,
        size: 14 + Math.random() * 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 0.35 + Math.random() * 0.2,
        trail: [],
      });
    }

    // Charging bolts — bigger, brighter
    for (let i = 0; i < 8; i++) {
      bolts.push({
        x: Math.random() * w, y: Math.random() * h,
        vy: -0.15 - Math.random() * 0.25,
        size: 16 + Math.random() * 14,
        alpha: 0,
        maxAlpha: 0.3 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
        color: Math.random() > 0.5 ? '#00f0ff' : '#10b981',
      });
    }

    // Battery bars — bigger, more visible
    for (let i = 0; i < 7; i++) {
      batteryBars.push({
        x: Math.random() * w, y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.2, vy: (Math.random() - 0.5) * 0.2,
        level: 0.3 + Math.random() * 0.7,
        alpha: 0.25 + Math.random() * 0.15,
        w: 30 + Math.random() * 15, h: 12 + Math.random() * 6,
      });
    }

    // Signal waves — more visible
    for (let i = 0; i < 6; i++) {
      signals.push({
        x: Math.random() * w, y: Math.random() * h,
        radius: 0, maxRadius: 50 + Math.random() * 40,
        speed: 0.4 + Math.random() * 0.4,
        alpha: 0.3 + Math.random() * 0.15,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }

  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
  window.addEventListener('resize', resize);
  document.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });

  const colors = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b'];
  const isDark = () => document.documentElement.classList.contains('dark');

  init();

  function drawCar(x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    const s = size;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.4, y - s);
    ctx.lineTo(x + s * 0.4, y - s);
    ctx.quadraticCurveTo(x + s * 0.55, y - s, x + s * 0.55, y - s * 0.8);
    ctx.lineTo(x + s * 0.6, y + s * 0.6);
    ctx.quadraticCurveTo(x + s * 0.6, y + s, x + s * 0.35, y + s);
    ctx.lineTo(x - s * 0.35, y + s);
    ctx.quadraticCurveTo(x - s * 0.6, y + s, x - s * 0.6, y + s * 0.6);
    ctx.lineTo(x - s * 0.55, y - s * 0.8);
    ctx.quadraticCurveTo(x - s * 0.55, y - s, x - s * 0.4, y - s);
    ctx.stroke();
    // Windshield
    ctx.beginPath();
    ctx.moveTo(x - s * 0.38, y - s * 0.5);
    ctx.lineTo(x - s * 0.28, y - s * 0.82);
    ctx.lineTo(x + s * 0.28, y - s * 0.82);
    ctx.lineTo(x + s * 0.38, y - s * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.4;
    ctx.fill();
    // Headlights
    ctx.globalAlpha = Math.min(alpha * 2, 1);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.fillRect(x - s * 0.42, y - s * 1.05, s * 0.28, s * 0.15);
    ctx.fillRect(x + s * 0.14, y - s * 1.05, s * 0.28, s * 0.15);
    ctx.shadowBlur = 0;
    // Taillights
    ctx.fillStyle = '#ef4444';
    ctx.globalAlpha = alpha * 1.2;
    ctx.shadowColor = '#ef4444';
    ctx.shadowBlur = 4;
    ctx.fillRect(x - s * 0.42, y + s * 0.9, s * 0.28, s * 0.12);
    ctx.fillRect(x + s * 0.14, y + s * 0.9, s * 0.28, s * 0.12);
    ctx.restore();
  }

  function drawBolt(x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    const s = size;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.2, y - s * 0.5);
    ctx.lineTo(x - s * 0.05, y - s * 0.02);
    ctx.lineTo(x + s * 0.08, y - s * 0.02);
    ctx.lineTo(x - s * 0.2, y + s * 0.5);
    ctx.lineTo(x + s * 0.05, y + s * 0.02);
    ctx.lineTo(x - s * 0.08, y + s * 0.02);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBattery(x, y, bw, bh, level, alpha, dark) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const border = dark ? 'rgba(200,220,255,0.5)' : 'rgba(0,0,0,0.3)';
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.2;
    ctx.lineJoin = 'round';
    // Body
    ctx.strokeRect(x, y, bw, bh);
    // Terminal
    ctx.fillStyle = border;
    ctx.fillRect(x + bw, y + bh * 0.2, bw * 0.12, bh * 0.6);
    // Fill
    const fillColor = level > 0.6 ? '#10b981' : level > 0.3 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = fillColor;
    ctx.shadowColor = fillColor;
    ctx.shadowBlur = 4;
    ctx.globalAlpha = alpha * 0.9;
    ctx.fillRect(x + 1.5, y + 1.5, (bw - 3) * level, bh - 3);
    // Percentage text
    ctx.shadowBlur = 0;
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = dark ? '#fff' : '#333';
    ctx.font = `${Math.max(bh * 0.6, 7)}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(level * 100) + '%', x + bw / 2, y + bh * 0.78);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const dark = isDark();
    canvas.style.opacity = dark ? '1' : '0.85';
    const t = Date.now() * 0.001;

    // --- Particles + connections ---
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
      for (let j = i + 1; j < particles.length; j++) {
        const q = particles[j];
        const dist = Math.hypot(p.x - q.x, p.y - q.y);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - dist / 120) * 0.12;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
      const mdist = Math.hypot(p.x - mouse.x, p.y - mouse.y);
      if (mdist < 150) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = '#00f0ff';
        ctx.globalAlpha = (1 - mdist / 150) * 0.3;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }

    // --- Cars driving upward ---
    for (const car of cars) {
      car.y -= car.speed;
      if (car.y < -car.size * 2) { car.y = h + car.size * 2; car.x = 60 + Math.random() * (w - 120); }
      car.trail.push({ x: car.x, y: car.y });
      if (car.trail.length > 25) car.trail.shift();
      // Trail
      for (let i = 1; i < car.trail.length; i++) {
        ctx.beginPath();
        ctx.moveTo(car.trail[i - 1].x, car.trail[i - 1].y);
        ctx.lineTo(car.trail[i].x, car.trail[i].y);
        ctx.strokeStyle = car.color;
        ctx.globalAlpha = (i / car.trail.length) * car.alpha * 0.4;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      drawCar(car.x, car.y, car.size, car.color, car.alpha);
    }

    // --- Charging Bolts ---
    for (const b of bolts) {
      b.y += b.vy;
      b.alpha = b.maxAlpha * (0.5 + 0.5 * Math.sin(t * 2.5 + b.phase));
      if (b.y < -40) { b.y = h + 40; b.x = Math.random() * w; }
      drawBolt(b.x, b.y, b.size, b.color, b.alpha);
    }

    // --- Battery Bars ---
    for (const bb of batteryBars) {
      bb.x += bb.vx; bb.y += bb.vy;
      if (bb.x < -50) bb.x = w + 50; if (bb.x > w + 50) bb.x = -50;
      if (bb.y < -50) bb.y = h + 50; if (bb.y > h + 50) bb.y = -50;
      bb.level = 0.2 + 0.6 * (0.5 + 0.5 * Math.sin(t * 0.4 + bb.x * 0.005));
      drawBattery(bb.x, bb.y, bb.w, bb.h, bb.level, bb.alpha, dark);
    }

    // --- Signal Waves ---
    for (const sig of signals) {
      sig.radius += sig.speed;
      if (sig.radius > sig.maxRadius) { sig.radius = 0; sig.x = Math.random() * w; sig.y = Math.random() * h; }
      for (let r = 0; r < 3; r++) {
        const rr = sig.radius - r * 10;
        if (rr > 0) {
          ctx.beginPath();
          ctx.arc(sig.x, sig.y, rr, -Math.PI * 0.35, Math.PI * 0.35);
          ctx.strokeStyle = sig.color;
          ctx.globalAlpha = sig.alpha * (1 - rr / sig.maxRadius);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      }
      // Center dot
      ctx.beginPath();
      ctx.arc(sig.x, sig.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = sig.color;
      ctx.globalAlpha = sig.alpha;
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();
