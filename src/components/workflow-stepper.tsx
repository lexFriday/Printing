import { Check } from "lucide-react";

export type WorkflowStep = { label: string; state: "done" | "current" | "waiting" | "blocked"; value?: string };

export function WorkflowStepper({ steps }: { steps: WorkflowStep[] }) {
  return <div className="relative mt-2 flex flex-col sm:mt-4 sm:flex-row sm:items-start">
    {steps.map((step, index) => <div key={step.label} className="relative flex min-w-0 gap-3 pb-4 last:pb-0 sm:block sm:flex-1 sm:pb-0">
      <div className="relative z-20 flex flex-1 flex-row items-center gap-3 sm:flex-col sm:items-center sm:gap-0">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm ${step.state === "done" || (step.state === "current" && index === steps.length - 1) ? "border-emerald-600 bg-emerald-600 text-white" : step.state === "current" ? "border-primary bg-background text-primary" : step.state === "blocked" ? "border-amber-500 bg-amber-50 text-amber-700" : "border-muted-foreground/30 bg-background text-muted-foreground"}`}>
          {step.state === "done" || (step.state === "current" && index === steps.length - 1) ? <Check className="h-4 w-4" /> : index + 1}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2 sm:mt-2 sm:flex-col sm:gap-0 sm:text-center">
          <p className="text-sm font-medium">{step.label}</p>
          {step.value ? <p className="text-xs text-muted-foreground sm:mt-1">{step.value}</p> : null}
          {step.state === "current" ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary sm:mt-1">Current</span> : null}
        </div>
      </div>
      {index < steps.length - 1 ? <div className={`pointer-events-none absolute left-4 top-8 z-10 h-[calc(100%-1rem)] w-0.5 sm:left-[calc(50%+1rem)] sm:top-4 sm:h-0.5 sm:w-[calc(100%-2rem)] ${step.state === "done" ? "bg-emerald-500" : "bg-slate-300"}`} /> : null}
    </div>)}
  </div>;
}
