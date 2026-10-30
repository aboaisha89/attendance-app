import { Guard } from "@/components/Guard"; import { Shell } from "@/components/Shell";
export default function AdminLayout({children}:{children:React.ReactNode}){return <Guard admin><Shell>{children}</Shell></Guard>}
