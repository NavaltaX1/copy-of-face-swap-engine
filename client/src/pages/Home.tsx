import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Upload, Zap } from "lucide-react";
import NSFWToggle from "@/components/NSFWToggle";
import "../cyberpunk-theme.css";

export default function Home() {
  const { user, isAuthenticated } = useAuth();
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [targetImage, setTargetImage] = useState<File | null>(null);
  const [referenceVideo, setReferenceVideo] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [aspectRatio, setAspectRatio] = useState<"original" | "9:16">("original");
  const [visualStyle, setVisualStyle] = useState<"none" | "cinematic" | "vivid" | "soft" | "bw">("none");
  const [nsfwEnabled, setNsfwEnabled] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submitJobMutation = trpc.faceSwap.submitJob.useMutation();

  const handleSourceImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSourceImage(file);
    }
  };

  const handleTargetImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setTargetImage(file);
    }
  };

  const handleReferenceVideoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setReferenceVideo(file);
    }
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAudioFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!sourceImage) {
      alert("Please select a source image");
      return;
    }

    setIsSubmitting(true);

    try {
      const sourceBase64 = await fileToBase64(sourceImage);
      const targetBase64 = targetImage ? await fileToBase64(targetImage) : undefined;
      const referenceVideoBase64 = referenceVideo ? await fileToBase64(referenceVideo) : undefined;
      const audioBase64 = audioFile ? await fileToBase64(audioFile) : undefined;

      await submitJobMutation.mutateAsync({
        sourceImageBase64: sourceBase64,
        targetImageBase64: targetBase64,
        referenceVideoBase64: referenceVideoBase64,
        audioBase64: audioBase64,
        aspectRatio,
        visualStyle,
        nsfwEnabled,
      });

      alert("Face swap job submitted successfully!");
      setSourceImage(null);
      setTargetImage(null);
      setReferenceVideo(null);
      setAudioFile(null);
    } catch (error) {
      alert(`Error: ${(error as Error).message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050812] to-[#0a0e27] flex items-center justify-center p-4">
        <Card className="card-neon max-w-md w-full">
          <div className="text-center">
            <h1 className="text-4xl font-bold neon-text-cyan mb-4">FACE SWAP ENGINE</h1>
            <p className="text-gray-400 mb-8">Transform faces with AI-powered precision</p>
            <Button
              onClick={() => startLogin()}
              className="btn-neon w-full"
            >
              Sign In to Continue
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050812] to-[#0a0e27] p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-5xl font-bold neon-text-cyan mb-2 flex items-center justify-center gap-3">
            <Zap size={40} /> FACE SWAP ENGINE
          </h1>
          <p className="text-gray-400 text-lg">Transform faces with cutting-edge AI technology</p>
        </div>

        {/* Upload Form */}
        <Card className="card-neon mb-8 hud-border">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Source Image Upload */}
            <div>
              <label className="block text-sm font-semibold neon-text-pink mb-3">
                SOURCE FACE IMAGE *
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleSourceImageChange}
                  className="hidden"
                  id="source-image"
                  disabled={isSubmitting}
                  required
                />
                <label
                  htmlFor="source-image"
                  className="flex items-center justify-center gap-2 p-8 border-2 border-dashed border-[#00f5ff] rounded-lg cursor-pointer hover:bg-[#00f5ff]/5 transition-colors"
                >
                  <Upload size={24} className="text-[#00f5ff]" />
                  <span className="text-[#00f5ff]">
                    {sourceImage ? sourceImage.name : "Click to upload or drag and drop"}
                  </span>
                </label>
              </div>
            </div>

            {/* Target Image Upload (Optional) */}
            <div>
              <label className="block text-sm font-semibold neon-text-pink mb-3">
                TARGET IMAGE <span className="text-gray-400 text-xs">(Optional)</span>
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleTargetImageChange}
                  className="hidden"
                  id="target-image"
                  disabled={isSubmitting}
                />
                <label
                  htmlFor="target-image"
                  className="flex items-center justify-center gap-2 p-8 border-2 border-dashed border-[#00f5ff] rounded-lg cursor-pointer hover:bg-[#00f5ff]/5 transition-colors"
                >
                  <Upload size={24} className="text-[#00f5ff]" />
                  <span className="text-[#00f5ff]">
                    {targetImage ? targetImage.name : "Click to upload or drag and drop"}
                  </span>
                </label>
              </div>
            </div>

            {/* Reference Video Upload (Optional) */}
            <div>
              <label className="block text-sm font-semibold neon-text-purple mb-3">
                REFERENCE VIDEO <span className="text-gray-400 text-xs">(Optional - for duration/style matching)</span>
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleReferenceVideoChange}
                  className="hidden"
                  id="reference-video"
                  disabled={isSubmitting}
                />
                <label
                  htmlFor="reference-video"
                  className="flex items-center justify-center gap-2 p-8 border-2 border-dashed border-[#b537f2] rounded-lg cursor-pointer hover:bg-[#b537f2]/5 transition-colors"
                >
                  <Upload size={24} className="text-[#b537f2]" />
                  <span className="text-[#b537f2]">
                    {referenceVideo ? referenceVideo.name : "Click to upload or drag and drop"}
                  </span>
                </label>
              </div>
            </div>

            {/* Audio Upload (Optional) */}
            <div>
              <label className="block text-sm font-semibold neon-text-green mb-3">
                AUDIO FILE <span className="text-gray-400 text-xs">(Optional - for background music/voiceover)</span>
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept="audio/*"
                  onChange={handleAudioChange}
                  className="hidden"
                  id="audio-file"
                  disabled={isSubmitting}
                />
                <label
                  htmlFor="audio-file"
                  className="flex items-center justify-center gap-2 p-8 border-2 border-dashed border-[#39ff14] rounded-lg cursor-pointer hover:bg-[#39ff14]/5 transition-colors"
                >
                  <Upload size={24} className="text-[#39ff14]" />
                  <span className="text-[#39ff14]">
                    {audioFile ? audioFile.name : "Click to upload or drag and drop"}
                  </span>
                </label>
              </div>
            </div>

            {/* Aspect Ratio */}
            <div>
              <label className="block text-sm font-semibold neon-text-purple mb-3">
                ASPECT RATIO
              </label>
              <div className="flex gap-4">
                {(["original", "9:16"] as const).map((ratio) => (
                  <label key={ratio} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="aspectRatio"
                      value={ratio}
                      checked={aspectRatio === ratio}
                      onChange={(e) => setAspectRatio(e.target.value as "original" | "9:16")}
                      className="w-4 h-4"
                    />
                    <span className="text-[#00f5ff]">{ratio === "original" ? "Original" : "Portrait (9:16)"}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Visual Style */}
            <div>
              <label className="block text-sm font-semibold neon-text-purple mb-3">
                VISUAL STYLE
              </label>
              <select
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value as any)}
                className="input-neon w-full"
              >
                <option value="none">None</option>
                <option value="cinematic">Cinematic</option>
                <option value="vivid">Vivid</option>
                <option value="soft">Soft</option>
                <option value="bw">Black & White</option>
              </select>
            </div>

            {/* NSFW Toggle */}
            <NSFWToggle />

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={isSubmitting || !sourceImage}
              className="btn-neon-pink w-full py-3 text-lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  PROCESSING...
                </>
              ) : (
                "INITIATE FACE SWAP"
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}

// Helper function to convert file to base64
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
