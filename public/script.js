// Walden's Revisited
// "I went to the woods because I wished to live deliberately."

(function () {
  'use strict';

  // ============================================
  // POND CANVAS - Gentle flowing water animation
  // ============================================
  var canvas = document.getElementById('pondCanvas');
  if (canvas) {
    var ctx = canvas.getContext('2d');
    var w, h, dpr;
    var time = 0;
    var frameId;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.parentElement.clientWidth;
      h = canvas.parentElement.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    }

    resize();
    window.addEventListener('resize', resize);

    // Color palette
    var skyTop = [164, 190, 180];
    var skyMid = [200, 216, 206];
    var skyBot = [228, 238, 228];
    var waterTop = [118, 158, 138];
    var waterBot = [80, 120, 100];
    var treeDark = [48, 72, 52];
    var treeMid = [60, 90, 60];
    var treeLight = [72, 108, 72];
    var grassCol = [88, 128, 76];

    function lerpColor(a, b, t) {
      return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t
      ];
    }

    function rgb(c, alpha) {
      if (alpha !== undefined) return 'rgba(' + ~~c[0] + ',' + ~~c[1] + ',' + ~~c[2] + ',' + alpha + ')';
      return 'rgb(' + ~~c[0] + ',' + ~~c[1] + ',' + ~~c[2] + ')';
    }

    // Fireflies
    var fireflies = [];
    for (var i = 0; i < 12; i++) {
      fireflies.push({
        x: Math.random(),
        y: 0.25 + Math.random() * 0.35,
        vx: (Math.random() - 0.5) * 0.0003,
        vy: (Math.random() - 0.5) * 0.0002,
        phase: Math.random() * Math.PI * 2,
        size: 1.5 + Math.random() * 2,
        speed: 0.5 + Math.random() * 1.5
      });
    }

    // Water ripple points
    var ripples = [];
    function addRipple() {
      ripples.push({
        x: 0.2 + Math.random() * 0.6,
        y: 0.7 + Math.random() * 0.15,
        r: 0,
        maxR: 30 + Math.random() * 50,
        alpha: 0.15,
        speed: 0.3 + Math.random() * 0.4
      });
    }
    // Start with a few ripples
    for (var ri = 0; ri < 3; ri++) {
      var rp = {
        x: 0.2 + Math.random() * 0.6,
        y: 0.7 + Math.random() * 0.15,
        r: Math.random() * 40,
        maxR: 30 + Math.random() * 50,
        alpha: 0.08,
        speed: 0.3 + Math.random() * 0.4
      };
      ripples.push(rp);
    }

    function drawSky() {
      var skyH = h * 0.58;
      var grad = ctx.createLinearGradient(0, 0, 0, skyH);
      grad.addColorStop(0, rgb(skyTop));
      grad.addColorStop(0.5, rgb(skyMid));
      grad.addColorStop(1, rgb(skyBot));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, skyH);

      // Soft clouds
      ctx.save();
      ctx.globalAlpha = 0.06;
      var cloudX1 = (time * 3) % (w + 400) - 200;
      var cloudX2 = ((time * 2) + w * 0.6) % (w + 500) - 250;
      drawCloud(cloudX1, h * 0.12, 180, 40);
      drawCloud(cloudX2, h * 0.2, 220, 35);
      ctx.restore();
    }

    function drawCloud(cx, cy, rw, rh) {
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(cx, cy, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx - rw * 0.4, cy + rh * 0.2, rw * 0.6, rh * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + rw * 0.35, cy + rh * 0.15, rw * 0.5, rh * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawTreeline(yBase, heights, color, waveAmp, waveSpeed) {
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.moveTo(0, yBase);
      var segments = 40;
      for (var i = 0; i <= segments; i++) {
        var x = (i / segments) * w;
        var treeH = heights[i % heights.length];
        var wave = Math.sin(time * waveSpeed + i * 0.8) * waveAmp;
        var y = yBase - treeH - wave;
        if (i === 0) ctx.lineTo(x, y);
        else {
          var cpx = x - w / segments / 2;
          ctx.quadraticCurveTo(cpx, y - 5, x, y);
        }
      }
      ctx.lineTo(w, yBase + 20);
      ctx.lineTo(0, yBase + 20);
      ctx.closePath();
      ctx.fill();
    }

    // Individual tree shapes
    function drawTree(x, baseY, trunkH, canopyW, canopyH, color) {
      // Trunk
      ctx.fillStyle = 'rgb(70, 55, 35)';
      ctx.fillRect(x - 3, baseY - trunkH * 0.4, 6, trunkH * 0.4);
      // Canopy (layered ellipses)
      ctx.fillStyle = rgb(color);
      ctx.beginPath();
      ctx.ellipse(x, baseY - trunkH * 0.5, canopyW * 0.8, canopyH * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x - canopyW * 0.25, baseY - trunkH * 0.65, canopyW * 0.55, canopyH * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + canopyW * 0.2, baseY - trunkH * 0.7, canopyW * 0.5, canopyH * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, baseY - trunkH * 0.85, canopyW * 0.45, canopyH * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    function drawPond() {
      var pondCy = h * 0.72;
      var pondRx = w * 0.44;
      var pondRy = h * 0.16;

      // Water body
      var waterGrad = ctx.createRadialGradient(
        w * 0.5, pondCy - pondRy * 0.3, 0,
        w * 0.5, pondCy, pondRx
      );
      waterGrad.addColorStop(0, rgb(waterTop, 0.95));
      waterGrad.addColorStop(0.6, rgb(lerpColor(waterTop, waterBot, 0.5), 0.92));
      waterGrad.addColorStop(1, rgb(waterBot, 0.88));

      ctx.fillStyle = waterGrad;
      ctx.beginPath();
      ctx.ellipse(w * 0.5, pondCy, pondRx, pondRy, 0, 0, Math.PI * 2);
      ctx.fill();

      // Flowing water surface - gentle wave lines
      ctx.save();
      ctx.clip(); // clip to pond shape

      for (var wl = 0; wl < 8; wl++) {
        var waveY = pondCy - pondRy * 0.6 + (wl / 8) * pondRy * 1.4;
        var waveAlpha = 0.04 + Math.sin(time * 0.5 + wl) * 0.02;
        ctx.strokeStyle = 'rgba(255,255,255,' + waveAlpha + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (var wx = -20; wx <= w + 20; wx += 4) {
          var wy = waveY +
            Math.sin(wx * 0.008 + time * 0.4 + wl * 1.2) * 4 +
            Math.sin(wx * 0.015 + time * 0.25 + wl * 0.7) * 2.5 +
            Math.sin(wx * 0.003 + time * 0.15) * 6;
          if (wx === -20) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        }
        ctx.stroke();
      }

      // Shimmer highlights - slowly drifting
      for (var sh = 0; sh < 5; sh++) {
        var shX = w * 0.25 + (sh / 5) * w * 0.5 + Math.sin(time * 0.2 + sh * 2) * 30;
        var shY = pondCy - pondRy * 0.3 + Math.sin(time * 0.3 + sh * 1.5) * pondRy * 0.3;
        var shAlpha = 0.06 + Math.sin(time * 0.4 + sh * 1.8) * 0.04;
        var shW = 40 + Math.sin(time * 0.3 + sh) * 15;
        ctx.fillStyle = 'rgba(255,255,255,' + shAlpha + ')';
        ctx.beginPath();
        ctx.ellipse(shX, shY, shW, 3, 0.1, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Ripple rings
      for (var r = ripples.length - 1; r >= 0; r--) {
        var rip = ripples[r];
        rip.r += rip.speed;
        rip.alpha *= 0.995;
        if (rip.r > rip.maxR || rip.alpha < 0.005) {
          ripples.splice(r, 1);
          continue;
        }
        ctx.strokeStyle = 'rgba(255,255,255,' + rip.alpha + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(rip.x * w, rip.y * h, rip.r, rip.r * 0.3, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Spawn new ripples occasionally
      if (Math.random() < 0.008) addRipple();
    }

    function drawShoreline() {
      var shoreY = h * 0.58;
      // Grassy bank - static undulation, no per-frame animation for smooth performance
      ctx.fillStyle = rgb(grassCol);
      ctx.beginPath();
      ctx.moveTo(0, shoreY);
      for (var sx = 0; sx <= w; sx += 30) {
        var sy = shoreY + Math.sin(sx * 0.012) * 4 +
          Math.sin(sx * 0.025 + 1) * 3;
        ctx.lineTo(sx, sy);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();

      // Darker earth under grass
      ctx.fillStyle = 'rgb(65, 90, 55)';
      ctx.beginPath();
      ctx.moveTo(0, shoreY + 12);
      for (var sx2 = 0; sx2 <= w; sx2 += 30) {
        var sy2 = shoreY + 12 + Math.sin(sx2 * 0.012 + 0.5) * 4;
        ctx.lineTo(sx2, sy2);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    }

    function drawReeds(baseX, baseY, count) {
      for (var r = 0; r < count; r++) {
        var rx = baseX + (r - count / 2) * 12;
        var rHeight = 40 + Math.random() * 30;
        var sway = Math.sin(time * 0.6 + r * 0.9 + baseX * 0.01) * 4;

        // Stem
        ctx.strokeStyle = 'rgb(72, 95, 50)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx, baseY);
        ctx.quadraticCurveTo(rx + sway * 0.5, baseY - rHeight * 0.5, rx + sway, baseY - rHeight);
        ctx.stroke();

        // Cattail head
        ctx.fillStyle = 'rgb(90, 65, 35)';
        ctx.beginPath();
        ctx.ellipse(rx + sway, baseY - rHeight - 6, 3.5, 9, 0.1 + sway * 0.02, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawFireflies() {
      for (var f = 0; f < fireflies.length; f++) {
        var ff = fireflies[f];
        ff.x += ff.vx;
        ff.y += ff.vy + Math.sin(time * 0.3 + ff.phase) * 0.00008;
        ff.phase += 0.02 * ff.speed;

        // Bounce
        if (ff.x < 0.05 || ff.x > 0.95) ff.vx *= -1;
        if (ff.y < 0.2 || ff.y > 0.55) ff.vy *= -1;

        var glow = (Math.sin(ff.phase) + 1) * 0.5;
        if (glow < 0.3) continue; // Only show when glowing

        var fx = ff.x * w;
        var fy = ff.y * h;
        var alpha = glow * 0.7;

        // Outer glow
        var glowGrad = ctx.createRadialGradient(fx, fy, 0, fx, fy, ff.size * 6);
        glowGrad.addColorStop(0, 'rgba(220, 230, 160, ' + (alpha * 0.3) + ')');
        glowGrad.addColorStop(1, 'rgba(220, 230, 160, 0)');
        ctx.fillStyle = glowGrad;
        ctx.beginPath();
        ctx.arc(fx, fy, ff.size * 6, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = 'rgba(240, 245, 200, ' + alpha + ')';
        ctx.beginPath();
        ctx.arc(fx, fy, ff.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawReflections() {
      var pondCy = h * 0.72;
      var pondRy = h * 0.16;

      // Tree reflections in water (blurred, inverted)
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(w * 0.5, pondCy, w * 0.44, pondRy, 0, 0, Math.PI * 2);
      ctx.clip();

      ctx.globalAlpha = 0.12;
      // Left tree reflection
      ctx.fillStyle = rgb(treeDark);
      ctx.beginPath();
      ctx.ellipse(w * 0.08, pondCy + 10, 45, 50, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.15, pondCy + 5, 40, 45, 0, 0, Math.PI * 2);
      ctx.fill();
      // Right tree reflection
      ctx.beginPath();
      ctx.ellipse(w * 0.88, pondCy + 8, 50, 48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.92, pondCy + 12, 35, 42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    var treeHeights1 = [];
    var treeHeights2 = [];
    var treeHeights3 = [];
    for (var t = 0; t <= 40; t++) {
      treeHeights1.push(35 + Math.random() * 30);
      treeHeights2.push(50 + Math.random() * 40);
      treeHeights3.push(40 + Math.random() * 35);
    }

    function draw() {
      ctx.clearRect(0, 0, w, h);

      // Sky
      drawSky();

      // Distant treeline layers
      var baseTree = h * 0.52;
      drawTreeline(baseTree + 15, treeHeights1, [75, 108, 72], 0.8, 0.15);
      drawTreeline(baseTree + 8, treeHeights2, [58, 88, 58], 1.2, 0.12);
      drawTreeline(baseTree, treeHeights3, treeMid, 1.5, 0.1);

      // Individual foreground trees
      var treeBase = h * 0.57;
      drawTree(w * 0.06, treeBase, h * 0.28, 50, 45, treeDark);
      drawTree(w * 0.13, treeBase + 5, h * 0.22, 40, 38, treeMid);
      drawTree(w * 0.02, treeBase + 8, h * 0.18, 35, 32, treeLight);

      drawTree(w * 0.88, treeBase - 2, h * 0.3, 55, 48, treeDark);
      drawTree(w * 0.95, treeBase + 3, h * 0.24, 42, 40, treeMid);
      drawTree(w * 0.82, treeBase + 6, h * 0.2, 38, 35, treeLight);

      // Shoreline / grass bank
      drawShoreline();

      // Pond water
      drawPond();

      // Tree reflections in water
      drawReflections();

      // Fireflies (in the air, above the pond)
      drawFireflies();

      // Subtle vignette overlay
      var vig = ctx.createRadialGradient(w * 0.5, h * 0.45, h * 0.3, w * 0.5, h * 0.5, h * 0.9);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(0,0,0,0.12)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      time += 0.016;
      frameId = requestAnimationFrame(draw);
    }

    // Only animate when visible
    var heroObserver = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) {
        if (!frameId) draw();
      } else {
        if (frameId) {
          cancelAnimationFrame(frameId);
          frameId = null;
        }
      }
    }, { threshold: 0.05 });
    heroObserver.observe(canvas.parentElement.parentElement);

    draw();
  }

  // ============================================
  // NAVIGATION
  // ============================================
  var nav = document.getElementById('nav');
  window.addEventListener('scroll', function () {
    if (window.scrollY > 50) nav.classList.add('scrolled');
    else nav.classList.remove('scrolled');
  }, { passive: true });

  // Mobile nav toggle
  var toggle = document.getElementById('navToggle');
  var links = document.getElementById('navLinks');
  var isMembersPage = !!document.querySelector('.members-layout');

  if (toggle && links && !isMembersPage) {
    toggle.addEventListener('click', function () {
      links.classList.toggle('open');
      var spans = toggle.querySelectorAll('span');
      if (links.classList.contains('open')) {
        document.body.classList.add('body-lock');
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(5px, -5px)';
      } else {
        document.body.classList.remove('body-lock');
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      }
    });

    links.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        links.classList.remove('open');
        document.body.classList.remove('body-lock');
        var spans = toggle.querySelectorAll('span');
        spans[0].style.transform = '';
        spans[1].style.opacity = '';
        spans[2].style.transform = '';
      });
    });
  }

  // ============================================
  // SCROLL REVEAL
  // ============================================
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) entry.target.classList.add('visible');
    });
  }, { threshold: 0.01, rootMargin: '0px 0px -20px 0px' });

  document.querySelectorAll(
    '.section-header, .about-text, .about-quote, .feature-card, ' +
    '.common-areas-text, .common-areas-map, .covenants-content, .contact-content'
  ).forEach(function (el) { observer.observe(el); });

  // Active nav link highlighting
  var sections = document.querySelectorAll('.section, .hero');
  var navLinks2 = document.querySelectorAll('.nav-links a');

  window.addEventListener('scroll', function () {
    var scrollPos = window.scrollY + 100;
    sections.forEach(function (section) {
      var top = section.offsetTop;
      var height = section.offsetHeight;
      var id = section.getAttribute('id');
      if (scrollPos >= top && scrollPos < top + height) {
        navLinks2.forEach(function (link) {
          link.style.color = '';
          if (link.getAttribute('href') === '#' + id) {
            link.style.color = 'var(--forest-deep)';
          }
        });
      }
    });
  }, { passive: true });
})();
