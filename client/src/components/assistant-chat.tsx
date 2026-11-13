import { Bot, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export function AssistantChat() {
  return (
    <Link href="/assistant">
      <Button
        variant="ghost"
        className="group relative h-10 w-full justify-start gap-3 rounded-lg border border-white/15 bg-zinc-950 px-3 text-zinc-100 hover:bg-zinc-900 md:h-10 md:w-full"
        data-testid="button-open-assistant"
      >
        <Bot className="h-4 w-4 transition-colors group-hover:text-white" />
        <span className="hidden text-sm font-medium md:inline">Asistente</span>
        <Sparkles className="ml-auto hidden h-3.5 w-3.5 text-zinc-400 md:block" />
        <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-zinc-300" />
      </Button>
    </Link>
  );
}
