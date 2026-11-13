import { useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Plus, Trash2, Save, Sparkles } from "lucide-react";
import { startOfWeek, format } from "date-fns";
import { es } from "date-fns/locale";
import type { WeeklySummary } from "@shared/schema";

interface WeeklyReflectionFormProps {
  weekStart: Date;
  existingSummary?: WeeklySummary;
  onClose: () => void;
  onSaved?: () => void;
}

export function WeeklyReflectionForm({ weekStart, existingSummary, onClose, onSaved }: WeeklyReflectionFormProps) {
  const queryClient = useQueryClient();
  const monday = startOfWeek(weekStart, { weekStartsOn: 1 });
  
  const [gratitude, setGratitude] = useState<string[]>(existingSummary?.gratitude || ["", "", ""]);
  const [completedAllTasks, setCompletedAllTasks] = useState(existingSummary?.completedAllTasks ?? false);
  const [tasksIncompleteReason, setTasksIncompleteReason] = useState(existingSummary?.tasksIncompleteReason || "");
  const [talkedToFamily, setTalkedToFamily] = useState(existingSummary?.talkedToFamily ?? false);
  const [wentOutWithFriend, setWentOutWithFriend] = useState(existingSummary?.wentOutWithFriend ?? false);
  const [learnedThisWeek, setLearnedThisWeek] = useState(existingSummary?.learnedThisWeek || "");
  const [exercisedThreePlus, setExercisedThreePlus] = useState(existingSummary?.exercisedThreePlus ?? false);
  const [helpedSomeone, setHelpedSomeone] = useState(existingSummary?.helpedSomeone ?? false);
  const [biggestAchievement, setBiggestAchievement] = useState(existingSummary?.biggestAchievement || "");
  const [hardestTask, setHardestTask] = useState(existingSummary?.hardestTask || "");
  const [improvementsForNextWeek, setImprovementsForNextWeek] = useState(existingSummary?.improvementsForNextWeek || "");
  const [pendingTasks, setPendingTasks] = useState(existingSummary?.pendingTasks || "");
  const [mostProductiveThing, setMostProductiveThing] = useState(existingSummary?.mostProductiveThing || "");
  const [nextWeekGoal, setNextWeekGoal] = useState(existingSummary?.nextWeekGoal || "");

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const isEditing = !!existingSummary?.id;
      const url = isEditing 
        ? `/api/weekly-summaries/${existingSummary.id}` 
        : "/api/weekly-summaries";
      const method = isEditing ? "PATCH" : "POST";
      
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/weekly-summaries"] });
      onSaved?.();
      onClose();
    },
  });

  const handleSave = () => {
    const filteredGratitude = gratitude.filter(g => g.trim() !== "");
    
    saveMutation.mutate({
      weekStart: monday.toISOString(),
      gratitude: filteredGratitude,
      completedAllTasks,
      tasksIncompleteReason: completedAllTasks ? null : tasksIncompleteReason,
      talkedToFamily,
      wentOutWithFriend,
      learnedThisWeek,
      exercisedThreePlus,
      helpedSomeone,
      biggestAchievement,
      hardestTask,
      improvementsForNextWeek,
      pendingTasks,
      mostProductiveThing,
      nextWeekGoal,
    });
  };

  const addGratitudeItem = () => {
    setGratitude([...gratitude, ""]);
  };

  const removeGratitudeItem = (index: number) => {
    if (gratitude.length > 3) {
      setGratitude(gratitude.filter((_, i) => i !== index));
    }
  };

  const updateGratitudeItem = (index: number, value: string) => {
    const updated = [...gratitude];
    updated[index] = value;
    setGratitude(updated);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-zinc-900 border border-zinc-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-zinc-400" />
            <h2 className="text-lg font-semibold text-white">
              Reflexión Semanal
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-zinc-400">
              Semana del {format(monday, "d 'de' MMMM", { locale: es })}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-zinc-400 hover:text-white"
              data-testid="button-close-reflection"
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <ScrollArea className="h-[calc(90vh-140px)]">
          <div className="p-6 space-y-6">
            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-400 font-medium mb-3 block">
                🙏 ¿Por qué estás agradecido esta semana? (mínimo 3)
              </Label>
              <div className="space-y-2">
                {gratitude.map((item, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={item}
                      onChange={(e) => updateGratitudeItem(index, e.target.value)}
                      placeholder={`Cosa ${index + 1}...`}
                      className="bg-zinc-900 border-zinc-700"
                      data-testid={`input-gratitude-${index}`}
                    />
                    {gratitude.length > 3 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeGratitudeItem(index)}
                        className="text-zinc-500 hover:text-white"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addGratitudeItem}
                  className="mt-2 border-zinc-700"
                  data-testid="button-add-gratitude"
                >
                  <Plus className="w-4 h-4 mr-2" /> Agregar más
                </Button>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-zinc-800/50 border-zinc-700 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300">✅ ¿Completaste todas tus tareas?</Label>
                  <Switch
                    checked={completedAllTasks}
                    onCheckedChange={setCompletedAllTasks}
                    data-testid="switch-completed-tasks"
                  />
                </div>
                {!completedAllTasks && (
                  <Textarea
                    value={tasksIncompleteReason}
                    onChange={(e) => setTasksIncompleteReason(e.target.value)}
                    placeholder="¿Por qué no?"
                    className="mt-3 bg-zinc-900 border-zinc-700 text-sm"
                    rows={2}
                    data-testid="textarea-incomplete-reason"
                  />
                )}
              </Card>

              <Card className="bg-zinc-800/50 border-zinc-700 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300">👨‍👩‍👧 ¿Hablaste con tu familia?</Label>
                  <Switch
                    checked={talkedToFamily}
                    onCheckedChange={setTalkedToFamily}
                    data-testid="switch-family"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300">🧑‍🤝‍🧑 ¿Saliste con un amigo?</Label>
                  <Switch
                    checked={wentOutWithFriend}
                    onCheckedChange={setWentOutWithFriend}
                    data-testid="switch-friend"
                  />
                </div>
              </Card>
            </div>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                📚 ¿Qué aprendiste esta semana que no sabías antes?
              </Label>
              <Textarea
                value={learnedThisWeek}
                onChange={(e) => setLearnedThisWeek(e.target.value)}
                placeholder="Algo nuevo que aprendí..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-learned"
              />
            </Card>

            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-zinc-800/50 border-zinc-700 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300">💪 ¿Ejercicio 3+ veces?</Label>
                  <Switch
                    checked={exercisedThreePlus}
                    onCheckedChange={setExercisedThreePlus}
                    data-testid="switch-exercise"
                  />
                </div>
              </Card>

              <Card className="bg-zinc-800/50 border-zinc-700 p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-zinc-300">🤝 ¿Ayudaste a alguien?</Label>
                  <Switch
                    checked={helpedSomeone}
                    onCheckedChange={setHelpedSomeone}
                    data-testid="switch-helped"
                  />
                </div>
              </Card>
            </div>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                🏆 ¿Cuál fue tu mayor logro esta semana?
              </Label>
              <Textarea
                value={biggestAchievement}
                onChange={(e) => setBiggestAchievement(e.target.value)}
                placeholder="Mi mayor logro fue..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-achievement"
              />
            </Card>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                😓 ¿Qué tarea o proyecto te costó más y por qué?
              </Label>
              <Textarea
                value={hardestTask}
                onChange={(e) => setHardestTask(e.target.value)}
                placeholder="Lo más difícil fue..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-hardest"
              />
            </Card>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                📈 ¿Qué mejorarías para la próxima semana?
              </Label>
              <Textarea
                value={improvementsForNextWeek}
                onChange={(e) => setImprovementsForNextWeek(e.target.value)}
                placeholder="Podría mejorar..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-improvements"
              />
            </Card>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                ⏳ ¿Qué cosas dejaste pendientes?
              </Label>
              <Textarea
                value={pendingTasks}
                onChange={(e) => setPendingTasks(e.target.value)}
                placeholder="Quedó pendiente..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-pending"
              />
            </Card>

            <Card className="bg-zinc-800/50 border-zinc-700 p-4">
              <Label className="text-zinc-300 mb-2 block">
                ⚡ ¿Qué fue lo más productivo que hiciste?
              </Label>
              <Textarea
                value={mostProductiveThing}
                onChange={(e) => setMostProductiveThing(e.target.value)}
                placeholder="Lo más productivo fue..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-productive"
              />
            </Card>

            <Card className="bg-zinc-900/30 border-white/10 p-4">
              <Label className="text-zinc-400 mb-2 block">
                🎯 ¿Cuál será tu objetivo principal para la próxima semana?
              </Label>
              <Textarea
                value={nextWeekGoal}
                onChange={(e) => setNextWeekGoal(e.target.value)}
                placeholder="Mi objetivo para la próxima semana es..."
                className="bg-zinc-900 border-zinc-700"
                rows={2}
                data-testid="textarea-next-goal"
              />
            </Card>
          </div>
        </ScrollArea>

        <div className="p-4 border-t border-zinc-800 flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={onClose}
            className="border-zinc-700"
            data-testid="button-cancel-reflection"
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={saveMutation.isPending || gratitude.filter(g => g.trim()).length < 3}
            className="bg-zinc-800 hover:bg-zinc-800"
            data-testid="button-save-reflection"
          >
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Guardando..." : "Guardar Reflexión"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
