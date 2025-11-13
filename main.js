import * as THREE from "https://esm.sh/three@0.160.0/es2022/three.mjs";
import { OrbitControls } from "https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://esm.sh/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js";

const ObjectLoader = THREE.ObjectLoader;
// Crear renderizador
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Crear variables globales
let scene, camera;
// Store all mixers for objects with animations
let mixers = [];
// Map object name -> AnimationMixer for easy control (e.g. pause/play specific objects)
const mixersMap = new Map();
// EffectComposer for post-processing (bloom effect)
let composer;
let bloomPass; // Store reference to bloom pass for resize updates

// Cargar la escena exportada desde Blender
const loader = new ObjectLoader();

// Fetch the JSON file
fetch("./project.json")
  .then((response) => {
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  })
  .then((data) => {
    // Parse the scene from the JSON data
    scene = loader.parse(data.scene);
    
    // Load camera if available
    if (data.camera) {
      camera = loader.parse(data.camera);
    }

    // If still no camera, search in scene or create default
    if (!camera) {
      camera = scene.getObjectByProperty("type", "PerspectiveCamera");
    }
    if (!camera) {
      camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 1000);
      scene.add(camera);
    }
    // Set default camera position and rotation
    camera.position.set(-0.023, 1.661, 3.600);
    camera.rotation.set(-0.191, -0.020, -0.004);
    
    // Fix aspect ratio if camera was loaded from JSON
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    // Luz básica por si la escena no la tiene
    if (scene.children.length === 0 || !scene.children.some(c => c.isLight)) {
      const light = new THREE.DirectionalLight(0xffffff, 1);
      light.position.set(5, 10, 7);
      scene.add(light);
    }

    // Center and scale the scene
    const boundingBox = new THREE.Box3().setFromObject(scene);
    const center = boundingBox.getCenter(new THREE.Vector3());
    const size = boundingBox.getSize(new THREE.Vector3());
    
    // Move scene center to origin
    scene.position.sub(center);
    
    // Scale scene to fit in a reasonable size
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 5 / maxDim;
    scene.scale.multiplyScalar(scale);


      // --- Parallax effect setup ---
      // Global scale to reduce overall parallax strength (smaller = less movement)
      const PARALLAX_SCALE = 0.35;
      // Store original transforms and random parallax factors
      const parallaxObjects = [];
      scene.traverse((obj) => {
        // Only affect Meshes/Groups, not Camera or Lights
        if ((obj.isMesh || obj.type === 'Group') && !obj.isLight && obj !== camera) {
          parallaxObjects.push({
            obj,
            origPos: obj.position.clone(),
            origRot: obj.rotation.clone(),
            // Each object gets a random factor for position and rotation
            // Reduced ranges so elements move less with the cursor
            posFactor: 0.01 + Math.random() * 0.04, // 0.01 - 0.05
            rotFactor: 0.01 + Math.random() * 0.05   // 0.01 - 0.06
          });
        }
      });

      // Mouse tracking
      let mouseX = 0, mouseY = 0, targetMouseX = 0, targetMouseY = 0;
      window.addEventListener('mousemove', (e) => {
        // Normalize mouse position to [-1, 1]
        targetMouseX = (e.clientX / window.innerWidth) * 2 - 1;
        targetMouseY = (e.clientY / window.innerHeight) * 2 - 1;
      });

    // Controles de cámara
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // OrbitControls deshabilitados por defecto
    controls.enabled = false;

    // Alternar controles con la tecla 'x'
    window.addEventListener('keydown', (event) => {
      if (event.key === 'x' || event.key === 'X') {
        controls.enabled = !controls.enabled;
        console.log('OrbitControls ' + (controls.enabled ? 'habilitados' : 'deshabilitados'));
      }
    });


    // --- Animations: Traverse all objects for animations ---
    function setupAnimations(root) {
      let found = false;
      root.traverse((obj) => {
        if (obj.animations && obj.animations.length > 0) {
          const mixer = new THREE.AnimationMixer(obj);
          obj.animations.forEach((clip) => {
            mixer.clipAction(clip).play();
          });
          mixers.push(mixer);
          console.log("here", obj.name, mixer)
          // store mixer by object name (fallback to uuid when name missing)
          mixersMap.set(obj.name || obj.uuid, mixer);
          found = true;
        }
      });
      return found;
    }
    const hasAnims = setupAnimations(scene);
    if (hasAnims) {
      console.log("🎬 Animaciones detectadas y reproducidas automáticamente");
    } else {
      console.log("⚠️ No se encontraron animaciones en el project.json");
    }

    // Pause the animation on the object named 'RADIO' (if it has animations)
    const RADIO_NAME = 'RADIO';
    const radioMixer = mixersMap.get(RADIO_NAME);
    if (radioMixer) {
      radioMixer.timeScale = 0; // freeze the mixer (effectively pauses animation)
      console.log(`'${RADIO_NAME}' animation pausada inicialmente`);
    } else {
      // not necessarily an error — the object may not have animations
      // console.warn(`No se encontró animación para '${RADIO_NAME}'`);
    }

    
    
    // --- Star particle system ---
    const starCount = 500;
    const starGeometry = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    const starOpacities = new Float32Array(starCount);
    
    // Create random star positions in a sphere around the scene
    for (let i = 0; i < starCount; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const radius = 20 + Math.random() * 30; // distant stars
      
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi);
      
      starOpacities[i] = Math.random() * 0.5 + 0.5; // opacity 0.5-1.0
    }
    
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    starGeometry.setAttribute('opacity', new THREE.BufferAttribute(starOpacities, 1));
    
    // Star material: white points with size
    const starMaterial = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.40,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.8
    });
    
    const stars = new THREE.Points(starGeometry, starMaterial);
    scene.add(stars);
    
    // Track star twinkling
    let starTwinkleTime = 0;
    
    // --- Bloom Effect Setup ---
    // EffectComposer manages the post-processing pipeline
    // It renders the scene through multiple passes (RenderPass -> BloomPass -> final output)
    composer = new EffectComposer(renderer);
    
    // RenderPass: Renders the scene normally to a render target
    // This is the base pass that captures the scene before any post-processing
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    
    // UnrealBloomPass: Creates the bloom/glow effect
    // Parameters: (resolution, strength, radius, threshold)
    // - resolution: Resolution of the bloom effect (lower = better performance, higher = better quality)
    // - strength: Intensity of the bloom (0.3-0.6 for subtle effect)
    // - radius: Spread of the bloom (smaller = tighter glow)
    // - threshold: Brightness threshold above which pixels will bloom (lower = more pixels bloom)
    bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight), // resolution
      0.4,  // strength: subtle intensity (0.3-0.6 range)
      0.4,  // radius: small spread for gentle glow
      0.85  // threshold: only very bright pixels bloom (higher = more selective)
    );
    composer.addPass(bloomPass);
    
    // Make target objects emissive so they contribute to the bloom effect
    // Objects need emissive materials to create the glow
    const bloomObjectNames = ['Cylinder008', 'RADIO', 'Tablet', 'Plane002'];
    scene.traverse((obj) => {
      if (obj.isMesh && bloomObjectNames.includes(obj.name)) {
        // Ensure the material has emissive properties
        if (obj.material) {
          const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
          materials.forEach((mat) => {
            if (mat) {
              // Set emissive color based on object (or use a soft white/neutral glow)
              // Using the object's base color or a subtle tint for the glow
              if (!mat.emissive) {
                mat.emissive = new THREE.Color();
              }
              // Set emissive to a soft version of the material color, or neutral white
              if (mat.color) {
                mat.emissive.copy(mat.color).multiplyScalar(0.3); // Soft glow based on base color
              } else {
                mat.emissive.setHex(0xffffff); // Neutral white glow
              }
              // Set emissive intensity for subtle bloom
              if ('emissiveIntensity' in mat) {
                mat.emissiveIntensity = 0.5; // Moderate intensity for visible but subtle glow
              }
            }
          });
        }
      }
    });
    
    // Iniciar render loop
    const clock = new THREE.Clock();
    function animate() {
      requestAnimationFrame(animate);
      const delta = clock.getDelta();
      // Update all mixers
      for (const mixer of mixers) mixer.update(delta);
      controls.update();

      // Smoothly interpolate mouse position
      mouseX += (targetMouseX - mouseX) * 0.08;
      mouseY += (targetMouseY - mouseY) * 0.08;

      // Parallax effect: update each object's position additively (do not override animation)
      for (const { obj, origPos, posFactor } of parallaxObjects) {
  // Target position offset, scaled down globally so movement is subtle
  const tx = mouseX * posFactor * PARALLAX_SCALE;
  const ty = -mouseY * posFactor * PARALLAX_SCALE;
        // Compute target offset
        const px = origPos.x + tx;
        const py = origPos.y + ty;
        // Only apply offset from original position, so animation is preserved
        obj.position.x += (px - obj.position.x) * 0.1;
        obj.position.y += (py - obj.position.y) * 0.1;
      }
      
      // Update star twinkling effect (smooth opacity variation)
      starTwinkleTime += delta * 0.5;
      const opacities = starGeometry.getAttribute('opacity').array;
      for (let i = 0; i < starCount; i++) {
        const baseOpacity = (starOpacities[i] * 0.5 + 0.5);
        opacities[i] = baseOpacity * (0.5 + 0.5 * Math.sin(starTwinkleTime * 3 + i));
      }
      starGeometry.getAttribute('opacity').needsUpdate = true;
      
      // Gently rotate the star field for a subtle cosmic feel
      stars.rotation.y += delta * 0.02;
      stars.rotation.x += delta * 0.01;
      
      // Use EffectComposer instead of direct renderer for post-processing (bloom)
      // The composer handles the RenderPass and BloomPass automatically
      if (composer) {
        composer.render();
      } else {
        // Fallback to direct render if composer isn't ready yet
        renderer.render(scene, camera);
      }
    }
    animate();

    // --- Raycasting for hover + click (Cylinder008 toggles PointLight) ---
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let isHovering = false;
    // store original material state (color, emissive, emissiveIntensity)
    const originalMaterialStates = new Map();

    function saveOriginalMaterialState(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) saveOriginalMaterialState(m);
        return;
      }
      if (!originalMaterialStates.has(mat.uuid)) {
        const state = {};
        if (mat.color) state.color = mat.color.clone();
        if (mat.emissive) state.emissive = mat.emissive.clone();
        if ('emissiveIntensity' in mat) state.emissiveIntensity = mat.emissiveIntensity;
        originalMaterialStates.set(mat.uuid, state);
      }
    }

    function applyEmissiveAura(mat, hexColor = 0xffa500, intensity = 0.35) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) applyEmissiveAura(m, hexColor, intensity);
        return;
      }
      if (mat.emissive) {
        // Create a subtle bloom by blending the glow color with original emissive
        const glowColor = new THREE.Color(hexColor);
        const originalEmissive = mat.emissive.clone();
        // Blend: 60% glow color, 40% original emissive for subtle bloom
        mat.emissive.copy(originalEmissive).lerp(glowColor, 0.6);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = intensity;
      } else if (mat.color) {
        // fallback: subtle tint to base color for bloom effect
        const glowColor = new THREE.Color(hexColor);
        const originalColor = mat.color.clone();
        mat.color.copy(originalColor).lerp(glowColor, 0.15); // Very subtle color blend
      }
    }

    function restoreOriginalMaterials() {
      scene.traverse((obj) => {
        if (obj.isMesh) {
          const m = obj.material;
          if (Array.isArray(m)) {
            for (const sub of m) {
              const s = originalMaterialStates.get(sub.uuid);
              if (s) {
                if (s.color && sub.color) sub.color.copy(s.color);
                if (s.emissive && sub.emissive) sub.emissive.copy(s.emissive);
                if ('emissiveIntensity' in s && 'emissiveIntensity' in sub) sub.emissiveIntensity = s.emissiveIntensity;
              }
            }
          } else if (m) {
            const s = originalMaterialStates.get(m.uuid);
            if (s) {
              if (s.color && m.color) m.color.copy(s.color);
              if (s.emissive && m.emissive) m.emissive.copy(s.emissive);
              if ('emissiveIntensity' in s && 'emissiveIntensity' in m) m.emissiveIntensity = s.emissiveIntensity;
            }
          }
        }
      });
      originalMaterialStates.clear();
    }

    const targetName = 'Cylinder008';
    const lightName = 'PointLight';
    const targetObject = scene.getObjectByName(targetName);
    const pointLight = scene.getObjectByName(lightName);
    if (!targetObject) console.warn(`No se encontró el objeto con nombre '${targetName}'`);
    if (!pointLight) console.warn(`No se encontró la luz con nombre '${lightName}'`);

    // --- RADIO hover + click setup ---
    const radioName = RADIO_NAME; // 'RADIO'
    const radioObject = scene.getObjectByName(radioName);
    if (!radioObject) console.warn(`No se encontró el objeto con nombre '${radioName}'`);
    // separate material state map for RADIO to avoid clobbering Cylinder008's states
    const radioMaterialStates = new Map();
    let isHoveringRadio = false;

    // --- Android Expanded - 1 hover + click setup ---
    const androidName = 'Tablet';
    const androidObject = scene.getObjectByName(androidName);
    if (!androidObject) console.warn(`No se encontró el objeto con nombre '${androidName}'`);
    const androidMaterialStates = new Map();
    let isHoveringAndroid = false;

    // --- Plane.002 hover + click setup ---
    const planeName = 'Plane002';
    const planeObject = scene.getObjectByName(planeName);
    if (!planeObject) console.warn(`No se encontró el objeto con nombre '${planeName}'`);
    const planeMaterialStates = new Map();
    let isHoveringPlane = false;

    // Save original material state for RADIO (color/emissive/intensity)
    function saveRadioMaterialState(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) saveRadioMaterialState(m);
        return;
      }
      if (!radioMaterialStates.has(mat.uuid)) {
        const state = {};
        if (mat.color) state.color = mat.color.clone();
        if (mat.emissive) state.emissive = mat.emissive.clone();
        if ('emissiveIntensity' in mat) state.emissiveIntensity = mat.emissiveIntensity;
        radioMaterialStates.set(mat.uuid, state);
      }
    }

    // Apply a soft red emissive halo to RADIO (bloom effect)
    function applyRadioHalo(mat, hexColor = 0xff4444, intensity = 0.35) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) applyRadioHalo(m, hexColor, intensity);
        return;
      }
      if (mat.emissive) {
        // Create a subtle bloom by blending the glow color with original emissive
        const glowColor = new THREE.Color(hexColor);
        const originalEmissive = mat.emissive.clone();
        // Blend: 60% glow color, 40% original emissive for subtle bloom
        mat.emissive.copy(originalEmissive).lerp(glowColor, 0.6);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = intensity;
      } else if (mat.color) {
        // fallback: subtle tint to base color for bloom effect
        const glowColor = new THREE.Color(hexColor);
        const originalColor = mat.color.clone();
        mat.color.copy(originalColor).lerp(glowColor, 0.15); // Very subtle color blend
      }
    }

    // Restore RADIO materials from saved state
    function restoreRadioMaterials() {
      scene.traverse((obj) => {
        if (obj.isMesh) {
          const m = obj.material;
          if (Array.isArray(m)) {
            for (const sub of m) {
              const s = radioMaterialStates.get(sub.uuid);
              if (s) {
                if (s.color && sub.color) sub.color.copy(s.color);
                if (s.emissive && sub.emissive) sub.emissive.copy(s.emissive);
                if ('emissiveIntensity' in s && 'emissiveIntensity' in sub) sub.emissiveIntensity = s.emissiveIntensity;
              }
            }
          } else if (m) {
            const s = radioMaterialStates.get(m.uuid);
            if (s) {
              if (s.color && m.color) m.color.copy(s.color);
              if (s.emissive && m.emissive) m.emissive.copy(s.emissive);
              if ('emissiveIntensity' in s && 'emissiveIntensity' in m) m.emissiveIntensity = s.emissiveIntensity;
            }
          }
        }
      });
      radioMaterialStates.clear();
    }

    // Save original material state for Android Expanded - 1
    function saveAndroidMaterialState(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) saveAndroidMaterialState(m);
        return;
      }
      if (!androidMaterialStates.has(mat.uuid)) {
        const state = {};
        if (mat.color) state.color = mat.color.clone();
        if (mat.emissive) state.emissive = mat.emissive.clone();
        if ('emissiveIntensity' in mat) state.emissiveIntensity = mat.emissiveIntensity;
        androidMaterialStates.set(mat.uuid, state);
      }
    }

    // Apply green glow aura to Android Expanded - 1 (bloom effect)
    function applyAndroidGlow(mat, hexColor = 0x90EE90, intensity = 0.35) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) applyAndroidGlow(m, hexColor, intensity);
        return;
      }
      if (mat.emissive) {
        // Create a subtle bloom by blending the glow color with original emissive
        const glowColor = new THREE.Color(hexColor);
        const originalEmissive = mat.emissive.clone();
        // Blend: 60% glow color, 40% original emissive for subtle bloom
        mat.emissive.copy(originalEmissive).lerp(glowColor, 0.6);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = intensity;
      } else if (mat.color) {
        // fallback: subtle tint to base color for bloom effect
        const glowColor = new THREE.Color(hexColor);
        const originalColor = mat.color.clone();
        mat.color.copy(originalColor).lerp(glowColor, 0.15); // Very subtle color blend
      }
    }

    // Restore Android Expanded - 1 materials from saved state
    function restoreAndroidMaterials() {
      scene.traverse((obj) => {
        if (obj.isMesh) {
          const m = obj.material;
          if (Array.isArray(m)) {
            for (const sub of m) {
              const s = androidMaterialStates.get(sub.uuid);
              if (s) {
                if (s.color && sub.color) sub.color.copy(s.color);
                if (s.emissive && sub.emissive) sub.emissive.copy(s.emissive);
                if ('emissiveIntensity' in s && 'emissiveIntensity' in sub) sub.emissiveIntensity = s.emissiveIntensity;
              }
            }
          } else if (m) {
            const s = androidMaterialStates.get(m.uuid);
            if (s) {
              if (s.color && m.color) m.color.copy(s.color);
              if (s.emissive && m.emissive) m.emissive.copy(s.emissive);
              if ('emissiveIntensity' in s && 'emissiveIntensity' in m) m.emissiveIntensity = s.emissiveIntensity;
            }
          }
        }
      });
      androidMaterialStates.clear();
    }

    // Save original material state for Plane.002
    function savePlaneMaterialState(mat) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) savePlaneMaterialState(m);
        return;
      }
      if (!planeMaterialStates.has(mat.uuid)) {
        const state = {};
        if (mat.color) state.color = mat.color.clone();
        if (mat.emissive) state.emissive = mat.emissive.clone();
        if ('emissiveIntensity' in mat) state.emissiveIntensity = mat.emissiveIntensity;
        planeMaterialStates.set(mat.uuid, state);
      }
    }

    // Apply light blue glow aura to Plane.002 (bloom effect)
    function applyPlaneGlow(mat, hexColor = 0x87ceeb, intensity = 0.35) {
      if (!mat) return;
      if (Array.isArray(mat)) {
        for (const m of mat) applyPlaneGlow(m, hexColor, intensity);
        return;
      }
      if (mat.emissive) {
        // Create a subtle bloom by blending the glow color with original emissive
        const glowColor = new THREE.Color(hexColor);
        const originalEmissive = mat.emissive.clone();
        // Blend: 60% glow color, 40% original emissive for subtle bloom
        mat.emissive.copy(originalEmissive).lerp(glowColor, 0.6);
        if ('emissiveIntensity' in mat) mat.emissiveIntensity = intensity;
      } else if (mat.color) {
        // fallback: subtle tint to base color for bloom effect
        const glowColor = new THREE.Color(hexColor);
        const originalColor = mat.color.clone();
        mat.color.copy(originalColor).lerp(glowColor, 0.15); // Very subtle color blend
      }
    }

    // Restore Plane.002 materials from saved state
    function restorePlaneMaterials() {
      scene.traverse((obj) => {
        if (obj.isMesh) {
          const m = obj.material;
          if (Array.isArray(m)) {
            for (const sub of m) {
              const s = planeMaterialStates.get(sub.uuid);
              if (s) {
                if (s.color && sub.color) sub.color.copy(s.color);
                if (s.emissive && sub.emissive) sub.emissive.copy(s.emissive);
                if ('emissiveIntensity' in s && 'emissiveIntensity' in sub) sub.emissiveIntensity = s.emissiveIntensity;
              }
            }
          } else if (m) {
            const s = planeMaterialStates.get(m.uuid);
            if (s) {
              if (s.color && m.color) m.color.copy(s.color);
              if (s.emissive && m.emissive) m.emissive.copy(s.emissive);
              if ('emissiveIntensity' in s && 'emissiveIntensity' in m) m.emissiveIntensity = s.emissiveIntensity;
            }
          }
        }
      });
      planeMaterialStates.clear();
    }

    function getPointerFromEvent(event) {
      const rect = renderer.domElement.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
        y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
      };
    }

    function onPointerMove(event) {
      // require scene & camera, but handle objects independently if they exist
      if (!camera || !scene) return;
      const p = getPointerFromEvent(event);
      pointer.x = p.x;
      pointer.y = p.y;
      raycaster.setFromCamera(pointer, camera);
      
      let isHoveringClickable = false;
      
      // Cylinder008 hover handling (orange aura)
      if (targetObject) {
        const intersects = raycaster.intersectObject(targetObject, true);
        if (intersects.length > 0) {
          isHoveringClickable = true;
          if (!isHovering) {
            targetObject.traverse((obj) => {
              if (obj.isMesh && obj.name !== 'Cylinder' && obj.name !== 'Torus') {
                saveOriginalMaterialState(obj.material);
                applyEmissiveAura(obj.material, 0xffa500);
              }
            });
            isHovering = true;
          }
        } else {
          if (isHovering) {
            restoreOriginalMaterials();
            isHovering = false;
          }
        }
      }

      // RADIO hover handling (soft red halo)
      if (radioObject) {
        const rInter = raycaster.intersectObject(radioObject, true);
        if (rInter.length > 0) {
          isHoveringClickable = true;
          if (!isHoveringRadio) {
            radioObject.traverse((obj) => {
              if (obj.isMesh && obj.name !== 'Cylinder' && obj.name !== 'Torus') {
                saveRadioMaterialState(obj.material);
                applyRadioHalo(obj.material, 0xff4444);
              }
            });
            isHoveringRadio = true;
          }
        } else {
          if (isHoveringRadio) {
            restoreRadioMaterials();
            isHoveringRadio = false;
          }
        }
      }

      // Android Expanded - 1 hover handling (green glow)
      if (androidObject) {
        const aInter = raycaster.intersectObject(androidObject, true);
        if (aInter.length > 0) {
          isHoveringClickable = true;
          if (!isHoveringAndroid) {
            androidObject.traverse((obj) => {
              if (obj.isMesh && obj.name !== 'Cylinder' && obj.name !== 'Torus') {
                saveAndroidMaterialState(obj.material);
                applyAndroidGlow(obj.material, 0x90EE90);
              }
            });
            isHoveringAndroid = true;
          }
        } else {
          if (isHoveringAndroid) {
            restoreAndroidMaterials();
            isHoveringAndroid = false;
          }
        }
      }

      // Plane.002 hover handling (light blue glow)
      if (planeObject) {
        const pInter = raycaster.intersectObject(planeObject, true);
        if (pInter.length > 0) {
          isHoveringClickable = true;
          if (!isHoveringPlane) {
            planeObject.traverse((obj) => {
              if (obj.isMesh && obj.name !== 'Cylinder' && obj.name !== 'Torus') {
                savePlaneMaterialState(obj.material);
                applyPlaneGlow(obj.material, 0x87ceeb, 1.5);
              }
            });
            isHoveringPlane = true;
          }
        } else {
          if (isHoveringPlane) {
            restorePlaneMaterials();
            isHoveringPlane = false;
          }
        }
      }

      // Update cursor style based on hover state
      if (renderer && renderer.domElement) {
        renderer.domElement.style.cursor = isHoveringClickable ? 'pointer' : 'default';
      }
    }

    function onPointerDown(event) {
      if (!camera || !scene) return;
      const p = getPointerFromEvent(event);
      pointer.x = p.x;
      pointer.y = p.y;
      raycaster.setFromCamera(pointer, camera);

      // Cylinder008 click: toggle PointLight
      if (targetObject) {
        const intersects = raycaster.intersectObject(targetObject, true);
        if (intersects.length > 0) {
          if (pointLight) {
            pointLight.visible = !pointLight.visible;
            console.log(`${lightName} ahora ${pointLight.visible ? 'encendida' : 'apagada'}`);
          }
          // don't return; allow radio click handling to run too if overlapping
        }
      }

      // RADIO click: toggle its animation (play/pause by switching timeScale)
      if (radioObject) {
        const rInter = raycaster.intersectObject(radioObject, true);
        if (rInter.length > 0) {
          const mixer = mixersMap.get(radioName);
          if (mixer) {
            mixer.timeScale = mixer.timeScale === 0 ? 1 : 0;
            console.log(`'${radioName}' animation ${mixer.timeScale === 0 ? 'pausada' : 'reproduciendo'}`);
          } else {
            console.warn(`No hay AnimationMixer registrado para '${radioName}'`);
          }
          // --- Also toggle the HTML audio player when the RADIO is clicked ---
          try {
            if (typeof audioEl !== 'undefined' && audioEl) {
              if (audioEl.paused) {
                // User gesture allows playback
                showPlayer();
                const p = audioEl.play();
                if (p && typeof p.then === 'function') p.catch((err) => console.warn('Playback prevented:', err));
              } else {
                audioEl.pause();
                hidePlayer();
              }
              // Update play button icon if function exists
              if (typeof updatePlayButton === 'function') {
                updatePlayButton();
              } else if (playBtn) {
                // Fallback: update directly if function not yet defined
                playBtn.textContent = audioEl.paused ? '▶' : '⏸';
              }
            }
          } catch (err) {
            console.error('Error toggling audio:', err);
          }
        }
      }

      // Android Expanded - 1 click: show image overlay
      if (androidObject) {
        const aInter = raycaster.intersectObject(androidObject, true);
        if (aInter.length > 0) {
          const overlayEl = typeof document !== 'undefined' ? document.getElementById('image-overlay') : null;
          const overlayImg = typeof document !== 'undefined' ? document.getElementById('overlay-image') : null;
          if (overlayEl && overlayImg) {
            overlayImg.src = './darte-luz.gif';
            overlayImg.alt = 'Darteluz';
            overlayEl.classList.add('visible');
            overlayEl.setAttribute('aria-hidden', 'false');
          }
        }
      }

      // Plane.002 click: show image overlay
      if (planeObject) {
        const pInter = raycaster.intersectObject(planeObject, true);
        if (pInter.length > 0) {
          const overlayEl = typeof document !== 'undefined' ? document.getElementById('image-overlay') : null;
          const overlayImg = typeof document !== 'undefined' ? document.getElementById('overlay-image') : null;
          if (overlayEl && overlayImg) {
            overlayImg.src = './uma.jpg';
            overlayImg.alt = 'Uma';
            overlayEl.classList.add('visible');
            overlayEl.setAttribute('aria-hidden', 'false');
          }
        }
      }
    }

    // --- Music player DOM integration ---
    // Query the HTML elements we added in index.html.
    const audioEl = typeof document !== 'undefined' ? document.getElementById('audio') : null;
    const playerEl = typeof document !== 'undefined' ? document.getElementById('music-player') : null;
    const playBtn = typeof document !== 'undefined' ? document.getElementById('player-play') : null;
    const prevBtn = typeof document !== 'undefined' ? document.getElementById('player-prev') : null;
    const nextBtn = typeof document !== 'undefined' ? document.getElementById('player-next') : null;
    const repeatBtn = typeof document !== 'undefined' ? document.getElementById('player-repeat') : null;
    const progressEl = typeof document !== 'undefined' ? document.getElementById('player-progress') : null;
    const SEEK_INTERVAL = 10; // seconds to seek when using prev/next controls

    // Repeat mode: 'none', 'all', 'one'
    let repeatMode = 'none';

    // Safe-guards if DOM not available
    function showPlayer() {
      if (!playerEl) return;
      playerEl.classList.add('visible');
      playerEl.setAttribute('aria-hidden', 'false');
    }
    function hidePlayer() {
      if (!playerEl) return;
      playerEl.classList.remove('visible');
      playerEl.setAttribute('aria-hidden', 'true');
    }

    // Update play button icon according to audio state
    function updatePlayButton() {
      if (!playBtn || !audioEl) return;
      playBtn.textContent = audioEl.paused ? '▶' : '⏸';
    }

    function seekAudio(offsetSeconds) {
      if (!audioEl) return;
      const wasPaused = audioEl.paused;
      const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : null;
      let targetTime = audioEl.currentTime + offsetSeconds;
      if (duration !== null) {
        const maxTime = duration > 0.01 ? duration - 0.01 : duration;
        targetTime = Math.min(maxTime, targetTime);
      }
      audioEl.currentTime = Math.max(0, targetTime);
      if (!wasPaused) {
        audioEl.play().catch((err) => console.warn('play prevented', err));
      }
      showPlayer();
    }

    // Update repeat button state
    function updateRepeatButton() {
      if (!repeatBtn) return;
      // Remove all repeat classes
      repeatBtn.classList.remove('repeat-none', 'repeat-all', 'repeat-one');
      // Add current mode class
      repeatBtn.classList.add(`repeat-${repeatMode}`);
      // Update title
      const titles = {
        'none': 'Repeat: Off',
        'all': 'Repeat: All',
        'one': 'Repeat: One'
      };
      repeatBtn.title = titles[repeatMode];
    }

    // Cycle through repeat modes
    function cycleRepeatMode() {
      if (repeatMode === 'none') {
        repeatMode = 'all';
      } else if (repeatMode === 'all') {
        repeatMode = 'one';
      } else {
        repeatMode = 'none';
      }
      updateRepeatButton();
    }

    // Initialize repeat button
    if (repeatBtn) {
      updateRepeatButton();
      repeatBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cycleRepeatMode();
      });
    }

    // Wire play button to control audio (keeps player visible when used)
    if (playBtn && audioEl) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (audioEl.paused) {
          audioEl.play().catch((err) => console.warn('play prevented', err));
          showPlayer();
        } else {
          audioEl.pause();
        }
        updatePlayButton();
      });
    }

    // Previous button (seek backward)
    if (prevBtn && audioEl) {
      prevBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        seekAudio(-SEEK_INTERVAL);
      });
    }

    // Next button (seek forward)
    if (nextBtn && audioEl) {
      nextBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        seekAudio(SEEK_INTERVAL);
      });
    }

    // Update progress bar as audio plays
    if (audioEl && progressEl) {
      audioEl.addEventListener('timeupdate', () => {
        if (!audioEl.duration || isNaN(audioEl.duration)) return;
        const pct = (audioEl.currentTime / audioEl.duration) * 100;
        progressEl.value = pct;
      });
      // Seek when user interacts with the range input
      progressEl.addEventListener('input', (e) => {
        if (!audioEl.duration || isNaN(audioEl.duration)) return;
        const value = Number(progressEl.value);
        audioEl.currentTime = (value / 100) * audioEl.duration;
      });
      // Keep play button icon in sync
      audioEl.addEventListener('play', updatePlayButton);
      audioEl.addEventListener('pause', updatePlayButton);
      audioEl.addEventListener('ended', () => {
        updatePlayButton();
        // Handle repeat modes
        if (repeatMode === 'one') {
          // Repeat current track
          audioEl.currentTime = 0;
          audioEl.play().catch((err) => console.warn('play prevented', err));
        } else if (repeatMode === 'all') {
          // Repeat all (for now, just restart current track)
          // Can be extended for playlists
          audioEl.currentTime = 0;
          audioEl.play().catch((err) => console.warn('play prevented', err));
        } else {
          // No repeat - hide player
          hidePlayer();
        }
      });
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);

    // --- Image overlay close button handler ---
    const closeOverlayBtn = typeof document !== 'undefined' ? document.getElementById('close-overlay') : null;
    const overlayEl = typeof document !== 'undefined' ? document.getElementById('image-overlay') : null;
    if (closeOverlayBtn && overlayEl) {
      closeOverlayBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        overlayEl.classList.remove('visible');
        overlayEl.setAttribute('aria-hidden', 'true');
      });
      // Also close when clicking on the overlay background (but not on the image)
      overlayEl.addEventListener('click', (e) => {
        if (e.target === overlayEl) {
          overlayEl.classList.remove('visible');
          overlayEl.setAttribute('aria-hidden', 'true');
        }
      });
    }
  })
  .catch((error) => {
    console.error("❌ Error loading project.json:", error);
  });

// Ajustar al tamaño de la ventana
window.addEventListener("resize", () => {
  if (!camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Update EffectComposer size when window resizes
  // This ensures the bloom effect renders at the correct resolution
  // The composer automatically updates all passes (RenderPass and BloomPass)
  if (composer) {
    composer.setSize(window.innerWidth, window.innerHeight);
  }
});