import { Route, Routes } from "react-router-dom";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import Overview from "./pages/Overview";
import Alerts from "./pages/Alerts";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import Evaluation from "./pages/Evaluation";
import Sandbox from "./pages/Sandbox";

export default function App() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/sandbox" element={<Sandbox />} />
        </Routes>
      </SidebarInset>
      <Toaster position="bottom-right" richColors />
    </SidebarProvider>
  );
}
