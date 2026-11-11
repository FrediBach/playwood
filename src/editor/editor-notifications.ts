export type NotificationSeverity='info'|'success'|'error'
export interface EditorNotification {message:string;severity:NotificationSeverity}
export type Notify=(message:string,severity?:NotificationSeverity)=>void
