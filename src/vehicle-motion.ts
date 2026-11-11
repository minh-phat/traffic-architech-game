import type { Vehicle } from './simulation';

export type VehicleMotionState='accelerating'|'slowing'|'braking'|'stationary'|'steady';
export const MOTION_LABELS:Record<VehicleMotionState,string>={
  accelerating:'Đang tăng tốc',
  slowing:'Đang giảm tốc độ',
  braking:'Đang phanh (thắng)',
  stationary:'Đang đứng im',
  steady:'Đang giữ tốc độ',
};

/** Acceleration in this simulation is the change in speed magnitude, also in reverse.
 * A small deadband avoids reporting numerical noise as acceleration or slowing. */
export function vehicleMotionState(vehicle:Pick<Vehicle,'speed'|'velocity'|'acceleration'|'braking'|'inGarage'|'arrived'>):VehicleMotionState {
  if(vehicle.inGarage||vehicle.arrived||Math.abs(vehicle.velocity??vehicle.speed)<.01)return 'stationary';
  const acceleration=vehicle.acceleration??0;
  if(vehicle.braking||acceleration<-.5)return 'braking';
  if(acceleration<-.1)return 'slowing';
  if(acceleration>.1)return 'accelerating';
  return 'steady';
}
