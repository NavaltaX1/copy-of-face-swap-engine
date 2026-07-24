import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Loader2, Download, Trash2, Eye } from "lucide-react";
import { useState } from "react";
import "../cyberpunk-theme.css";

export default function JobHistory() {
  const { isAuthenticated } = useAuth();
  const [selectedJob, setSelectedJob] = useState<number | null>(null);

  const jobsQuery = trpc.faceSwap.getJobHistory.useQuery(undefined, {
    enabled: isAuthenticated,
  });

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050812] to-[#0a0e27] flex items-center justify-center p-4">
        <Card className="card-neon max-w-md w-full text-center">
          <h1 className="text-3xl font-bold neon-text-cyan mb-4">ACCESS DENIED</h1>
          <p className="text-gray-400">Please sign in to view your job history</p>
        </Card>
      </div>
    );
  }

  if (jobsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[#050812] to-[#0a0e27] flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-[#00f5ff]" />
      </div>
    );
  }

  const jobs = jobsQuery.data || [];

  const getStatusBadge = (status: string) => {
    const badges: Record<string, string> = {
      pending: "badge-processing",
      queued: "badge-processing",
      processing: "badge-processing",
      completed: "badge-completed",
      failed: "badge-failed",
    };
    return badges[status] || "badge-processing";
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: "PENDING",
      queued: "QUEUED",
      processing: "PROCESSING",
      completed: "COMPLETED",
      failed: "FAILED",
    };
    return labels[status] || status.toUpperCase();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#050812] to-[#0a0e27] p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold neon-text-cyan mb-2">JOB HISTORY</h1>
          <p className="text-gray-400">View and manage your face swap processing jobs</p>
        </div>

        {/* Jobs Grid */}
        {jobs.length === 0 ? (
          <Card className="card-neon text-center py-12">
            <p className="text-gray-400 text-lg">No face swap jobs yet</p>
            <p className="text-gray-500 text-sm mt-2">Create your first face swap to get started</p>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {jobs.map((job: any) => (
              <Card key={job.id} className="card-neon hud-border overflow-hidden hover:shadow-lg transition-shadow">
                {/* Thumbnail */}
                <div className="w-full h-48 bg-[#0f1428] flex items-center justify-center border-b border-[#00f5ff]/30 relative overflow-hidden">
                  {job.outputVideoUrl ? (
                    <img
                      src={job.outputVideoUrl}
                      alt="Face swap output"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center">
                      <Loader2 className="h-8 w-8 animate-spin text-[#00f5ff] mx-auto mb-2" />
                      <p className="text-sm text-gray-400">Processing...</p>
                    </div>
                  )}
                </div>

                {/* Job Details */}
                <div className="p-4 space-y-3">
                  {/* Status Badge */}
                  <div className={`badge-neon ${getStatusBadge(job.status)}`}>
                    {getStatusLabel(job.status)}
                  </div>

                  {/* Job Info */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Job ID:</span>
                      <span className="text-[#00f5ff] font-mono">#{job.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Aspect Ratio:</span>
                      <span className="text-[#ff006e]">{job.aspectRatio}</span>
                    </div>
                    {job.visualStyle !== "none" && (
                      <div className="flex justify-between">
                        <span className="text-gray-400">Style:</span>
                        <span className="text-[#b537f2]">{job.visualStyle}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-gray-400">Created:</span>
                      <span className="text-gray-300">{new Date(job.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  {/* Error Message */}
                  {job.errorMessage && (
                    <div className="bg-[#ff006e]/10 border border-[#ff006e]/30 rounded p-2">
                      <p className="text-xs text-[#ff006e]">{job.errorMessage}</p>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 pt-2">
                    {job.status === "completed" && job.outputVideoUrl && (
                      <>
                        <a
                          href={job.outputVideoUrl}
                          download
                          className="btn-neon flex-1 flex items-center justify-center gap-2 text-sm py-2"
                        >
                          <Download size={16} />
                          DOWNLOAD
                        </a>
                        <button
                          onClick={() => setSelectedJob(selectedJob === job.id ? null : job.id)}
                          className="btn-neon-pink flex-1 flex items-center justify-center gap-2 text-sm py-2"
                        >
                          <Eye size={16} />
                          VIEW
                        </button>
                      </>
                    )}
                    {job.status === "failed" && (
                      <button className="btn-neon-pink w-full text-sm py-2">RETRY</button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Preview Modal */}
        {selectedJob && (
          <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-4 z-50">
            <Card className="card-neon max-w-2xl w-full">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold neon-text-cyan">PREVIEW</h2>
                <button
                  onClick={() => setSelectedJob(null)}
                  className="text-gray-400 hover:text-[#00f5ff] transition-colors"
                >
                  ✕
                </button>
              </div>
              {jobs.find((j: any) => j.id === selectedJob)?.outputVideoUrl && (
                <img
                  src={jobs.find((j: any) => j.id === selectedJob)?.outputVideoUrl || ""}
                  alt="Preview"
                  className="w-full rounded-lg"
                />
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
