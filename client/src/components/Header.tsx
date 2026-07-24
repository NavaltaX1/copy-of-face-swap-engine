import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Zap, LogOut } from "lucide-react";
import NotificationCenter from "./NotificationCenter";
import "../cyberpunk-theme.css";

export default function Header() {
  const { user, isAuthenticated, logout } = useAuth();
  const [location, setLocation] = useLocation();

  const isActive = (path: string) => location === path;

  return (
    <header className="bg-[#0a0e27]/80 backdrop-blur border-b border-[#00f5ff]/20 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4 flex items-center justify-between">
        {/* Logo */}
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <Zap className="text-[#00f5ff]" size={24} />
          <span className="text-xl font-bold neon-text-cyan hidden sm:inline">FACE SWAP</span>
        </button>

        {/* Navigation */}
        {isAuthenticated && (
          <nav className="flex items-center gap-4">
            <button
              onClick={() => setLocation("/")}
              className={`text-sm font-semibold transition-colors ${
                isActive("/") ? "text-[#00f5ff]" : "text-gray-400 hover:text-[#00f5ff]"
              }`}
            >
              UPLOAD
            </button>
            <button
              onClick={() => setLocation("/jobs")}
              className={`text-sm font-semibold transition-colors ${
                isActive("/jobs") ? "text-[#00f5ff]" : "text-gray-400 hover:text-[#00f5ff]"
              }`}
            >
              HISTORY
            </button>
          </nav>
        )}

        {/* User Section */}
        <div className="flex items-center gap-4">
          {isAuthenticated && user && (
            <>
              <NotificationCenter />
              <span className="text-sm text-gray-400 hidden sm:inline">{user.name || user.email}</span>
              <button
                onClick={() => logout()}
                className="btn-neon text-sm py-2 px-3 flex items-center gap-2"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">LOGOUT</span>
              </button>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
