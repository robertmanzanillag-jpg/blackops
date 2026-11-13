function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function plain(value: string): string {
  return stripHtml(value)
    .replace(/&/g, "and")
    .replace(/[<>]/g, "")
    .trim();
}

function formatTime(date: Date): string {
  return new Intl.DateTimeFormat("es-US", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

type DatedValue = Date | string;

export interface CeoBriefSnapshot {
  tasks: Array<{ title: string; date: DatedValue; completed?: boolean | null; type?: string | null; priority?: string | null; createdAt?: DatedValue | null }>;
  weeklyTasks: Array<{ title: string; completed?: boolean | null }>;
  monthlyGoals: Array<{ title: string; completed?: boolean | null }>;
  yearlyGoals: Array<{ title: string; completed?: boolean | null }>;
  pendingActions: Array<{ id: string; title: string; status: string; riskLevel?: string | null }>;
  projects: Array<{ name: string; status?: string | null }>;
  priceAlerts: Array<{ enabled?: boolean | null; triggered?: boolean | null }>;
  investments: Array<{ quantity?: string | number | null; avgBuyPrice?: string | number | null }>;
  scheduledReminders: Array<{ isActive?: boolean | null }>;
  auditLogs: Array<{ status?: string | null }>;
  meetingPreps: Array<{ title: string; startsAt: DatedValue; suggestedQuestions: string[] }>;
  recentDecisions: Array<{ key: string; value: string }>;
  keyPeople: Array<{ key: string; value: string }>;
  commitments: Array<{ key: string; value: string }>;
  totalUsers: number;
}

export type CeoRoutineCommand = "top3" | "blockers" | "chase" | "close_day";

export interface CeoDailyCommandCenter {
  topPriorities: string[];
  blockers: string[];
  chaseList: string[];
  closeDay: string[];
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function isBefore(date: Date, compareTo: Date): boolean {
  return date.getTime() < compareTo.getTime();
}

function isSameDay(date: Date, compareTo: Date): boolean {
  return (
    date.getFullYear() === compareTo.getFullYear()
    && date.getMonth() === compareTo.getMonth()
    && date.getDate() === compareTo.getDate()
  );
}

export function buildCeoDailyCommandCenter(snapshot: CeoBriefSnapshot, now = new Date()): CeoDailyCommandCenter {
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const nextSevenDays = addDays(todayStart, 7);

  const overdueTasks = snapshot.tasks
    .filter((task) => {
      const date = startOfDay(new Date(task.date));
      return !task.completed && task.type !== "event" && isBefore(date, todayStart);
    })
    .slice(0, 5);

  const dueFollowUps = snapshot.tasks
    .filter((task) => task.type === "follow_up" && !task.completed && new Date(task.date) <= todayEnd)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  const highPriorityTasks = snapshot.tasks
    .filter((task) => !task.completed && task.priority === "high" && new Date(task.date) <= nextSevenDays)
    .slice(0, 5);

  const todayOpenTasks = snapshot.tasks
    .filter((task) => {
      const date = new Date(task.date);
      return !task.completed && task.type !== "event" && date >= todayStart && date <= todayEnd;
    })
    .slice(0, 5);

  const pendingApprovals = snapshot.pendingActions
    .filter((action) => action.status === "pending" || action.status === "draft" || action.status === "edited")
    .slice(0, 5);

  const openWeeklyTasks = snapshot.weeklyTasks.filter((task) => !task.completed).slice(0, 5);
  const unhealthyProjects = snapshot.projects.filter((project) => project.status === "offline" || project.status === "degraded");
  const recentFailures = snapshot.auditLogs.filter((log) => log.status === "failed" || log.status === "blocked").slice(0, 3);

  const topPriorityItems = [...highPriorityTasks, ...overdueTasks, ...todayOpenTasks]
    .map((task) => plain(task.title));
  for (const task of openWeeklyTasks) {
    if (topPriorityItems.length >= 3) break;
    topPriorityItems.push(`${plain(task.title)} (semanal)`);
  }

  const blockers: string[] = [];
  if (pendingApprovals.length > 0) blockers.push(`${pendingApprovals.length} aprobación(es) esperando decisión.`);
  if (unhealthyProjects.length > 0) blockers.push(`Proyectos con alerta: ${unhealthyProjects.map((project) => `${plain(project.name)} (${project.status})`).join(", ")}.`);
  if (overdueTasks.length > 0) blockers.push(`${overdueTasks.length} tarea(s) vencida(s).`);
  if (dueFollowUps.length > 0) blockers.push(`${dueFollowUps.length} follow-up(s) vencido(s).`);
  if (recentFailures.length > 0) blockers.push(`${recentFailures.length} fallo(s) recientes del assistant.`);

  const chaseList = [
    ...dueFollowUps.map((task) => plain(task.title)),
    ...snapshot.commitments.slice(0, 5).map((commitment) => `${plain(commitment.key)}: ${plain(commitment.value)}`),
  ].slice(0, 5);

  const closeDay: string[] = [];
  if (todayOpenTasks.length > 0) closeDay.push(`Cerrar ${todayOpenTasks.length} tarea(s) de hoy.`);
  if (pendingApprovals.length > 0) closeDay.push(`Decidir ${pendingApprovals.length} aprobación(es): pendientes / aprobar ID / rechazar ID.`);
  if (dueFollowUps.length > 0) closeDay.push(`Resolver ${dueFollowUps.length} follow-up(s) vencido(s).`);
  if (highPriorityTasks.length > 0) closeDay.push(`Confirmar avance de ${Math.min(3, highPriorityTasks.length)} prioridad(es) alta(s).`);
  closeDay.push("Enviar o guardar una nota corta con decisiones y próximos pasos.");

  return {
    topPriorities: Array.from(new Set(topPriorityItems)).slice(0, 3),
    blockers,
    chaseList,
    closeDay,
  };
}

export function formatCeoRoutineCommand(command: CeoRoutineCommand, snapshot: CeoBriefSnapshot, now = new Date()): string {
  const center = buildCeoDailyCommandCenter(snapshot, now);

  if (command === "top3") {
    return [
      "Top 3 prioridades:",
      "",
      ...(center.topPriorities.length > 0
        ? center.topPriorities.map((item, index) => `${index + 1}. ${item}`)
        : ["No detecté prioridades críticas. Usa el brief para cargar agenda, tareas o metas."]),
    ].join("\n");
  }

  if (command === "blockers") {
    return [
      "Bloqueos actuales:",
      "",
      ...(center.blockers.length > 0
        ? center.blockers.map((item) => `- ${item}`)
        : ["No detecté bloqueos operativos fuertes ahora."]),
    ].join("\n");
  }

  if (command === "chase") {
    return [
      "A quién perseguir:",
      "",
      ...(center.chaseList.length > 0
        ? center.chaseList.map((item) => `- ${item}`)
        : ["No hay follow-ups vencidos ni compromisos abiertos cargados."]),
    ].join("\n");
  }

  return [
    "Cierre del día:",
    "",
    ...center.closeDay.map((item) => `- ${item}`),
  ].join("\n");
}

function formatSpanishDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("es-US", options).format(date);
}

export function formatCeoMorningBrief(snapshot: CeoBriefSnapshot, now = new Date()): string {
  const {
    tasks,
    weeklyTasks,
    monthlyGoals,
    yearlyGoals,
    pendingActions,
    projects,
    priceAlerts,
    investments,
    scheduledReminders,
    auditLogs,
    meetingPreps,
    recentDecisions,
    keyPeople,
    commitments,
    totalUsers,
  } = snapshot;
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);
  const nextSevenDays = addDays(todayStart, 7);
  const todaysItems = tasks
    .filter((task) => {
      const date = new Date(task.date);
      return date >= todayStart && date <= todayEnd;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const overdueTasks = tasks
    .filter((task) => {
      const date = startOfDay(new Date(task.date));
      return !task.completed && task.type !== "event" && isBefore(date, todayStart);
    })
    .slice(0, 5);

  const dueFollowUps = tasks
    .filter((task) => task.type === "follow_up" && !task.completed && new Date(task.date) <= todayEnd)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  const nextEvents = tasks
    .filter((task) => {
      const date = new Date(task.date);
      return task.type === "event" && date > todayEnd && date <= nextSevenDays;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .slice(0, 5);

  const pendingApprovals = pendingActions
    .filter((action) => action.status === "pending" || action.status === "draft" || action.status === "edited")
    .slice(0, 5);

  const highPriorityTasks = tasks
    .filter((task) => !task.completed && task.priority === "high" && new Date(task.date) <= nextSevenDays)
    .slice(0, 5);

  const openWeeklyTasks = weeklyTasks.filter((task) => !task.completed).slice(0, 5);
  const openMonthlyGoals = monthlyGoals.filter((goal) => !goal.completed).slice(0, 5);
  const openYearlyGoals = yearlyGoals.filter((goal) => !goal.completed).slice(0, 5);
  const unhealthyProjects = projects.filter((project) => project.status === "offline" || project.status === "degraded");
  const enabledAlerts = priceAlerts.filter((alert) => alert.enabled && !alert.triggered).slice(0, 5);
  const portfolioCostBasis = investments.reduce((sum, investment) => {
    return sum + Number(investment.quantity || 0) * Number(investment.avgBuyPrice || 0);
  }, 0);

  const recentFailures = auditLogs.filter((log) => log.status === "failed" || log.status === "blocked").slice(0, 3);
  const activeReminders = scheduledReminders.filter((reminder) => reminder.isActive).length;
  const todaysEvents = todaysItems.filter((task) => task.type === "event");
  const newEventsToday = tasks.filter((task) => {
    if (task.type !== "event" || !task.createdAt) return false;
    const createdAt = new Date(task.createdAt);
    return createdAt >= todayStart && createdAt <= todayEnd;
  });

  const lines: string[] = [];
  lines.push(`🌅 Brief CEO - ${formatSpanishDate(now, { weekday: "long", day: "numeric", month: "long" })}`);
  lines.push("");

  lines.push("1. Agenda de hoy");
  if (todaysItems.length === 0) {
    lines.push("Sin eventos o tareas fechadas para hoy.");
  } else {
    for (const item of todaysItems.slice(0, 7)) {
      const date = new Date(item.date);
      const prefix = item.type === "event" ? "📅" : item.completed ? "✅" : "•";
      lines.push(`${prefix} ${formatTime(date)} ${plain(item.title)}`);
    }
    if (todaysItems.length > 7) lines.push(`+${todaysItems.length - 7} más para hoy.`);
  }
  lines.push("");

  lines.push("2. Prioridades");
  const priorities = [...highPriorityTasks, ...overdueTasks].slice(0, 6);
  if (priorities.length === 0 && openWeeklyTasks.length === 0) {
    lines.push("No hay prioridades críticas detectadas.");
  } else {
    for (const task of priorities) {
      const label = isSameDay(new Date(task.date), now) ? "hoy" : formatSpanishDate(new Date(task.date), { day: "numeric", month: "short" });
      lines.push(`• ${plain(task.title)} (${label})`);
    }
    for (const task of openWeeklyTasks.slice(0, Math.max(0, 4 - priorities.length))) {
      lines.push(`• ${plain(task.title)} (semanal)`);
    }
  }
  lines.push("");

  lines.push("3. Decisiones y aprobaciones");
  if (pendingApprovals.length === 0) {
    lines.push("No tienes acciones pendientes de aprobación.");
  } else {
    for (const action of pendingApprovals) {
      lines.push(`🛡️ ${plain(action.title)} (${action.riskLevel}) - ID ${action.id}`);
    }
    lines.push("Desde Telegram puedes responder: aprobar ID o rechazar ID.");
  }
  lines.push("");

  lines.push("4. Riesgos");
  const riskLines: string[] = [];
  if (unhealthyProjects.length > 0) {
    riskLines.push(`Proyectos con alerta: ${unhealthyProjects.map((project) => `${plain(project.name)} (${project.status})`).join(", ")}`);
  }
  if (overdueTasks.length > 0) {
    riskLines.push(`${overdueTasks.length} tarea(s) vencida(s) necesitan decisión.`);
  }
  if (dueFollowUps.length > 0) {
    riskLines.push(`${dueFollowUps.length} follow-up(s) vencido(s) requieren seguimiento.`);
  }
  if (recentFailures.length > 0) {
    riskLines.push(`${recentFailures.length} fallo(s) recientes en acciones del assistant.`);
  }
  if (riskLines.length === 0) {
    lines.push("Sin riesgos operativos fuertes detectados.");
  } else {
    riskLines.forEach((line) => lines.push(`• ${line}`));
  }
  lines.push("");

  lines.push("5. Negocio y activos");
  lines.push(`• Usuarios del sistema: ${totalUsers}.`);
  lines.push(`• Eventos nuevos hoy: ${newEventsToday.length}. Agenda de hoy: ${todaysEvents.length} evento(s).`);
  lines.push(`• Portafolio registrado: ${investments.length} activo(s), base ${money(portfolioCostBasis)}.`);
  lines.push(`• Alertas de precio activas: ${enabledAlerts.length}.`);
  lines.push(`• Recordatorios activos: ${activeReminders}.`);
  if (nextEvents.length > 0) {
    lines.push(`• Próximos eventos: ${nextEvents.map((event) => `${formatSpanishDate(new Date(event.date), { day: "numeric", month: "short" })} ${plain(event.title)}`).join("; ")}.`);
  }
  lines.push("");

  lines.push("6. Follow-ups");
  if (dueFollowUps.length === 0) {
    lines.push("No hay follow-ups vencidos.");
  } else {
    dueFollowUps.forEach((task) => lines.push(`• ${plain(task.title)} (${formatSpanishDate(new Date(task.date), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})`));
  }
  lines.push("");

  lines.push("7. Meeting prep");
  if (meetingPreps.length === 0) {
    lines.push("No hay reuniones próximas que requieran preparación.");
  } else {
    for (const prep of meetingPreps.slice(0, 2)) {
      lines.push(`• ${plain(prep.title)} (${formatSpanishDate(new Date(prep.startsAt), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})`);
      prep.suggestedQuestions.slice(0, 2).forEach((question) => lines.push(`  - ${plain(question)}`));
    }
  }
  lines.push("");

  lines.push("8. Decisiones recientes");
  if (recentDecisions.length === 0) {
    lines.push("No hay decisiones estratégicas guardadas todavía.");
  } else {
    recentDecisions.forEach((decision) => lines.push(`• ${plain(decision.key)}: ${plain(decision.value)}`));
  }
  lines.push("");

  lines.push("9. Personas y compromisos");
  if (keyPeople.length === 0 && commitments.length === 0) {
    lines.push("No hay personas clave o compromisos guardados todavía.");
  } else {
    keyPeople.slice(0, 3).forEach((person) => lines.push(`• Persona: ${plain(person.key)} - ${plain(person.value)}`));
    commitments.slice(0, 3).forEach((commitment) => lines.push(`• Compromiso: ${plain(commitment.key)} - ${plain(commitment.value)}`));
  }
  lines.push("");

  lines.push("10. Metas");
  const goalLines = [...openMonthlyGoals.map((goal) => goal.title), ...openYearlyGoals.map((goal) => goal.title)].slice(0, 5);
  if (goalLines.length === 0) {
    lines.push("No hay metas abiertas cargadas para este mes/año.");
  } else {
    goalLines.forEach((goal) => lines.push(`• ${plain(goal)}`));
  }
  lines.push("");

  lines.push("Comandos útiles: top 3, bloqueos, a quién tengo que perseguir, cerrar día, aprobar ID, rechazar ID.");

  return lines.join("\n");
}
