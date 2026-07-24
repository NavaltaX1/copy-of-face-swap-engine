import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { useState, useEffect } from "react";
import "../cyberpunk-theme.css";

export default function NSFWToggle() {
  const { isAuthenticated } = useAuth();
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const userSettingsQuery = trpc.faceSwap.getSettings.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  const updateSettingsMutation = trpc.faceSwap.updateSettings.useMutation();

  useEffect(() => {
    if (userSettingsQuery.data) {
      setNsfwEnabled(userSettingsQuery.data.nsfwToggle === 1);
    }
  }, [userSettingsQuery.data]);

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      await updateSettingsMutation.mutateAsync({
        nsfwToggle: !nsfwEnabled,
      });
      setNsfwEnabled(!nsfwEnabled);
    } catch (error) {
      console.error("Error updating NSFW setting:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex items-center justify-between p-4 bg-[#1a1f3a] rounded-lg border border-[#00f5ff]/30 hover:border-[#00f5ff]/60 transition-colors">
      <div>
        <label className="text-sm font-semibold neon-text-cyan">NSFW FILTER</label>
        <p className="text-xs text-gray-400 mt-1">
          {nsfwEnabled ? "Enabled - NSFW content will be filtered" : "Disabled - NSFW content allowed"}
        </p>
      </div>
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`relative w-12 h-6 rounded-full transition-colors ${
          nsfwEnabled ? "bg-[#00f5ff]" : "bg-gray-600"
        } ${isLoading ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <div
          className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${
            nsfwEnabled ? "translate-x-7" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}
