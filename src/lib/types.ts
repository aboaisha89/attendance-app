export type UserRole = "super_admin" | "admin" | "hr" | "manager" | "employee";
export type UserStatus = "pending" | "active" | "rejected" | "suspended";
export type GeoPoint = { lat: number; lng: number };
export type Geofence = {
  id: string; name: string; enabled: boolean; points: GeoPoint[];
  radiusMeters?: number; assignedUserIds?: string[];
};
export type WorkSchedule = {
  id: string; name: string; type: "fixed" | "open";
  startTime?: string; endTime?: string; requiredHours?: number;
  graceMinutes: number; breakMinutes: number; uid?: string;
};
export type AttendanceRecord = {
  id: string; uid: string; dateKey: string; checkInAt: string;
  checkOutAt?: string; checkInLocation?: GeoPoint; checkOutLocation?: GeoPoint;
  totalMinutes?: number; status: "open" | "completed" | "flagged";
};
