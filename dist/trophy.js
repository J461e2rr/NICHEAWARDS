const trophy = document.querySelector('.trophy');
const art = document.querySelector('.art');
const nominations = document.querySelector('.nominations');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const compact = matchMedia('(max-width: 680px)');

const mix = (start, end, progress) => start + (end - start) * progress;
let frame;

function placeTrophy() {
  const start = art.getBoundingClientRect();
  const end = nominations.getBoundingClientRect();
  const stage = trophy.parentElement.getBoundingClientRect();
  if (compact.matches) {
    trophy.style.setProperty('--trophy-x', (start.left + start.width / 2 - stage.left) + 'px');
    trophy.style.setProperty('--trophy-y', (start.bottom - trophy.offsetHeight / 2 - stage.top) + 'px');
    trophy.style.setProperty('--trophy-scale', '1');
    trophy.removeAttribute('data-side');
    return;
  }
  const distance = Math.max(start.height * .85, 240);
  const progress = Math.min(1, Math.max(0, -start.top / distance));
  const blend = motion.matches ? Number(progress > .5) : progress ** 2 * (3 - 2 * progress);
  const x = mix(start.left - stage.left + start.width * .52, stage.width * .925, blend);
  const y = mix(start.top + start.height * .49, end.top + end.height * .5, blend) - stage.top;
  const backgroundScale = Math.max(1, Math.min(end.height * 1.03 / trophy.offsetHeight, 5));

  trophy.style.setProperty('--trophy-x', x + 'px');
  trophy.style.setProperty('--trophy-y', y + 'px');
  trophy.style.setProperty('--trophy-scale', mix(1, backgroundScale, blend));
  trophy.toggleAttribute('data-side', blend > .46);
}

function queuePlacement() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(placeTrophy);
}

window.addEventListener('scroll', queuePlacement, { passive: true });
motion.addEventListener('change', queuePlacement);
compact.addEventListener('change', queuePlacement);
const observer = new ResizeObserver(queuePlacement);
observer.observe(art);
observer.observe(nominations);
placeTrophy();

async function showTrophy() {
  const THREE = await import('./vendor/three.module.js');
  const host = trophy;
  const response = await fetch(new URL('./trophy.json', import.meta.url));
  if (!response.ok) throw new Error('Trophy geometry is unavailable');
  const meshes = await response.json();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  const density = Math.min(devicePixelRatio, 1.75);
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.21;
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2.3, -2.3, .1, 50);
  camera.position.set(-3.6, 2.5, 8.5);
  camera.lookAt(0, 0, 0);

  const environment = new THREE.Scene();
  environment.background = new THREE.Color('#838995');
  function softbox(x, y, z, width, height, rgb) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(...rgb), side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(geometry, material);
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    environment.add(panel);
  }
  softbox(-4, 4, 2, 3, 6, [2.7, 2.6, 2.5]);
  softbox(4, 1, -1, 1.2, 7, [3.0, 3.25, 3.6]);
  softbox(0, 6, 1, 4, 2, [2.9, 2.9, 3.0]);
  softbox(0, 1, -5, 6, 4, [1.05, 1.15, 1.3]);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(environment, .03).texture;
  scene.environmentIntensity = 1.0;
  environment.traverse(object => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  pmrem.dispose();

  const model = new THREE.Group();
  scene.add(model);
  const prism = new THREE.MeshPhysicalMaterial({
    vertexColors: true, roughness: .18, metalness: 0,
    transmission: .91, thickness: .64, ior: 1.47,
    iridescence: .13, iridescenceIOR: 1.35,
    iridescenceThicknessRange: [180, 420],
    clearcoat: .65, clearcoatRoughness: .11,
  });
  const clear = new THREE.MeshPhysicalMaterial({
    color: 0xf9fbff, roughness: .025, ior: 1.46,
    transmission: 1, thickness: .82,
    clearcoat: .55, clearcoatRoughness: .027,
  });
  const rim = new THREE.MeshStandardMaterial({ color: 0xa6afbe, metalness: .81, roughness: .24 });
  const plaque = new THREE.MeshStandardMaterial({ color: 0x242733, metalness: .35, roughness: .45 });
  const letters = new THREE.MeshStandardMaterial({ color: 0xf5f5fa, roughness: .5 });
  const materials = { Cross: prism, Monument: clear, 'Plaque | Silver rim': rim, 'Plaque | Graphite face': plaque };
  const palette = ['#c4d8f6','#c8bef1','#efc8df','#f8deca','#eae6cd','#d5e5da'].map(hex => new THREE.Color(hex));
  const color = new THREE.Color();

  for (const [name, data] of Object.entries(meshes)) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.p, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.n, 3));
    if (name === 'Cross') {
      const colors = [];
      for (let i = 0; i < data.p.length; i += 3) {
        const t = THREE.MathUtils.clamp((data.p[i + 1] + .42 * data.p[i] + .65) / 2.62, 0, 1) * (palette.length - 1);
        const step = Math.min(Math.floor(t), palette.length - 2);
        color.copy(palette[step]).lerp(palette[step + 1], t - step);
        colors.push(color.r, color.g, color.b);
      }
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    }
    const mesh = new THREE.Mesh(geometry, materials[name] || letters);
    mesh.name = name;
    model.add(mesh);
  }

  // Render the glass against its own neutral studio, then cut away everything
  // outside the geometry with a second pass. The webpage never enters the
  // glass shader or its transmission buffer.
  const colorPass = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 2 });
  const maskPass = new THREE.WebGLRenderTarget(1, 1, { samples: 2 });
  const maskMaterials = {
    Monument: new THREE.MeshBasicMaterial({ color: 0xff0000, toneMapped: false }),
    Cross: new THREE.MeshBasicMaterial({ color: 0xffff00, toneMapped: false }),
  };
  const opaqueMask = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const maskScene = new THREE.Scene();
  const maskModel = new THREE.Group();
  for (const mesh of model.children) {
    maskModel.add(new THREE.Mesh(mesh.geometry, maskMaterials[mesh.name] || opaqueMask));
  }
  maskScene.add(maskModel);
  const studioColor = new THREE.Color('#a3a8b1');
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(4.24, 4.85), new THREE.ShaderMaterial({
    uniforms: { studio: { value: studioColor } },
    vertexShader: `
      varying vec2 uvStudio;
      void main() {
        uvStudio = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 studio;
      varying vec2 uvStudio;
      void main() {
        float floorLight = 1. - smoothstep(.18, .51, uvStudio.y);
        float sidePanel = smoothstep(.13, .27, uvStudio.x) * (1. - smoothstep(.3, .46, uvStudio.x));
        float darkEdge = smoothstep(.55, .68, uvStudio.x) * (1. - smoothstep(.73, .86, uvStudio.x));
        vec3 light = studio * (1. + .43 * floorLight - .37 * darkEdge);
        light += vec3(.33, .32, .35) * sidePanel;
        gl_FragColor = vec4(light, 1.);
      }
    `,
    toneMapped: false,
  }));
  camera.updateMatrixWorld();
  backdrop.position.copy(camera.localToWorld(new THREE.Vector3(0, 0, -18)));
  backdrop.quaternion.copy(camera.quaternion);
  scene.add(backdrop);
  const composite = new THREE.Scene();
  const compositeCamera = new THREE.Camera();
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: {
      studio: { value: studioColor },
      rendered: { value: colorPass.texture },
      silhouette: { value: maskPass.texture },
    },
    vertexShader: `
      varying vec2 uvScreen;
      void main() {
        uvScreen = uv;
        gl_Position = vec4(position.xy, 0., 1.);
      }
    `,
    fragmentShader: `
      uniform vec3 studio;
      uniform sampler2D rendered;
      uniform sampler2D silhouette;
      varying vec2 uvScreen;
      void main() {
        vec3 mask = texture2D(silhouette, uvScreen).rgb;
        float coverage = mask.r;
        if (coverage < 0.002) discard;
        vec3 color = texture2D(rendered, uvScreen).rgb;
        color = max(vec3(0.), (color - (1. - coverage) * studio) / coverage);
        float transparency = .30 * (mask.r - mask.g) + .10 * (mask.g - mask.b);
        gl_FragColor = vec4(color, coverage - transparency);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
  composite.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial));

  const optics = host.querySelector('.trophy-optics');
  const base = model.getObjectByName('Monument');
  const coordinates = base.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  const unique = new Map();
  for (let i = 0; i < coordinates.count; i += 1) {
    point.fromBufferAttribute(coordinates, i);
    unique.set(point.toArray().join(','), point.clone());
  }
  const basePoints = [...unique.values()];
  function hullSide(points) {
    const hull = [];
    for (const point of points) {
      while (hull.length > 1) {
        const a = hull[hull.length - 2];
        const b = hull[hull.length - 1];
        if ((b[0] - a[0]) * (point[1] - a[1]) > (b[1] - a[1]) * (point[0] - a[0])) break;
        hull.pop();
      }
      hull.push(point);
    }
    return hull.slice(0, -1);
  }
  function projectBase() {
    const bounds = basePoints.map(vertex => {
      point.copy(vertex).applyMatrix4(base.matrixWorld).project(camera);
      return [(point.x + 1) * 50, (1 - point.y) * 50];
    }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const hull = [...hullSide(bounds), ...hullSide(bounds.reverse())];
    optics.style.clipPath = 'polygon(' + hull.map(([x, y]) => x.toFixed(2) + '% ' + y.toFixed(2) + '%').join(',') + ')';
  }

  function paint() {
    renderer.setRenderTarget(colorPass);
    renderer.setClearColor(studioColor, 1);
    renderer.render(scene, camera);

    renderer.setRenderTarget(maskPass);
    renderer.setClearColor(0x000000, 1);
    maskModel.rotation.copy(model.rotation);
    renderer.render(maskScene, camera);

    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 0);
    renderer.render(composite, compositeCamera);
    projectBase();
  }

  function resize() {
    const width = Math.max(1, Math.round(host.clientWidth * density));
    const height = Math.max(1, Math.round(host.clientHeight * density));
    renderer.setSize(width, height, false);
    colorPass.setSize(width, height);
    maskPass.setSize(width, height);
    paint();
  }
  resize();
  new ResizeObserver(resize).observe(host);
  host.toggleAttribute('data-live', true);
  host.tabIndex = 0;
  host.setAttribute('aria-label', 'Статуэтка. Перетащите влево или вправо либо используйте клавиши со стрелками');
  renderer.domElement.addEventListener('webglcontextlost', () => {
    host.removeAttribute('data-live');
    host.removeAttribute('tabindex');
    renderer.setAnimationLoop(null);
  });

  const canvas = renderer.domElement;

  let drag = null;
  let velocity = 0;
  let previousTime = 0;
  let visible = true;

  function rotate(delta) {
    model.rotation.y = (model.rotation.y + delta) % (2 * Math.PI);
    paint();
  }

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || drag) return;
    canvas.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x: event.clientX, time: event.timeStamp };
    velocity = 0;
    syncAnimation();
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    const delta = (event.clientX - drag.x) * .013;
    const dt = Math.max((event.timeStamp - drag.time) / 1000, .008);
    velocity = THREE.MathUtils.clamp(velocity * .4 + .6 * delta / dt, -9, 9);
    rotate(delta);
    drag.x = event.clientX;
    drag.time = event.timeStamp;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(name, event => {
      if (event.pointerId !== drag?.id) return;
      if (name !== 'pointerup' || event.timeStamp - drag.time > 120) velocity = 0;
      drag = null;
      syncAnimation();
    });
  }
  const arrows = { ArrowLeft: -.16, ArrowRight: .16 };
  host.addEventListener('keydown', event => {
    const direction = arrows[event.key];
    if (!direction) return;
    event.preventDefault();
    velocity = 0;
    rotate(direction);
    syncAnimation();
  });

  function syncAnimation() {
    previousTime = 0;
    if (!visible || motion.matches || drag || Math.abs(velocity) < .02) {
      renderer.setAnimationLoop(null);
      return;
    }
    renderer.setAnimationLoop(time => {
      const dt = previousTime ? Math.min((time - previousTime) / 1000, .04) : 0;
      previousTime = time;
      rotate(velocity * dt);
      velocity *= Math.exp(-1.4 * dt);
      if (Math.abs(velocity) < .02) syncAnimation();
    });
  }
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    syncAnimation();
  }).observe(host);
  motion.addEventListener('change', syncAnimation);
  syncAnimation();
}

showTrophy().catch(error => console.warn('Using the Blender render for the trophy.', error));
