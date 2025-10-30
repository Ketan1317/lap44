import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const F1RacingGame: React.FC = () => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(async () => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 50, 200);

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 100, 50);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 500;
    dirLight.shadow.camera.left = -100;
    dirLight.shadow.camera.right = 100;
    dirLight.shadow.camera.top = 100;
    dirLight.shadow.camera.bottom = -100;
    scene.add(dirLight);

    // Game state
    const carState = {
      position: new THREE.Vector3(0, 0, 0),
      velocity: new THREE.Vector3(0, 0, 0),
      rotation: 0,
      speed: 0,
      maxSpeed: 1.2,
      acceleration: 0.03,
      deceleration: 0.02,
      turnSpeed: 0.03,
      friction: 0.98
    };

    const keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      ArrowUp: false,
      ArrowLeft: false,
      ArrowDown: false,
      ArrowRight: false
    };

    // Input handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key in keys) {
        keys[e.key as keyof typeof keys] = true;
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key in keys) {
        keys[e.key as keyof typeof keys] = false;
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Model references
    let carModel: THREE.Group | null = null;
    let trackModel: THREE.Group | null = null;
    const trackBoundingBoxes: THREE.Box3[] = [];
    const boundaryBoxes: THREE.Box3[] = [];

    // Import GLTFLoader
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');

    // Load models
    const loadModels = async () => {
      try {
        const loader = new GLTFLoader();
        
        let modelsLoaded = 0;

        // Load car model
        loader.loadAsync('/models/car.glb')
          .then((gltf) => {
            carModel = gltf.scene;
            carModel.scale.set(1.3, 1.3, 1.3);
            carModel.position.set(0, 0.2, 0);
            
            carModel.traverse((child) => {
              if ((child as THREE.Mesh).isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }
            });

            scene.add(carModel);
            modelsLoaded++;
            if (modelsLoaded === 2) setLoading(false);
          })
          .catch((error) => {
            console.error('Error loading car model:', error);
            setError('Failed to load car model. Please ensure car.glb exists in /public/models/');
          });

        // Load track model
        loader.loadAsync('/models/track.glb')
          .then((gltf) => {
            trackModel = gltf.scene;
            if (trackModel) {
              trackModel.scale.set(1, 1, 1);
              trackModel.position.set(0, 0, 0);
              
              trackModel.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                  child.receiveShadow = true;
                  child.castShadow = true;

                  // Create bounding boxes for collision detection
                  const bbox = new THREE.Box3().setFromObject(child);
                  const size = new THREE.Vector3();
                  bbox.getSize(size);

                  // Check if this is a barrier/obstacle
                  if (child.name.toLowerCase().includes('tree') ||
                      child.name.toLowerCase().includes('barrier') ||
                      child.name.toLowerCase().includes('wall') ||
                      child.name.toLowerCase().includes('obstacle')) {
                    boundaryBoxes.push(bbox);
                  }
                }
              });

              // Create track boundary
              const trackBBox = new THREE.Box3().setFromObject(trackModel);
              trackBoundingBoxes.push(trackBBox);

              scene.add(trackModel);
              modelsLoaded++;
              if (modelsLoaded === 2) setLoading(false);
            }
          })
          .catch((error) => {
            console.error('Error loading track model:', error);
            setError('Failed to load track model. Please ensure track.glb exists in /public/models/');
          });
      } catch (err) {
        console.error('Error loading GLTF loader:', err);
        setError('Failed to initialize 3D model loader');
      }
    };

    loadModels();

    // Camera offset for third-person view
    const cameraOffset = new THREE.Vector3(0, 5, -10);
    const cameraLookOffset = new THREE.Vector3(0, 1, 5);

    // Collision detection
    const checkCollision = (newPos: THREE.Vector3): boolean => {
      const carBBox = new THREE.Box3(
        new THREE.Vector3(newPos.x - 0.5, newPos.y - 0.2, newPos.z - 0.5),
        new THREE.Vector3(newPos.x + 0.5, newPos.y + 0.5, newPos.z + 0.5)
      );

      // Check collision with obstacles
      for (const bbox of boundaryBoxes) {
        if (carBBox.intersectsBox(bbox)) {
          return true;
        }
      }

      return false;
    };

    // Animation loop
    const clock = new THREE.Clock();
    
    const animate = () => {
      requestAnimationFrame(animate);
      clock.getDelta(); // Update the clock

      if (carModel) {
        // Handle input
        const forward = keys.w || keys.ArrowUp;
        const backward = keys.s || keys.ArrowDown;
        const left = keys.a || keys.ArrowLeft;
        const right = keys.d || keys.ArrowRight;

        // Acceleration and braking
        if (forward) {
          carState.speed = Math.min(carState.speed + carState.acceleration, carState.maxSpeed);
        } else if (backward) {
          carState.speed = Math.max(carState.speed - carState.acceleration, -carState.maxSpeed * 0.5);
        } else {
          // Natural deceleration
          if (Math.abs(carState.speed) > 0.001) {
            carState.speed *= carState.friction;
          } else {
            carState.speed = 0;
          }
        }

        // Turning (only when moving)
        if (Math.abs(carState.speed) > 0.01) {
          if (left) {
            carState.rotation += carState.turnSpeed * Math.abs(carState.speed) / carState.maxSpeed;
          }
          if (right) {
            carState.rotation -= carState.turnSpeed * Math.abs(carState.speed) / carState.maxSpeed;
          }
        }

        // Calculate new position
        const moveDirection = new THREE.Vector3(
          Math.sin(carState.rotation) * carState.speed,
          0,
          Math.cos(carState.rotation) * carState.speed
        );

        const newPosition = carState.position.clone().add(moveDirection);

        // Check collision before moving
        if (!checkCollision(newPosition)) {
          carState.position.copy(newPosition);
        } else {
          // Stop the car on collision
          carState.speed *= 0.5;
        }

        // Update car model
        carModel.position.copy(carState.position);
        carModel.position.y = 0.2;
        carModel.rotation.y = carState.rotation;

        // Update camera (smooth third-person follow)
        const idealOffset = cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), carState.rotation);
        const idealPosition = carState.position.clone().add(idealOffset);
        
        camera.position.lerp(idealPosition, 0.1);

        const idealLookAt = carState.position.clone().add(
          cameraLookOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), carState.rotation)
        );
        
        const currentLookAt = new THREE.Vector3();
        camera.getWorldDirection(currentLookAt);
        currentLookAt.multiplyScalar(10).add(camera.position);
        currentLookAt.lerp(idealLookAt, 0.1);
        
        camera.lookAt(currentLookAt);
      }

      renderer.render(scene, camera);
    };

    animate();

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // Store ref to the mount element
    const currentMount = mountRef.current;

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      if (currentMount) {
        currentMount.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
      
      {loading && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '30px 50px',
          borderRadius: '10px',
          fontSize: '24px',
          fontFamily: 'Arial, sans-serif'
        }}>
          Loading F1 Racing Game...
        </div>
      )}

      {error && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(200, 0, 0, 0.9)',
          color: 'white',
          padding: '30px 50px',
          borderRadius: '10px',
          fontSize: '18px',
          fontFamily: 'Arial, sans-serif',
          maxWidth: '600px',
          textAlign: 'center'
        }}>
          {error}
        </div>
      )}

      <div style={{
        position: 'absolute',
        top: '20px',
        left: '20px',
        background: 'rgba(0, 0, 0, 0.7)',
        color: 'white',
        padding: '15px 20px',
        borderRadius: '8px',
        fontFamily: 'Arial, sans-serif',
        fontSize: '14px'
      }}>
        <div style={{ marginBottom: '10px', fontSize: '18px', fontWeight: 'bold' }}>Controls</div>
        <div>W / ↑ - Accelerate</div>
        <div>S / ↓ - Brake / Reverse</div>
        <div>A / ← - Turn Left</div>
        <div>D / → - Turn Right</div>
      </div>
    </div>
  );
};

export default F1RacingGame;