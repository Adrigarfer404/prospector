import { AppShell } from "@/components/Sidebar";
import { FinderStateProvider } from "@/components/FinderState";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <FinderStateProvider><AppShell>{children}</AppShell></FinderStateProvider>;
}
