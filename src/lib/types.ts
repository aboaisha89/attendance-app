export type Role='super_admin'|'admin'|'hr_manager'|'branch_manager'|'supervisor'|'employee';
export type Employee={uid:string;name:string;email:string;phone?:string;employeeId?:string;department?:string;branchId?:string;role:Role;status:'pending'|'active'|'rejected'|'suspended';scheduleId?:string;managerUid?:string;createdAt?:unknown};
export type Branch={id:string;name:string;code?:string;address?:string;timezone?:string;active:boolean};
export type Schedule={id:string;name:string;type:'fixed'|'open';start?:string;end?:string;breakMinutes?:number;requiredMinutes:number;graceMinutes?:number;days?:number[];branchId?:string};
export type Attendance={id:string;uid:string;employeeName?:string;branchId?:string;date:string;sessionNumber:number;checkInAt?:{seconds:number};checkOutAt?:{seconds:number};minutes?:number;status:'open'|'closed';lateMinutes?:number};
