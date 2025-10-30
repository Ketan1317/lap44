import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three-stdlib';

const Scene = ({ carGltf, trackGltf, keysRef }: { carGltf: any; trackGltf: any; keysRef: React.MutableRefObject<any> }) => {
  const carRef = useRef<THREE.Group>(null);
  const trackRef = useRef<THREE.Group>(null);
  const boundaryBoxesRef = useRef<THREE.Box3[]>([]);
  const trackBoundariesRef = useRef({
    minX: -50,
    maxX: 50,
    minZ: -50,
    maxZ: 50,
  });
  const carStateRef = useRef({
    position: new THREE.Vector3(0, 0.2, 20),
    velocity: new THREE.Vector3(0, 0, 0),
    rotation: 0,
    speed: 0,
    maxSpeed: 2.0,
    acceleration: 0.05,
    deceleration: 0.04,
    brakingForce: 0.08,
    turnSpeed: 0.04,
    friction: 0.97,
    driftFactor: 0.92,
    grip: 0.95,
    lateralVelocity: 0,
    isDrifting: false,
    mass: 1.0,
    drag: 0.002,
  });
  const cameraOffsetRef = useRef(new THREE.Vector3(0, 5, -10));
  const cameraLookOffsetRef = useRef(new THREE.Vector3(0, 1, 5));
  const { scene, camera } = useThree();
  const computedRef = useRef(false);

  useEffect(() => {
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, 50, 200);
    camera.position.set(0, 5, 30);
  }, [scene, camera]);

  useEffect(() => {
    if (carRef.current) {
      carRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }
  }, [carGltf]);

  useEffect(() => {
    if (trackRef.current) {
      trackRef.current.updateMatrixWorld(true);
      boundaryBoxesRef.current = []; // Clear existing boxes
      trackRef.current.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          child.receiveShadow = true;
          child.castShadow = true;
          const bbox = new THREE.Box3().setFromObject(child);
          const nameLower = child.name.toLowerCase();
          // Expanded condition to include track elements like walls, curbs, etc., excluding road/ground surfaces
          if (
            !nameLower.includes('road') &&
            !nameLower.includes('ground') &&
            !nameLower.includes('floor') &&
            !nameLower.includes('terrain') &&
            !nameLower.includes('asphalt') &&
            !nameLower.includes('surface') &&
            (nameLower.includes('tree') ||
             nameLower.includes('barrier') ||
             nameLower.includes('wall') ||
             nameLower.includes('obstacle') ||
             nameLower.includes('curb') ||
             nameLower.includes('guardrail') ||
             nameLower.includes('fence') ||
             nameLower.includes('building') ||
             nameLower.includes('pole') ||
             nameLower.includes('sign') ||
             bbox.min.y > 0.1) // Include any mesh above ground level
          ) {
            boundaryBoxesRef.current.push(bbox.clone());
          }
        }
      });
      console.log(`Found ${boundaryBoxesRef.current.length} collision boxes`);
      const trackBBox = new THREE.Box3().setFromObject(trackRef.current);
      const padding = 5;
      trackBoundariesRef.current = {
        minX: trackBBox.min.x - padding,
        maxX: trackBBox.max.x + padding,
        minZ: trackBBox.min.z - padding,
        maxZ: trackBBox.max.z + padding,
      };
      console.log('Track boundaries:', trackBoundariesRef.current);
      computedRef.current = true;
    }
  }, [trackGltf]);

  const checkCollision = (newPos: THREE.Vector3): { collided: boolean; normal?: THREE.Vector3 } => {
    // Larger car bounding box for better collision detection
    const carBBox = new THREE.Box3(
      new THREE.Vector3(newPos.x - 0.8, newPos.y - 0.2, newPos.z - 1.2),
      new THREE.Vector3(newPos.x + 0.8, newPos.y + 1.0, newPos.z + 1.2)
    );
    
    for (const bbox of boundaryBoxesRef.current) {
      if (carBBox.intersectsBox(bbox)) {
        // Calculate collision normal for better response
        const bboxCenter = new THREE.Vector3();
        bbox.getCenter(bboxCenter);
        const collisionNormal = new THREE.Vector3()
          .subVectors(newPos, bboxCenter)
          .normalize();
        collisionNormal.y = 0; // Keep it horizontal
        
        return { collided: true, normal: collisionNormal };
      }
    }
    return { collided: false };
  };

  const isWithinBoundaries = (pos: THREE.Vector3): boolean => {
    const boundaries = trackBoundariesRef.current;
    return (
      pos.x >= boundaries.minX &&
      pos.x <= boundaries.maxX &&
      pos.z >= boundaries.minZ &&
      pos.z <= boundaries.maxZ
    );
  };

  const clampToBoundaries = (pos: THREE.Vector3): THREE.Vector3 => {
    const boundaries = trackBoundariesRef.current;
    const clampedPos = pos.clone();
    clampedPos.x = Math.max(boundaries.minX, Math.min(boundaries.maxX, pos.x));
    clampedPos.z = Math.max(boundaries.minZ, Math.min(boundaries.maxZ, pos.z));
    return clampedPos;
  };

  useFrame((state, delta) => {
    if (!carRef.current) return;

    if (!computedRef.current && trackRef.current) {
      // Fallback computation if useEffect missed
      trackRef.current.updateMatrixWorld(true);
      computedRef.current = true;
    }

    const carState = carStateRef.current;
    const keys = keysRef.current;

    const forward = keys.w || keys.ArrowUp;
    const backward = keys.s || keys.ArrowDown;
    const left = keys.a || keys.ArrowLeft;
    const right = keys.d || keys.ArrowRight;

    if (forward) {
      const speedRatio = Math.abs(carState.speed) / carState.maxSpeed;
      const accelMultiplier = 1.0 - speedRatio * 0.6;
      carState.speed = Math.min(carState.speed + carState.acceleration * accelMultiplier, carState.maxSpeed);
    } else if (backward) {
      if (carState.speed > 0.1) {
        carState.speed = Math.max(carState.speed - carState.brakingForce, 0);
      } else {
        carState.speed = Math.max(carState.speed - carState.acceleration * 0.6, -carState.maxSpeed * 0.4);
      }
    } else {
      if (Math.abs(carState.speed) > 0.001) {
        const dragForce = carState.drag * carState.speed * Math.abs(carState.speed);
        carState.speed *= carState.friction;
        carState.speed -= dragForce;
        if (Math.abs(carState.speed) < 0.001) {
          carState.speed = 0;
        }
      } else {
        carState.speed = 0;
      }
    }

    let turnAmount = 0;
    if (Math.abs(carState.speed) > 0.01) {
      const speedFactor = Math.abs(carState.speed) / carState.maxSpeed;
      const turnMultiplier = 1.0 + speedFactor * 0.5;
      if (left) {
        turnAmount = carState.turnSpeed * turnMultiplier;
        carState.rotation += turnAmount;
      }
      if (right) {
        turnAmount = -carState.turnSpeed * turnMultiplier;
        carState.rotation += turnAmount;
      }
      if (Math.abs(turnAmount) > 0 && Math.abs(carState.speed) > carState.maxSpeed * 0.5) {
        carState.isDrifting = true;
        carState.lateralVelocity += turnAmount * carState.speed * 0.3;
        carState.lateralVelocity *= carState.driftFactor;
      } else {
        carState.isDrifting = false;
        carState.lateralVelocity *= carState.grip;
      }
    } else {
      carState.lateralVelocity *= 0.9;
    }

    const forwardDir = new THREE.Vector3(Math.sin(carState.rotation), 0, Math.cos(carState.rotation));
    const lateralDir = new THREE.Vector3(Math.cos(carState.rotation), 0, -Math.sin(carState.rotation));
    const moveDirection = forwardDir.multiplyScalar(carState.speed).add(lateralDir.multiplyScalar(carState.lateralVelocity));
    const newPosition = carState.position.clone().add(moveDirection);

    // Check boundary collision first
    if (!isWithinBoundaries(newPosition)) {
      const clampedPosition = clampToBoundaries(newPosition);
      carState.position.copy(clampedPosition);
      carState.speed *= 0.2;
      carState.lateralVelocity *= 0.2;
    } else {
      // Check object collision
      const collision = checkCollision(newPosition);
      
      if (!collision.collided) {
        // No collision, move freely
        carState.position.copy(newPosition);
      } else {
        // Collision detected - realistic response
        const normal = collision.normal!;
        
        // Reflect velocity along collision normal
        const velocityVec = new THREE.Vector3(
          moveDirection.x,
          0,
          moveDirection.z
        );
        const dotProduct = velocityVec.dot(normal);
        const reflection = velocityVec.sub(normal.multiplyScalar(2 * dotProduct));
        
        // Apply bounce with energy loss
        carState.speed *= -0.4;
        carState.lateralVelocity *= 0.3;
        
        // Slide along the surface instead of stopping
        const slideDirection = new THREE.Vector3(-normal.z, 0, normal.x);
        const slideAmount = velocityVec.dot(slideDirection);
        const slidePosition = carState.position.clone().add(slideDirection.multiplyScalar(slideAmount * 0.3));
        
        // Push back slightly from collision point
        const pushBack = normal.multiplyScalar(0.3);
        carState.position.add(pushBack);
        
        // Try to move along the surface
        const slideCollision = checkCollision(slidePosition);
        if (!slideCollision.collided && isWithinBoundaries(slidePosition)) {
          carState.position.copy(slidePosition);
        }
      }
    }

    if (carRef.current) {
      carRef.current.position.copy(carState.position);
      carRef.current.position.y = 0.2;
      carRef.current.rotation.y = carState.rotation;
    }

    const idealOffset = cameraOffsetRef.current.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), carState.rotation);
    const idealPosition = carState.position.clone().add(idealOffset);
    camera.position.lerp(idealPosition, 0.1);

    const idealLookAt = carState.position.clone().add(cameraLookOffsetRef.current.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), carState.rotation));
    const currentLookAt = new THREE.Vector3();
    camera.getWorldDirection(currentLookAt);
    currentLookAt.multiplyScalar(10).add(camera.position);
    currentLookAt.lerp(idealLookAt, 0.1);
    camera.lookAt(currentLookAt);
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[50, 100, 50]}
        intensity={0.8}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-near={0.5}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />
      {carGltf && (
        <primitive
          object={carGltf.scene}
          ref={carRef}
          scale={1.3}
          position={[0, 0.2, 20]}
        />
      )}
      {trackGltf && <primitive object={trackGltf.scene} ref={trackRef} scale={1} position={[0, 0, 0]} />}
    </>
  );
};

const F1RacingGame: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');
  const [carGltf, setCarGltf] = useState<any>(null);
  const [trackGltf, setTrackGltf] = useState<any>(null);
  const keysRef = useRef({
    w: false,
    a: false,
    s: false,
    d: false,
    ArrowUp: false,
    ArrowLeft: false,
    ArrowDown: false,
    ArrowRight: false,
  });

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key in keysRef.current) {
        keysRef.current[e.key as keyof typeof keysRef.current] = true;
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key in keysRef.current) {
        keysRef.current[e.key as keyof typeof keysRef.current] = false;
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    let modelsLoaded = 0;
    const loader = new GLTFLoader();

    const loadCar = async () => {
      try {
        const gltf = await loader.loadAsync('/models/car.glb');
        if (mounted) {
          setCarGltf(gltf);
          modelsLoaded++;
          if (modelsLoaded === 2) setLoading(false);
        }
      } catch (err) {
        console.error('Error loading car model:', err);
        setError('Failed to load car model. Please ensure car.glb exists in /public/models/');
        setLoading(false);
      }
    };

    const loadTrack = async () => {
      try {
        const gltf = await loader.loadAsync('/models/track.glb');
        if (mounted) {
          setTrackGltf(gltf);
          modelsLoaded++;
          if (modelsLoaded === 2) setLoading(false);
        }
      } catch (err) {
        console.error('Error loading track model:', err);
        setError('Failed to load track model. Please ensure track.glb exists in /public/models/');
        setLoading(false);
      }
    };

    loadCar();
    loadTrack();

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div style={{ width: '100%', height: '100vh', margin: 0, padding: 0, overflow: 'hidden' }}>
      <Canvas
        shadows
        camera={{ fov: 75, near: 0.1, far: 1000 }}
        style={{ width: '100%', height: '100%' }}
      >
        {carGltf && trackGltf && <Scene carGltf={carGltf} trackGltf={trackGltf} keysRef={keysRef} />}
      </Canvas>
      {loading && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'rgba(0, 0, 0, 0.8)',
            color: 'white',
            padding: '30px 50px',
            borderRadius: '10px',
            fontSize: '24px',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          Loading F1 Racing Game...
        </div>
      )}
      {error && (
        <div
          style={{
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
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          background: 'rgba(0, 0, 0, 0.7)',
          color: 'white',
          padding: '15px 20px',
          borderRadius: '8px',
          fontFamily: 'Arial, sans-serif',
          fontSize: '14px',
        }}
      >
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
