import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, X, Check } from "lucide-react";
import { useState, useEffect } from "react";
import "../cyberpunk-theme.css";

export default function NotificationCenter() {
  const { isAuthenticated } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);

  const notificationsQuery = trpc.notification.getNotifications.useQuery(
    { limit: 10, offset: 0 },
    { enabled: isAuthenticated && isOpen }
  );

  const unreadQuery = trpc.notification.getUnreadCount.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const markAsReadMutation = trpc.notification.markAsRead.useMutation();
  const deleteNotificationMutation = trpc.notification.deleteNotification.useMutation();

  useEffect(() => {
    if (notificationsQuery.data) {
      setNotifications(notificationsQuery.data);
    }
  }, [notificationsQuery.data]);

  const handleMarkAsRead = async (notificationId: number) => {
    await markAsReadMutation.mutateAsync({ notificationId });
    setNotifications(notifications.filter((n) => n.id !== notificationId));
  };

  const handleDelete = async (notificationId: number) => {
    await deleteNotificationMutation.mutateAsync({ notificationId });
    setNotifications(notifications.filter((n) => n.id !== notificationId));
  };

  if (!isAuthenticated) {
    return null;
  }

  const unreadCount = unreadQuery.data?.unreadCount || 0;

  return (
    <div className="relative">
      {/* Notification Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 hover:bg-[#1a1f3a] rounded-lg transition-colors"
      >
        <Bell size={20} className="text-[#00f5ff]" />
        {unreadCount > 0 && (
          <span className="absolute top-0 right-0 bg-[#ff006e] text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>

      {/* Notification Dropdown */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-[#0a0e27] border border-[#00f5ff]/30 rounded-lg shadow-lg z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-[#00f5ff]/30">
            <h3 className="text-lg font-bold neon-text-cyan">NOTIFICATIONS</h3>
            <button
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-[#00f5ff] transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          {/* Notifications List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="p-8 text-center text-gray-400">
                <p>No notifications yet</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className="p-4 border-b border-[#00f5ff]/10 hover:bg-[#1a1f3a]/50 transition-colors"
                >
                  <div className="flex gap-3">
                    {/* Status Indicator */}
                    <div className="flex-shrink-0 pt-1">
                      {notification.status === "pending" ? (
                        <div className="w-2 h-2 bg-[#00f5ff] rounded-full animate-pulse" />
                      ) : (
                        <div className="w-2 h-2 bg-[#39ff14] rounded-full" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 break-words">
                        {notification.content}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {new Date(notification.createdAt).toLocaleDateString()}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-shrink-0">
                      {notification.status === "pending" && (
                        <button
                          onClick={() => handleMarkAsRead(notification.id)}
                          className="text-gray-400 hover:text-[#00f5ff] transition-colors"
                          title="Mark as read"
                        >
                          <Check size={16} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(notification.id)}
                        className="text-gray-400 hover:text-[#ff006e] transition-colors"
                        title="Delete"
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-4 border-t border-[#00f5ff]/30 text-center">
              <button className="text-sm text-[#00f5ff] hover:text-[#00f5ff]/80 transition-colors">
                View all notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
