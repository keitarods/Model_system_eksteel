'use client';
import {Environment,Lightformer} from '@react-three/drei';
/** Local studio reflections; does not download an HDR environment. */
export function MaterialLighting(){return <Environment resolution={128} frames={1}>
  <Lightformer intensity={2} position={[0,0,5]} scale={[8,8,1]}/>
  <Lightformer intensity={2} position={[-5,0,0]} rotation={[0,Math.PI/2,0]} scale={[6,8,1]}/>
  <Lightformer intensity={1} position={[5,0,0]} rotation={[0,-Math.PI/2,0]} scale={[6,8,1]}/>
  <Lightformer intensity={1} position={[0,0,-5]} rotation={[0,Math.PI,0]} scale={[8,8,1]}/>
</Environment>;}
