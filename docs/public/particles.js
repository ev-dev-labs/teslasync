// TeslaSync — Tesla & EV themed background animation
(function () {
  const canvas = document.createElement('canvas');
  canvas.id = 'particles-bg';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;';
  document.body.prepend(canvas);

  const ctx = canvas.getContext('2d');
  let w, h, mouse = { x: -1000, y: -1000 };
  const particles = [], cars = [], bolts = [], batteryBars = [], signals = [];

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', resize);
  document.addEventListener('mousemove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });

  const colors = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b'];
  const isDark = () => document.documentElement.classList.contains('dark');

  // --- Floating Particles (data nodes) ---
  for (let i = 0; i < 50; i++) {
    particles.push({
      x: Math.random() * 3000, y: Math.random() * 2000,
      vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.5 + 0.5,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.4 + 0.15,
    });
  }

  // --- Miniature Cars (driving across screen) ---
  for (let i = 0; i < 4; i++) {
    cars.push({
      x: Math.random() * 3000, y: 100 + Math.random() * (2000 - 200),
      speed: 0.3 + Math.random() * 0.6,
      size: 8 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 0.15 + Math.random() * 0.15,
      trail: [],
    });
  }

  // --- Charging Bolts (floating lightning) ---
  for (let i = 0; i < 6; i++) {
    bolts.push({
      x: Math.random() * 3000, y: Math.random() * 2000,
      vy: -0.2 - Math.random() * 0.3,
      size: 10 + Math.random() * 8,
      alpha: 0,
      maxAlpha: 0.12 + Math.random() * 0.12,
      phase: Math.random() * Math.PI * 2,
      color: Math.random() > 0.5 ? '#00f0ff' : '#10b981',
    });
  }

  // --- Battery Level Bars (floating indicators) ---
  for (let i = 0; i < 5; i++) {
    batteryBars.push({
      x: Math.random() * 3000, y: Math.random() * 2000,
      vx: (Math.random() - 0.5) * 0.15, vy: (Math.random() - 0.5) * 0.15,
      level: 0.4 + Math.random() * 0.6,
      alpha: 0.08 + Math.random() * 0.1,
      w: 20 + Math.random() * 10, h: 8 + Math.random() * 4,
    });
  }

  // --- Signal Waves (telemetry broadcast) ---
  for (let i = 0; i < 4; i++) {
    signals.push({
      x: Math.random() * 3000, y: Math.random() * 2000,
      radius: 0, maxRadius: 40 + Math.random() * 30,
      speed: 0.3 + Math.random() * 0.3,
      alpha: 0.15 + Math.random() * 0.1,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }

  function drawCar(x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    // Car body (top-down)
    const s = size;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.4, y - s);
    ctx.lineTo(x + s * 0.4, y - s);
    ctx.quadraticCurveTo(x + s * 0.5, y - s, x + s * 0.5, y - s * 0.8);
    ctx.lineTo(x + s * 0.55, y + s * 0.6);
    ctx.quadraticCurveTo(x + s * 0.55, y + s, x + s * 0.3, y + s);
    ctx.lineTo(x - s * 0.3, y + s);
    ctx.quadraticCurveTo(x - s * 0.55, y + s, x - s * 0.55, y + s * 0.6);
    ctx.lineTo(x - s * 0.5, y - s * 0.8);
    ctx.quadraticCurveTo(x - s * 0.5, y - s, x - s * 0.4, y - s);
    ctx.stroke();
    // Windshield
    ctx.beginPath();
    ctx.moveTo(x - s * 0.35, y - s * 0.5);
    ctx.lineTo(x - s * 0.25, y - s * 0.8);
    ctx.lineTo(x + s * 0.25, y - s * 0.8);
    ctx.lineTo(x + s * 0.35, y - s * 0.5);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha * 0.3;
    ctx.fill();
    // Headlights
    ctx.globalAlpha = alpha * 1.5;
    ctx.fillStyle = color;
    ctx.fillRect(x - s * 0.4, y - s * 1.02, s * 0.25, s * 0.12);
    ctx.fillRect(x + s * 0.15, y - s * 1.02, s * 0.25, s * 0.12);
    // Taillights
    ctx.fillStyle = '#ef4444';
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillRect(x - s * 0.4, y + s * 0.92, s * 0.25, s * 0.1);
    ctx.fillRect(x + s * 0.15, y + s * 0.92, s * 0.25, s * 0.1);
    ctx.restore();
  }

  function drawBolt(x, y, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const s = size;
    ctx.beginPath();
    ctx.moveTo(x + s * 0.15, y - s * 0.5);
    ctx.lineTo(x - s * 0.1, y);
    ctx.lineTo(x + s * 0.05, y);
    ctx.lineTo(x - s * 0.15, y + s * 0.5);
    ctx.stroke();
    // Glow
    ctx.globalAlpha = alpha * 0.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.stroke();
    ctx.restore();
  }

  function drawBattery(x, y, w, h, level, alpha, dark) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const borderColor = dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.15)';
    // Outline
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 0.8;
    ctx.strokeRect(x, y, w, h);
    // Terminal
    ctx.fillStyle = borderColor;
    ctx.fillRect(x + w, y + h * 0.25, w * 0.1, h * 0.5);
    // Fill
    const fillColor = level > 0.6 ? '#10b981' : level > 0.3 ? '#f59e0b' : '#ef4444';
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillRect(x + 1, y + 1, (w - 2) * level, h - 2);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    const dark = isDark();
    canvas.style.opacity = dark ? '1' : '0.6';

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
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
          ctx.strokeStyle = p.color;
          ctx.globalAlpha = (1 - dist / 100) * 0.1;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }

      // Mouse interaction
      const mdist = Math.hypot(p.x - mouse.x, p.y - mouse.y);
      if (mdist < 150) {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y);
        ctx.strokeStyle = '#00f0ff';
        ctx.globalAlpha = (1 - mdist / 150) * 0.25;
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }

    // --- Cars ---
    const t = Date.now() * 0.001;
    for (const car of cars) {
      car.y -= car.speed;
      if (car.y < -30) { car.y = h + 30; car.x = 50 + Math.random() * (w - 100); }
      // Trail
      car.trail.push({ x: car.x, y: car.y });
      if (car.trail.length > 20) car.trail.shift();
      ctx.beginPath();
      ctx.globalAlpha = car.alpha * 0.3;
      ctx.strokeStyle = car.color;
      ctx.lineWidth = 0.5;
      for (let i = 1; i < car.trail.length; i++) {
        ctx.moveTo(car.trail[i - 1].x, car.trail[i - 1].y);
        ctx.lineTo(car.trail[i].x, car.trail[i].y);
      }
      ctx.stroke();
      drawCar(car.x, car.y, car.size, car.color, car.alpha);
    }

    // --- Charging Bolts ---
    for (const b of bolts) {
      b.y += b.vy;
      b.alpha = b.maxAlpha * (0.5 + 0.5 * Math.sin(t * 2 + b.phase));
      if (b.y < -30) { b.y = h + 30; b.x = Math.random() * w; }
      drawBolt(b.x, b.y, b.size, b.color, b.alpha);
    }

    // --- Battery Bars ---
    for (const bb of batteryBars) {
      bb.x += bb.vx; bb.y += bb.vy;
      if (bb.x < -30) bb.x = w + 30; if (bb.x > w + 30) bb.x = -30;
      if (bb.y < -30) bb.y = h + 30; if (bb.y > h + 30) bb.y = -30;
      bb.level = 0.3 + 0.5 * (0.5 + 0.5 * Math.sin(t * 0.5 + bb.x * 0.01));
      drawBattery(bb.x, bb.y, bb.w, bb.h, bb.level, bb.alpha, dark);
    }

    // --- Signal Waves ---
    for (const sig of signals) {
      sig.radius += sig.speed;
      if (sig.radius > sig.maxRadius) { sig.radius = 0; sig.x = Math.random() * w; sig.y = Math.random() * h; }
      for (let r = 0; r < 3; r++) {
        const rr = sig.radius - r * 8;
        if (rr > 0) {
          ctx.beginPath();
          ctx.arc(sig.x, sig.y, rr, -Math.PI * 0.4, Math.PI * 0.4);
          ctx.strokeStyle = sig.color;
          ctx.globalAlpha = sig.alpha * (1 - rr / sig.maxRadius);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    ctx.globalAlpha = 1;
    requestAnimationFrame(draw);
  }
  draw();
})();
