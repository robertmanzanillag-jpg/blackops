import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { 
  Sparkles, 
  ChevronRight,
  CheckCircle2,
  XCircle,
  Users,
  Dumbbell,
  Heart,
  Target,
  BookOpen,
  Calendar
} from "lucide-react";
import type { WeeklySummary } from "@shared/schema";

interface WeeklyReflectionHistoryProps {
  onSelectWeek: (summary: WeeklySummary) => void;
  onNewReflection: () => void;
}

export function WeeklyReflectionHistory({ onSelectWeek, onNewReflection }: WeeklyReflectionHistoryProps) {
  const { data: summaries = [], isLoading } = useQuery<WeeklySummary[]>({
    queryKey: ["/api/weekly-summaries"],
    queryFn: async () => {
      const res = await fetch("/api/weekly-summaries");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-zinc-400";
    if (score >= 60) return "text-zinc-400";
    if (score >= 40) return "text-zinc-400";
    return "text-zinc-400";
  };

  const calculateScore = (summary: WeeklySummary): number => {
    let score = 0;
    let total = 0;

    if (summary.gratitude && summary.gratitude.length >= 3) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.completedAllTasks) { score += 15; total += 15; }
    else { total += 15; }
    
    if (summary.talkedToFamily) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.wentOutWithFriend) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.exercisedThreePlus) { score += 15; total += 15; }
    else { total += 15; }
    
    if (summary.helpedSomeone) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.learnedThisWeek) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.biggestAchievement) { score += 10; total += 10; }
    else { total += 10; }
    
    if (summary.nextWeekGoal) { score += 10; total += 10; }
    else { total += 10; }

    return total > 0 ? Math.round((score / total) * 100) : 0;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-zinc-400">
        Cargando historial...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-zinc-400" />
          Historial de Reflexiones
        </h3>
        <Button
          onClick={onNewReflection}
          className="bg-zinc-800 hover:bg-zinc-800"
          size="sm"
          data-testid="button-new-reflection"
        >
          <Calendar className="w-4 h-4 mr-2" />
          Nueva Reflexión
        </Button>
      </div>

      {summaries.length === 0 ? (
        <Card className="bg-zinc-800/50 border-zinc-700 p-8 text-center">
          <Sparkles className="w-12 h-12 mx-auto text-zinc-600 mb-4" />
          <p className="text-zinc-400 mb-4">
            No tienes reflexiones semanales aún.
          </p>
          <Button
            onClick={onNewReflection}
            className="bg-zinc-800 hover:bg-zinc-800"
            data-testid="button-start-first-reflection"
          >
            Comenzar tu primera reflexión
          </Button>
        </Card>
      ) : (
        <ScrollArea className="h-[400px]">
          <AnimatePresence>
            <div className="space-y-3 pr-4">
              {summaries.map((summary, index) => {
                const score = calculateScore(summary);
                const weekDate = new Date(summary.weekStart);
                
                return (
                  <motion.div
                    key={summary.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card
                      className="bg-zinc-800/50 border-zinc-700 p-4 hover:bg-zinc-800 transition-colors cursor-pointer group"
                      onClick={() => onSelectWeek(summary)}
                      data-testid={`card-reflection-${summary.id}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <span className="text-white font-medium">
                              Semana del {format(weekDate, "d 'de' MMMM", { locale: es })}
                            </span>
                            <Badge 
                              variant="outline" 
                              className={`${getScoreColor(score)} border-current`}
                            >
                              {score}%
                            </Badge>
                          </div>
                          
                          <div className="flex flex-wrap gap-2">
                            {summary.completedAllTasks ? (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <CheckCircle2 className="w-3 h-3 mr-1" /> Tareas
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <XCircle className="w-3 h-3 mr-1" /> Tareas
                              </Badge>
                            )}
                            
                            {summary.talkedToFamily && (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <Users className="w-3 h-3 mr-1" /> Familia
                              </Badge>
                            )}
                            
                            {summary.exercisedThreePlus && (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <Dumbbell className="w-3 h-3 mr-1" /> Ejercicio
                              </Badge>
                            )}
                            
                            {summary.helpedSomeone && (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <Heart className="w-3 h-3 mr-1" /> Ayuda
                              </Badge>
                            )}
                            
                            {summary.learnedThisWeek && (
                              <Badge variant="secondary" className="bg-zinc-900/30 text-zinc-400 text-xs">
                                <BookOpen className="w-3 h-3 mr-1" /> Aprendió
                              </Badge>
                            )}
                          </div>
                          
                          {summary.nextWeekGoal && (
                            <div className="mt-2 flex items-start gap-2 text-sm text-zinc-400">
                              <Target className="w-4 h-4 text-zinc-400 mt-0.5 flex-shrink-0" />
                              <span className="line-clamp-1">{summary.nextWeekGoal}</span>
                            </div>
                          )}
                        </div>
                        
                        <ChevronRight className="w-5 h-5 text-zinc-500 group-hover:text-zinc-300 transition-colors" />
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        </ScrollArea>
      )}
    </div>
  );
}
