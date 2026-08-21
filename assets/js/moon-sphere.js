/*
 * MoonSphere — an on-demand, dependency-free WebGL moon renderer.
 *
 * Public API:
 *   const moon = MoonSphere.create({
 *     host: '.moon-sphere',
 *     portrait: 'assets/vitality/moon-field-portrait.jpg',
 *     surfaceAngle: 0, // radians
 *     lightAngle: 0    // radians; 0 = full, Math.PI = new moon
 *   });
 *
 *   if (moon) moon.setState({ surfaceAngle, lightAngle });
 *
 * `create` returns false when WebGL cannot be initialized. The existing CSS
 * moon can therefore remain in the host as a no-script / no-WebGL fallback.
 */
(function attachMoonSphere(global) {
  'use strict';

  var TAU = Math.PI * 2;
  var DEFAULT_DPR_CAP = 1.75;

  var VERTEX_SHADER = [
    'attribute vec2 aPosition;',
    'varying vec2 vUv;',
    'void main() {',
    '  vUv = aPosition * 0.5 + 0.5;',
    '  gl_Position = vec4(aPosition, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FRAGMENT_SHADER = [
    'precision highp float;',
    '',
    'varying vec2 vUv;',
    'uniform vec2 uResolution;',
    'uniform float uSurfaceAngle;',
    'uniform float uLightAngle;',
    'uniform float uPortraitOpacity;',
    'uniform float uPortraitAspect;',
    'uniform float uPortraitRotationScale;',
    'uniform float uHasPortrait;',
    'uniform sampler2D uPortrait;',
    '',
    'const float PI = 3.141592653589793;',
    '',
    'vec3 rotateY(vec3 p, float angle) {',
    '  float c = cos(angle);',
    '  float s = sin(angle);',
    '  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);',
    '}',
    '',
    'float crater(vec3 n, vec3 center, float radius) {',
    '  float d = 1.0 - dot(n, normalize(center));',
    '  float bowl = 1.0 - smoothstep(radius * 0.15, radius * 0.72, d);',
    '  float rim = smoothstep(radius * 0.56, radius * 0.78, d)',
    '            * (1.0 - smoothstep(radius * 0.78, radius, d));',
    '  return rim * 0.9 - bowl * 0.34;',
    '}',
    '',
    'float moonTexture(vec3 n) {',
    '  float broad = sin(n.x * 8.7 + sin(n.z * 6.1) * 1.8)',
    '              + sin(n.y * 11.3 - n.x * 4.4) * 0.7;',
    '  float medium = sin(dot(n, vec3(17.0, 23.0, 11.0)))',
    '               + sin(dot(n, vec3(-29.0, 13.0, 19.0))) * 0.55;',
    '  float fine = sin(dot(n, vec3(57.0, -41.0, 33.0))) * 0.22;',
    '  float craters = crater(n, vec3(-0.42, 0.31, 0.85), 0.070)',
    '                + crater(n, vec3(0.55, -0.22, 0.80), 0.052)',
    '                + crater(n, vec3(0.08, 0.62, 0.76), 0.035)',
    '                + crater(n, vec3(-0.64, -0.45, 0.61), 0.044);',
    '  return broad * 0.055 + medium * 0.028 + fine * 0.012 + craters * 0.12;',
    '}',
    '',
    'vec2 coverUv(vec2 uv, float sourceAspect) {',
    '  if (sourceAspect < 1.0) {',
    '    uv.y = (uv.y - 0.5) * sourceAspect + 0.5;',
    '  } else {',
    '    uv.x = (uv.x - 0.5) / sourceAspect + 0.5;',
    '  }',
    '  return uv;',
    '}',
    '',
    'void main() {',
    '  vec2 p = vUv * 2.0 - 1.0;',
    '  p.x *= uResolution.x / max(uResolution.y, 1.0);',
    '  float radiusSquared = dot(p, p);',
    '  if (radiusSquared > 1.0) {',
    '    gl_FragColor = vec4(0.0);',
    '    return;',
    '  }',
    '',
    '  vec3 normal = normalize(vec3(p, sqrt(max(0.0, 1.0 - radiusSquared))));',
    '  vec3 objectNormal = rotateY(normal, -uSurfaceAngle);',
    '  vec3 lightDirection = normalize(vec3(sin(uLightAngle), 0.10, cos(uLightAngle)));',
    '  float ndl = dot(normal, lightDirection);',
    '',
    '  // A soft, continuous terminator keeps the phase dimensional without',
    '  // turning the unlit side into a flat black mask.',
    '  float illuminated = smoothstep(-0.14, 0.10, ndl);',
    '  float diffuse = 0.58 + 0.50 * max(ndl, 0.0);',
    '  float limb = pow(max(normal.z, 0.0), 0.34);',
    '  float textureSignal = moonTexture(objectNormal);',
    '',
    '  vec3 moonLight = mix(vec3(0.64, 0.71, 0.91), vec3(0.96, 0.95, 0.91), 0.54);',
    '  moonLight *= 1.0 + textureSignal;',
    '',
    '  // The portrait is a shallow front decal, not an equirectangular wrap.',
    '  // Its rotation is deliberately slower than the lunar surface so a face',
    '  // never stretches around the full 360-degree sphere.',
    '  float portraitRock = sin(uSurfaceAngle) * uPortraitRotationScale;',
    '  vec3 portraitNormal = rotateY(normal, -portraitRock);',
    '  vec2 portraitUv = coverUv(portraitNormal.xy * 0.5 + 0.5, uPortraitAspect);',
    '  float portraitFront = smoothstep(0.02, 0.30, portraitNormal.z);',
    '  float portraitEdge = 1.0 - smoothstep(0.82, 0.985, length(portraitNormal.xy));',
    '  float portraitBounds = step(0.0, portraitUv.x) * step(portraitUv.x, 1.0)',
    '                       * step(0.0, portraitUv.y) * step(portraitUv.y, 1.0);',
    '  float portraitMask = portraitFront * portraitEdge * portraitBounds',
    '                     * uPortraitOpacity * uHasPortrait;',
    '  vec3 portraitColor = texture2D(uPortrait, clamp(portraitUv, 0.0, 1.0)).rgb;',
    '  portraitColor = mix(vec3(dot(portraitColor, vec3(0.299, 0.587, 0.114))), portraitColor, 0.90);',
    '',
    '  vec3 surfaceColor = mix(moonLight, portraitColor, portraitMask);',
    '  surfaceColor *= 1.0 + textureSignal * portraitMask * 0.34;',
    '  // Deep-cobalt earthshine preserves the portrait and surface texture on',
    '  // the dark side while still reading clearly as lunar shadow.',
    '  vec3 shadowColor = mix(vec3(0.075, 0.115, 0.34), surfaceColor * 0.55, 0.44 + limb * 0.12);',
    '  vec3 litColor = surfaceColor * diffuse;',
    '  vec3 color = mix(shadowColor, litColor, illuminated);',
    '',
    '  // Limb darkening is what makes the disc read as a volume at a glance.',
    '  color *= mix(0.70, 1.0, limb);',
    '  float softRim = pow(1.0 - normal.z, 5.0) * illuminated * 0.11;',
    '  color += vec3(0.48, 0.58, 0.92) * softRim;',
    '  float earthRim = pow(1.0 - normal.z, 3.0) * (1.0 - illuminated) * 0.09;',
    '  color += vec3(0.24, 0.34, 0.72) * earthRim;',
    '',
    '  gl_FragColor = vec4(color, 1.0);',
    '}'
  ].join('\n');

  function resolveElement(value) {
    if (!value) return null;
    if (typeof value === 'string') return document.querySelector(value);
    return value && value.nodeType === 1 ? value : null;
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function compileShader(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram(gl) {
    var vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    var fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
    var program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var message = gl.getProgramInfoLog(program) || 'Unknown program link error';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  function createFallbackPixel(gl) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([210, 218, 242, 255])
    );
    return texture;
  }

  function warn(message, error) {
    if (!global.console || typeof global.console.warn !== 'function') return;
    global.console.warn('[MoonSphere] ' + message, error || '');
  }

  function create(options) {
    options = options || {};
    var host = resolveElement(options.host);
    var suppliedCanvas = resolveElement(options.canvas);
    if (!host && suppliedCanvas) host = suppliedCanvas.parentElement;
    if (!host) return false;

    var canvas = suppliedCanvas || document.createElement('canvas');
    var ownsCanvas = !suppliedCanvas;
    canvas.setAttribute('aria-hidden', 'true');
    canvas.tabIndex = -1;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = String(finiteNumber(options.zIndex, 2));
    canvas.style.borderRadius = 'inherit';

    if (ownsCanvas) host.appendChild(canvas);

    var glOptions = {
      alpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      // This renderer draws only when state changes. Keeping the last frame
      // prevents an idle canvas from appearing blank in mobile compositing or
      // screenshots after the back buffer has been discarded.
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance'
    };
    var gl = canvas.getContext('webgl', glOptions)
      || canvas.getContext('experimental-webgl', glOptions);

    if (!gl) {
      if (ownsCanvas) canvas.remove();
      return false;
    }

    var state = {
      surfaceAngle: finiteNumber(options.surfaceAngle, 0),
      lightAngle: finiteNumber(options.lightAngle, 0),
      portraitOpacity: Math.max(0, Math.min(1, finiteNumber(options.portraitOpacity, 0.88))),
      portraitAspect: 1,
      portraitRotationScale: Math.max(0, Math.min(1, finiteNumber(options.portraitRotationScale, 0.16)))
    };
    var dprCap = Math.max(1, Math.min(2, finiteNumber(options.dprCap, DEFAULT_DPR_CAP)));
    var program = null;
    var positionBuffer = null;
    var portraitTexture = null;
    var portraitSource = null;
    var hasPortrait = false;
    var renderFrame = 0;
    var destroyed = false;
    var paused = false;
    var contextLost = false;
    var visible = true;
    var resizeObserver = null;
    var intersectionObserver = null;

    var locations = {};

    function initializeResources() {
      program = createProgram(gl);
      positionBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW
      );

      locations.position = gl.getAttribLocation(program, 'aPosition');
      locations.resolution = gl.getUniformLocation(program, 'uResolution');
      locations.surfaceAngle = gl.getUniformLocation(program, 'uSurfaceAngle');
      locations.lightAngle = gl.getUniformLocation(program, 'uLightAngle');
      locations.portraitOpacity = gl.getUniformLocation(program, 'uPortraitOpacity');
      locations.portraitAspect = gl.getUniformLocation(program, 'uPortraitAspect');
      locations.portraitRotationScale = gl.getUniformLocation(program, 'uPortraitRotationScale');
      locations.hasPortrait = gl.getUniformLocation(program, 'uHasPortrait');
      locations.portrait = gl.getUniformLocation(program, 'uPortrait');
      portraitTexture = createFallbackPixel(gl);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

      if (portraitSource) uploadPortrait(portraitSource);
    }

    function deleteResources() {
      if (!gl) return;
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (portraitTexture) gl.deleteTexture(portraitTexture);
      if (program) gl.deleteProgram(program);
      positionBuffer = null;
      portraitTexture = null;
      program = null;
    }

    function uploadPortrait(source) {
      if (!source || !portraitTexture || contextLost || destroyed) return false;
      try {
        var width = source.naturalWidth || source.videoWidth || source.width || 1;
        var height = source.naturalHeight || source.videoHeight || source.height || 1;
        if (!width || !height) return false;
        gl.bindTexture(gl.TEXTURE_2D, portraitTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        portraitSource = source;
        state.portraitAspect = width / height;
        hasPortrait = true;
        scheduleRender();
        return true;
      } catch (error) {
        hasPortrait = false;
        warn('Portrait upload failed; continuing with the procedural moon.', error);
        scheduleRender();
        return false;
      }
    }

    function setPortrait(source) {
      if (!source) {
        portraitSource = null;
        hasPortrait = false;
        scheduleRender();
        return Promise.resolve(true);
      }
      if (typeof source !== 'string') {
        return Promise.resolve(uploadPortrait(source));
      }

      return new Promise(function loadPortrait(resolve) {
        var image = new Image();
        image.decoding = 'async';
        image.onload = function onPortraitLoad() {
          resolve(uploadPortrait(image));
        };
        image.onerror = function onPortraitError(error) {
          hasPortrait = false;
          warn('Portrait image could not be loaded; continuing without it.', error);
          scheduleRender();
          resolve(false);
        };
        image.src = source;
      });
    }

    function resize() {
      if (destroyed || contextLost) return false;
      var rect = host.getBoundingClientRect();
      var cssWidth = Math.max(1, Math.round(rect.width || host.clientWidth || 1));
      var cssHeight = Math.max(1, Math.round(rect.height || host.clientHeight || cssWidth));
      var dpr = Math.min(dprCap, Math.max(1, global.devicePixelRatio || 1));
      var width = Math.max(1, Math.round(cssWidth * dpr));
      var height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width === width && canvas.height === height) return false;
      canvas.width = width;
      canvas.height = height;
      return true;
    }

    function render() {
      renderFrame = 0;
      if (destroyed || paused || contextLost || !visible || !program) return false;
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(locations.position);
      gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(locations.resolution, canvas.width, canvas.height);
      gl.uniform1f(locations.surfaceAngle, state.surfaceAngle);
      gl.uniform1f(locations.lightAngle, state.lightAngle);
      gl.uniform1f(locations.portraitOpacity, state.portraitOpacity);
      gl.uniform1f(locations.portraitAspect, state.portraitAspect);
      gl.uniform1f(locations.portraitRotationScale, state.portraitRotationScale);
      gl.uniform1f(locations.hasPortrait, hasPortrait ? 1 : 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, portraitTexture);
      gl.uniform1i(locations.portrait, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      host.dataset.moonSphere = hasPortrait ? 'portrait' : 'procedural';
      canvas.hidden = false;
      return true;
    }

    function scheduleRender() {
      if (destroyed || paused || contextLost || !visible || renderFrame) return;
      renderFrame = global.requestAnimationFrame(render);
    }

    function setState(nextState) {
      if (destroyed || !nextState) return controller;
      if (Number.isFinite(nextState.surfaceAngle)) state.surfaceAngle = nextState.surfaceAngle;
      if (Number.isFinite(nextState.lightAngle)) state.lightAngle = nextState.lightAngle;
      if (Number.isFinite(nextState.portraitOpacity)) {
        state.portraitOpacity = Math.max(0, Math.min(1, nextState.portraitOpacity));
      }
      if (Number.isFinite(nextState.portraitRotationScale)) {
        state.portraitRotationScale = Math.max(0, Math.min(1, nextState.portraitRotationScale));
      }
      scheduleRender();
      return controller;
    }

    function pause() {
      paused = true;
      if (renderFrame) global.cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      return controller;
    }

    function resume() {
      paused = false;
      scheduleRender();
      return controller;
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      if (renderFrame) global.cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      resizeObserver && resizeObserver.disconnect();
      intersectionObserver && intersectionObserver.disconnect();
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      deleteResources();
      delete host.dataset.moonSphere;
      if (ownsCanvas) canvas.remove();
    }

    function handleContextLost(event) {
      event.preventDefault();
      contextLost = true;
      if (renderFrame) global.cancelAnimationFrame(renderFrame);
      renderFrame = 0;
      canvas.hidden = true;
      host.dataset.moonSphere = 'lost';
      if (typeof options.onContextLost === 'function') options.onContextLost(controller);
    }

    function handleContextRestored() {
      contextLost = false;
      try {
        initializeResources();
        scheduleRender();
        if (typeof options.onContextRestored === 'function') options.onContextRestored(controller);
      } catch (error) {
        canvas.hidden = true;
        host.dataset.moonSphere = 'failed';
        warn('WebGL context restoration failed; CSS fallback remains visible.', error);
      }
    }

    var controller = {
      canvas: canvas,
      host: host,
      ready: Promise.resolve(true),
      setState: setState,
      setPortrait: setPortrait,
      render: render,
      resize: function publicResize() {
        resize();
        scheduleRender();
        return controller;
      },
      pause: pause,
      resume: resume,
      destroy: destroy,
      getState: function getState() {
        return {
          surfaceAngle: state.surfaceAngle,
          lightAngle: state.lightAngle,
          portraitOpacity: state.portraitOpacity,
          portraitRotationScale: state.portraitRotationScale,
          hasPortrait: hasPortrait,
          contextLost: contextLost
        };
      }
    };

    canvas.addEventListener('webglcontextlost', handleContextLost, false);
    canvas.addEventListener('webglcontextrestored', handleContextRestored, false);

    try {
      initializeResources();
    } catch (error) {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      if (ownsCanvas) canvas.remove();
      warn('WebGL initialization failed; CSS fallback remains visible.', error);
      return false;
    }

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(function onResize() {
        if (resize()) scheduleRender();
      });
      resizeObserver.observe(host);
    }

    if (options.autoPause !== false && typeof IntersectionObserver !== 'undefined') {
      intersectionObserver = new IntersectionObserver(function onVisibility(entries) {
        visible = entries[0] ? entries[0].isIntersecting : true;
        if (visible) scheduleRender();
      }, { rootMargin: '160px 0px', threshold: 0 });
      intersectionObserver.observe(host);
    }

    resize();
    scheduleRender();
    if (options.portrait) controller.ready = setPortrait(options.portrait);
    return controller;
  }

  global.MoonSphere = Object.freeze({
    create: create,
    isSupported: function isSupported() {
      try {
        var canvas = document.createElement('canvas');
        return Boolean(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
      } catch (error) {
        return false;
      }
    },
    phaseToLightAngle: function phaseToLightAngle(phase) {
      return finiteNumber(phase, 0) * TAU;
    }
  });
})(window);
