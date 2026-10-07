import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/system";

export const Route = createFileRoute("/_app/calendar")({
  head: () => ({ meta: [{ title: "Calendar — AutoMate PH" }] }),
  component: CalendarPage,
});

type Job = {
  id: string;
  job_number: string;
  project_name: string;
  target_completion_date: string | null;
  status: string;
  customer?: { customer_name?: string } | null;
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthLabel = (date: Date) => date.toLocaleDateString(undefined, { month: "long", year: "numeric" });

function CalendarPage() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => isoDate(new Date()));
  const jobs = useQuery({
    queryKey: ["calendar-job-orders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_orders")
        .select("id,job_number,project_name,target_completion_date,status,customer:customers(customer_name)")
        .not("target_completion_date", "is", null)
        .neq("status", "completed")
        .order("target_completion_date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Job[];
    },
  });
  const byDate = useMemo(() => {
    const map = new Map<string, Job[]>();
    for (const job of jobs.data ?? []) {
      if (!job.target_completion_date) continue;
      const list = map.get(job.target_completion_date) ?? [];
      list.push(job);
      map.set(job.target_completion_date, list);
    }
    return map;
  }, [jobs.data]);
  const selectedJobs = byDate.get(selectedDate) ?? [];
  const days = useMemo(() => {
    const first = startOfMonth(month);
    const offset = first.getDay();
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((offset + total) / 7) * 7 }, (_, index) => {
      const day = index - offset + 1;
      return day < 1 || day > total ? null : new Date(month.getFullYear(), month.getMonth(), day);
    });
  }, [month]);
  const moveMonth = (delta: number) => {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1);
    setMonth(next);
    setSelectedDate(isoDate(next));
  };

  return (
    <div className="space-y-6">
      <header>
        <p className="text-sm text-muted-foreground">Planning workspace</p>
        <h1 className="text-3xl font-semibold">Calendar</h1>
        <p className="mt-1 text-muted-foreground">View Job Order target dates and open the source record for the next action.</p>
      </header>
      {jobs.isError ? <Card className="p-6"><p className="text-sm text-destructive">Unable to load scheduled Job Orders.</p><Button className="mt-3" variant="outline" onClick={() => jobs.refetch()}>Retry</Button></Card> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(19rem,0.8fr)]">
        <Card className="p-4 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div><p className="text-sm text-muted-foreground">Target completion dates</p><h2 className="text-xl font-semibold">{monthLabel(month)}</h2></div>
            <div className="flex gap-1"><Button variant="outline" size="icon" aria-label="Previous month" onClick={() => moveMonth(-1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Next month" onClick={() => moveMonth(1)}><ChevronRight className="h-4 w-4" /></Button></div>
          </div>
          {jobs.isLoading ? <p className="py-12 text-center text-sm text-muted-foreground">Loading scheduled work…</p> : <div className="grid grid-cols-7 overflow-hidden rounded-md border"><div className="contents">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <div key={day} className="border-b bg-muted/40 p-2 text-center text-xs font-medium text-muted-foreground">{day}</div>)}</div>{days.map((day, index) => { const date = day ? isoDate(day) : `blank-${index}`; const items = day ? byDate.get(date) ?? [] : []; return <button key={date} type="button" disabled={!day} onClick={() => day && setSelectedDate(date)} className={`min-h-20 border-b border-r p-2 text-left align-top text-sm transition-colors ${day ? "hover:bg-muted/50" : "bg-muted/20"} ${date === selectedDate ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""}`}><span className={date === isoDate(new Date()) ? "font-bold text-primary" : ""}>{day?.getDate() ?? ""}</span>{items.length > 0 ? <span className="mt-2 block rounded bg-primary px-1.5 py-0.5 text-center text-xs text-primary-foreground">{items.length} JO{items.length === 1 ? "" : "s"}</span> : null}</button>; })}</div>}
        </Card>
        <Card className="p-4 sm:p-6">
          <div className="mb-5 flex items-start gap-3"><CalendarDays className="mt-1 h-5 w-5 text-primary" /><div><p className="text-sm text-muted-foreground">Selected date</p><h2 className="text-xl font-semibold">{new Date(`${selectedDate}T00:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" })}</h2></div></div>
          {selectedJobs.length === 0 ? <div className="rounded-md border border-dashed p-6 text-center"><ClipboardList className="mx-auto h-6 w-6 text-muted-foreground" /><p className="mt-2 font-medium">No scheduled work</p><p className="mt-1 text-sm text-muted-foreground">Job Orders with a target completion date will appear here.</p></div> : <div className="space-y-3">{selectedJobs.map((job) => <div key={job.id} className="rounded-md border p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-medium">{job.project_name}</p><p className="text-sm text-muted-foreground">{job.job_number} · {job.customer?.customer_name ?? "Customer"}</p></div><StatusPill status={job.status} /></div><div className="mt-3 flex items-center justify-between gap-3"><Badge variant="secondary">Target completion</Badge><Button asChild size="sm"><Link to="/jobs/$id" params={{ id: job.id }}>Open Job Order</Link></Button></div></div>)}</div>}
        </Card>
      </div>
    </div>
  );
}
