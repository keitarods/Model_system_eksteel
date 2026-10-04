/** Replicad groups count vertices, while lines is a flat XYZ buffer. */
export function cadEdgeCoordinates(lines:number[],group:{start:number;count:number}):number[]{
  return lines.slice(group.start*3,(group.start+group.count)*3);
}
