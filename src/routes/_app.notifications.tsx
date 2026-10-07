import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bell, Check } from "lucide-react";

export const Route = createFileRoute("/_app/notifications")({ component: NotificationsPage });

function NotificationsPage() {
  const notifications = useQuery({
    queryKey: ["notifications-inbox"],
    queryFn: async () => {
      const { data, error } = await (supabase.from("user_notifications") as any)
        .select("*").is("archived_at", null).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const markRead = async (id: string) => {
    await (supabase.from("user_notifications") as any).update({ read_at: new Date().toISOString() }).eq("id", id);
    notifications.refetch();
  };
  return <div className="space-y-6">
    <header><p className="text-sm text-muted-foreground">Action center</p><h1 className="text-3xl font-semibold">Notifications</h1><p className="mt-1 text-muted-foreground">Follow up on stock, purchasing, and production work.</p></header>
    <Card className="p-6">
      {notifications.isLoading ? <p className="text-sm text-muted-foreground">Loading notifications…</p> : notifications.isError ? <div className="flex items-center gap-3"><p className="text-sm text-destructive">Unable to load notifications.</p><Button variant="outline" size="sm" onClick={() => notifications.refetch()}>Retry</Button></div> : notifications.data.length === 0 ? <div className="flex items-center gap-3 text-muted-foreground"><Bell className="h-5 w-5" />You’re all caught up.</div> : <div className="divide-y">{notifications.data.map((n: any) => <div key={n.id} className={`flex items-start justify-between gap-4 py-4 ${n.read_at ? "opacity-60" : ""}`}><div><p className="font-medium">{n.title}</p><p className="text-sm text-muted-foreground">{n.body}</p><Link className="text-sm text-primary underline-offset-4 hover:underline" to={n.source_type === "material" ? "/inventory/$materialId" : "/production"} params={n.source_type === "material" ? { materialId: n.source_id } : undefined}>Open related record</Link></div>{!n.read_at ? <Button variant="ghost" size="sm" onClick={() => markRead(n.id)} aria-label="Mark notification as read"><Check className="h-4 w-4" /></Button> : null}</div>)}</div>}
    </Card>
  </div>;
}
